"""The review's agent session: which one it is, starting one, and what xenagos may type into it (spec: agent-link;
design decision 4a).

What xenagos enters into the session is limited to the reviewer's question with a reference built here from validated
values, and a few fixed requests. Text is pasted into the newest attach terminal of the agent pane and submitted with
Enter; a busy session queues it (spike 2.1). Terminal control characters are removed first, so a question cannot end
the paste early or send keys of its own.
"""

import asyncio
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from xenagos import claude, git
from xenagos.api import AgentRequest, AgentStatus, CodeSelection, Delivery, ElementSelection, Position, Question
from xenagos.claude import ClaudeError, Session, StillOpen
from xenagos.review import Review
from xenagos.store import ReviewStore
from xenagos.terminal import Terminal

PASTE_START = b"\x1b[200~"
PASTE_END = b"\x1b[201~"
SUBMIT_DELAY_SECONDS = 0.15
SETTLE_SECONDS = 1.5
"""A pane that has just attached is still drawing; text typed before then can be lost."""
CONTINUE_OR_START = "Continue it here, or start a new session."
READY = "Say in one short sentence that you are ready."


class AgentError(Exception):
    """A request about the agent that cannot be carried out; the message is meant for the reviewer or the agent."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class AgentSettings:
    """Settings for a session xenagos starts (spec: configuration). The defaults are the built-in ones."""

    name_template: str = "review {repo} {branch}"
    permission_mode: str | None = None
    """None leaves Claude Code's own default."""


class Agent:
    def __init__(
        self,
        review: Review,
        store: ReviewStore,
        settings: AgentSettings,
        on_change: Callable[[], None],
    ) -> None:
        self.review = review
        self.store = store
        self.settings = settings
        self._on_change = on_change
        saved = store.load()
        self.session_id = saved.session if saved is not None else None
        self.terminals: list[Terminal] = []
        self._lock = asyncio.Lock()

    @property
    def review_id(self) -> str:
        return self.review.target.review_id

    # Which session

    def choose(self, session_id: str, replace: bool = False) -> bool:
        """Make `session_id` the review's session. A review keeps the session it has unless `replace` is given, which
        only the user's own request may set. Returns whether the review's session is now `session_id`."""
        if self.session_id == session_id:
            return True
        if self.session_id is not None and not replace:
            return False
        self.session_id = session_id
        self.store.set_session(session_id)
        self._on_change()
        return True

    def session(self) -> Session | None:
        return claude.find(self.session_id) if self.session_id is not None else None

    def status(self) -> AgentStatus:
        if self.session_id is None:
            return AgentStatus(state="none")
        try:
            session = self.session()
        except ClaudeError as error:
            return AgentStatus(state="unavailable", session=self.session_id, reason=str(error))
        saved = self.store.load()
        if session is None:
            name = saved.session_name if saved is not None else None
            reason = f"Claude Code no longer lists this session. {CONTINUE_OR_START}"
            return AgentStatus(state="ended", session=self.session_id, name=name, reason=reason)
        self.store.set_session(session.session_id, session.name, session.cwd)
        common = {"session": session.session_id, "name": session.label, "activity": session.status}
        if session.kind != "background":
            where = "Close it in its terminal, then continue it here" if session.running else "Continue it here"
            reason = (
                "This session was started by hand in a terminal, so it cannot be shown here; it can still write "
                f"the walkthrough and point at code. {where}, or start a new session."
            )
            return AgentStatus(state="not-shown", reason=reason, **common)
        if not session.running:
            return AgentStatus(state="ended", reason=f"The session has stopped. {CONTINUE_OR_START}", **common)
        own = {terminal.process.pid for terminal in self.terminals}
        return AgentStatus(state="attachable", shared=claude.attached_elsewhere(session, own), **common)

    def attachable(self) -> Session:
        session = self.session()
        if session is None or not session.can_attach:
            raise AgentError(409, self.status().reason or "the review has no session to show")
        return session

    # Starting a session

    def working_dir(self) -> Path:
        """Where the session runs: the user's checkout when it is at the reviewed head (spec: "The session runs where
        the code is")."""
        target = self.review.target
        if git.try_run(target.repo, "rev-parse", "HEAD") != target.head:
            raise AgentError(
                409,
                f"Your checkout of {target.repo} is not at the reviewed head {target.head[:10]}. "
                "A session for this review needs a private checkout, which this version cannot make yet.",
            )
        return target.repo

    def session_name(self) -> str:
        target = self.review.target
        values = {"repo": target.repo.name, "branch": target.branch or target.head[:10], "review": self.review_id}
        try:
            return self.settings.name_template.format(**values).strip() or f"review {self.review_id[:8]}"
        except (KeyError, IndexError, ValueError) as error:
            raise AgentError(500, f"the session name template is not valid: {error}") from error

    def introduction(self) -> str:
        rid = self.review_id
        return (
            f"You are the agent of xenagos review {rid} ({self.review.target.label}), open in the reviewer's browser. "
            f"Use the `xen` commands with `--review {rid}` to write the walkthrough and to point at code in the viewer."
        )

    def extra_arguments(self) -> list[str]:
        """Arguments for every session xenagos starts or continues: the skill that teaches it the `xen` commands."""
        return ["--plugin-dir", str(claude.plugin_dir())]

    def _start(self, message: str) -> Session:
        prompt = f"{self.introduction()}\n\n{message}"
        session = claude.start(
            self.working_dir(), self.session_name(), self.settings.permission_mode, prompt, self.extra_arguments()
        )
        self.session_id = session.session_id
        self.store.set_session(session.session_id, session.name, session.cwd)
        return session

    async def start_new(self) -> AgentStatus:
        """Start a new session for the review, replacing the one it has (only on the user's request)."""
        async with self._lock:
            try:
                await asyncio.to_thread(self._start, READY)
            except ClaudeError as error:
                raise AgentError(502, str(error)) from error
        self._on_change()
        return await asyncio.to_thread(self.status)

    async def continue_here(self) -> AgentStatus:
        """Continue the review's session in the background, so the pane can show it (only on the user's request).
        It keeps its id, conversation and name. A session still open elsewhere is not continued: no copy of it is
        left running, and the user is told to close it first (spec: agent-link)."""
        async with self._lock:
            await asyncio.to_thread(self._continue)
        self._on_change()
        return await asyncio.to_thread(self.status)

    def _continue(self) -> None:
        if self.session_id is None:
            raise AgentError(409, "This review has no session to continue.")
        try:
            session = self.session()
        except ClaudeError as error:
            raise AgentError(502, str(error)) from error
        if session is not None and session.can_attach:
            return
        saved = self.store.load()
        name = (session.name if session else None) or (saved.session_name if saved else None) or self.session_name()
        if session is not None and session.running:
            raise AgentError(
                409, f"Session {name} is still open in another terminal. Close it there, then choose continue again."
            )
        folder = (session.cwd if session else None) or (saved.session_cwd if saved else None)
        cwd = Path(folder) if folder and Path(folder).is_dir() else self.working_dir()
        prompt = f"{self.introduction()}\n\nThis session now continues in the review's agent pane. {READY}"
        try:
            claude.continue_in_background(self.session_id, cwd, name, prompt, self.extra_arguments())
        except StillOpen as error:
            raise AgentError(409, str(error)) from error
        except ClaudeError as error:
            raise AgentError(502, str(error)) from error

    # What is entered into the session

    async def deliver(self, message: str) -> Delivery:
        """Enter `message` into the session, starting a session with it when the review has none."""
        async with self._lock:
            if self.session_id is None:
                try:
                    session = await asyncio.to_thread(self._start, message)
                except ClaudeError as error:
                    raise AgentError(502, str(error)) from error
                self._on_change()
                return Delivery(started=True, session=session.session_id)
            status = await asyncio.to_thread(self.status)
            if status.state != "attachable":
                raise AgentError(409, status.reason or "the review's session cannot receive messages")
            if status.activity == "waiting":
                # A permission prompt or a question is open in the session. The Enter that submits a message would
                # answer it with its highlighted choice, which is often "Yes".
                raise AgentError(
                    409, "The agent is waiting for your answer in its pane. Answer it there, then send again."
                )
            terminal = self._newest_terminal()
            if terminal is None:
                raise AgentError(409, "The agent pane is not open. Open it, then send again.")
            await _type(terminal, message)
            return Delivery(started=False, session=self.session_id)

    def _newest_terminal(self) -> Terminal | None:
        running = [t for t in self.terminals if t.running]
        return running[-1] if running else None

    def question(self, question: Question) -> str:
        text = visible_text(question.question)
        if not text:
            raise AgentError(422, "The question is empty.")
        return f"{self.reference(question.selection, question.position)}\n{text}"

    def reference(self, selection: CodeSelection | ElementSelection, position: Position | None) -> str:
        """One line naming what the question is about, built only from values checked against the review."""
        where = self._code(selection) if isinstance(selection, CodeSelection) else self._element(selection)
        parts = [f"[xenagos review {self.review_id}]", where]
        if position is not None:
            parts.append(self._position(position))
        return " ".join(parts[:2]) + "".join(f" · {part}" for part in parts[2:])

    def _code(self, selection: CodeSelection) -> str:
        change = self.review.change_for(selection.path)
        if change is None and self.review.files.text(self.review.target.head, selection.path) is None:
            raise AgentError(422, f"{selection.path} is not a file of this review")

        def path_at(side: str) -> str:
            if change is not None and side == "base" and change.old_path is not None:
                return change.old_path
            return change.path if change is not None else selection.path

        for side, line in ((selection.start_side, selection.start_line), (selection.end_side, selection.end_line)):
            revision = self.review.target.base if side == "base" else self.review.target.head
            lines = self.review.files.lines(revision, path_at(side))
            if not isinstance(lines, list) or line > len(lines):
                raise AgentError(422, f"line {line} is not in {path_at(side)} at the {side}")
        if selection.start_side == selection.end_side:
            path = path_at(selection.start_side)
            if selection.end_line < selection.start_line:
                raise AgentError(422, "the selection ends before it starts")
            span = (
                f"line {selection.start_line}"
                if selection.start_line == selection.end_line
                else f"lines {selection.start_line}-{selection.end_line}"
            )
            return f"{path} {span} ({selection.start_side})"
        return (
            f"{path_at(selection.end_side)} from line {selection.start_line} ({selection.start_side}) "
            f"to line {selection.end_line} ({selection.end_side})"
        )

    def _element(self, selection: ElementSelection) -> str:
        plan = self.review.plan
        declared = plan is not None and any(
            v.id == selection.visual and any(e.id == selection.element for e in v.elements)
            for s in plan.sections
            for v in s.visuals
        )
        if not declared:
            what = f"element {selection.element} in visual {selection.visual}"
            raise AgentError(422, f"the walkthrough declares no {what}")
        return f"visual {selection.visual}, element {selection.element}"

    def _position(self, position: Position) -> str:
        plan = self.review.plan
        if plan is None or position.section > len(plan.sections):
            raise AgentError(422, f"the walkthrough has no section {position.section}")
        if position.step > len(plan.sections[position.section - 1].steps):
            raise AgentError(422, f"section {position.section} has no step {position.step}")
        return f"section {position.section}, step {position.step}"

    def request(self, request: AgentRequest) -> str:
        rid = self.review_id
        if request.kind == "walkthrough":
            again = " again; the new plan replaces the current one" if self.review.plan is not None else ""
            return (
                f"Please write the walkthrough for xenagos review {rid}{again}. Read the guide with `xen guide`, "
                f"then submit the plan with `xen plan submit --review {rid} <file>`."
            )
        if request.kind == "narration":
            if self.review.plan is None:
                raise AgentError(409, "this review has no walkthrough to re-narrate")
            return (
                f"Please rewrite the narration of the walkthrough in xenagos review {rid}. Get it with "
                f"`xen plan get --without-narration --review {rid}` and submit the new text with "
                f"`xen narration submit --review {rid} <file>`."
            )
        plan = self.review.plan
        visuals = {v.id for s in plan.sections for v in s.visuals} if plan is not None else set()
        if request.visual is None or request.visual not in visuals:
            raise AgentError(422, f"the walkthrough has no visual {request.visual}")
        return (
            f"Visual {request.visual} in xenagos review {rid} failed to show. Please repair it: see it with "
            f"`xen plan get --review {rid}` and replace it with `xen visual add --review {rid}`."
        )


def visible_text(text: str) -> str:
    """`text` without terminal control characters; line breaks and tabs are kept."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "".join(c for c in text if c in "\n\t" or unicodedata.category(c) != "Cc").strip()


async def _type(terminal: Terminal, message: str) -> None:
    wait = SETTLE_SECONDS - (time.monotonic() - terminal.started)
    if wait > 0:
        await asyncio.sleep(wait)
    terminal.write(PASTE_START + visible_text(message).encode() + PASTE_END)
    await asyncio.sleep(SUBMIT_DELAY_SECONDS)
    terminal.write(b"\r")
