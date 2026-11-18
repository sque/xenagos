"""HTTP application: serves the built viewer, the review API, the agent pane and the `xen` agent commands."""

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from xenagos import __version__, claude, config, voice
from xenagos.access import Access, AccessControl
from xenagos.agent import Agent, AgentError, AgentSettings
from xenagos.api import (
    AgentRequest,
    AgentStatus,
    ChangedFile,
    Coverage,
    Delivery,
    FileView,
    PlanRejection,
    Question,
    RepositoryTree,
    ReviewInfo,
    SessionChoice,
    SessionChoiceItem,
    Show,
    ShowResult,
    StepAddition,
    VisualAddition,
    VoiceInfo,
    VoiceRequest,
)
from xenagos.coverage import hunk_info, not_covered
from xenagos.events import Events
from xenagos.files import BINARY
from xenagos.plan import Plan
from xenagos.review import PlanRejected, Review, without_narration
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget
from xenagos.terminal import Terminal
from xenagos.tree import repository_tree

VIEWER_MISSING = "The viewer is not built. Run `make web` in the xenagos repository, or install a built package."


class ViewerFiles(StaticFiles):
    """The built viewer. Its page must be revalidated on every load, or a browser keeps an old page that names an old
    bundle after xenagos is rebuilt or upgraded; the bundles have content hashes in their names and never change."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        immutable = path.startswith("assets/")
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
        # A visual's frame may not navigate anywhere (its content security policy cannot forbid that itself), and
        # the viewer is not framed by other pages. Visuals are srcdoc frames, which `frame-src` does not restrict.
        response.headers["Content-Security-Policy"] = "frame-src 'none'; frame-ancestors 'none'"
        return response


def bundled_viewer_dir() -> Path | None:
    """Directory of the built viewer shipped inside the package, or None when it was not built."""
    path = Path(str(resources.files("xenagos") / "static"))
    return path if (path / "index.html").is_file() else None


@dataclass(frozen=True)
class IdlePolicy:
    """When a review's server ends itself (spec: review-session, "Idle instances end themselves")."""

    idle_seconds: float = 30 * 60
    """After the last viewer closed."""
    unopened_seconds: float = 24 * 3600
    """When no viewer was ever opened."""

    @property
    def check_every(self) -> float:
        return max(0.05, min(5.0, self.idle_seconds / 4, self.unopened_seconds / 4))

    def expired(self, events: Events, now: float) -> bool:
        limit = self.idle_seconds if events.ever_opened else self.unopened_seconds
        return events.viewers == 0 and events.idle_for(now) >= limit


def rejection(error: PlanRejected) -> JSONResponse:
    return JSONResponse(PlanRejection(problems=error.problems).model_dump(), status_code=422)


def create_app(
    target: ReviewTarget,
    access: Access,
    viewer_dir: Path | None,
    *,
    store: ReviewStore | None = None,
    settings: AgentSettings | None = None,
    idle: IdlePolicy | None = None,
    on_idle: Callable[[], None] | None = None,
) -> FastAPI:
    """Build the application for one review. `viewer_dir` holds the built viewer; None serves an explanation.
    `store` keeps the review's state across servers; without it the state lives in memory. With `idle`, `on_idle` is
    called once the server has had no viewer for the policy's period."""
    events = Events()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        watcher = asyncio.create_task(_watch_idle(events, idle, on_idle)) if idle and on_idle else None
        follower = asyncio.create_task(_follow_agent(agent, events))
        try:
            yield
        finally:
            follower.cancel()
            if watcher is not None:
                watcher.cancel()
            for terminal in list(agent.terminals):
                await terminal.close()

    app = FastAPI(
        title="xenagos", version=__version__, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.add_middleware(AccessControl, access=access)
    state = Review(
        target,
        store=store,
        on_plan=lambda plan: events.publish({"type": "plan"}),
        style=lambda: config.active_style(target.repo),
    )
    if store is not None:
        store.save_target(target)
    agent = Agent(
        state,
        store if store is not None else _MemoryStore(target),
        (lambda: settings) if settings is not None else lambda: _agent_settings(target.repo),
        on_change=lambda: events.publish({"type": "agent"}),
    )
    app.state.review = state
    app.state.agent = agent
    app.state.events = events

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "review": target.review_id}

    def current_settings() -> config.Settings:
        try:
            return config.load(target.repo)
        except config.ConfigError as error:
            raise HTTPException(500, f"the xenagos configuration cannot be used: {error}") from error

    @app.get("/api/review")
    def review() -> ReviewInfo:
        current = current_settings()
        return ReviewInfo(
            id=target.review_id,
            repo=str(target.repo),
            label=target.label,
            base=target.base,
            head=target.head,
            branch=target.branch,
            style=current.narration.style,
            voice=VoiceInfo(
                enabled=current.voice.enabled,
                provider=current.voice.provider,
                name=current.voice.name,
                speed=current.voice.speed,
                off_machine=current.voice.off_machine,
            ),
        )

    @app.post("/api/voice", response_class=Response)
    async def speak(request: VoiceRequest) -> Response:
        """The step's narration as audio from the configured voice command (spec: walkthrough-narration)."""
        settings = current_settings().voice
        try:
            audio = await asyncio.to_thread(voice.speak, settings, request.text, request.voice, request.speed)
        except voice.VoiceError as error:
            raise HTTPException(502, str(error)) from error
        headers = {"Cache-Control": "no-store", "X-Xenagos-Cached": "yes" if audio.cached else "no"}
        return Response(audio.data, media_type=audio.media_type, headers=headers)

    @app.get("/api/changes")
    def changed_files() -> list[ChangedFile]:
        return [
            ChangedFile(
                path=c.path,
                old_path=c.old_path,
                status=c.status,
                binary=c.binary,
                hunks=[hunk_info(h) for h in c.hunks],
            )
            for c in state.changes
        ]

    @app.get("/api/coverage")
    def coverage() -> Coverage:
        """The hunks the current plan leaves out, by category, with line counts."""
        if state.plan is None:
            raise HTTPException(404, "this review has no walkthrough yet")
        return not_covered(state.plan, state.changes, state.categories)

    @app.get("/api/tree")
    def tree() -> RepositoryTree:
        """The repository at the head with the change, coverage and visited files marked."""
        return repository_tree(state.head_files, state.changes, state.categories, state.plan)

    @app.get("/api/file")
    def file(path: str) -> FileView:
        change = state.change_for(path)
        old_path = change.old_path if change is not None else None
        head_path = change.path if change is not None else path
        base = state.files.text(target.base, old_path or head_path)
        head = state.files.text(target.head, head_path)
        if change is None and base is None and head is None:
            raise HTTPException(404, f"{path} exists at neither revision")
        return FileView(
            path=head_path,
            old_path=old_path,
            status=change.status if change is not None else "unchanged",
            binary=BINARY in (base, head),
            base=base if isinstance(base, str) else None,
            head=head if isinstance(head, str) else None,
        )

    @app.get("/api/plan")
    def get_plan() -> Plan:
        if state.plan is None:
            raise HTTPException(404, "this review has no walkthrough yet")
        return state.plan

    @app.get("/api/plan/without-narration")
    def get_plan_without_narration() -> dict[str, Any]:
        if state.plan is None:
            raise HTTPException(404, "this review has no walkthrough yet")
        return without_narration(state.plan)

    @app.put("/api/plan", response_model=Plan, responses={422: {"model": PlanRejection}})
    def put_plan(document: Any = Body()) -> Any:  # noqa: B008 - FastAPI's declaration style
        try:
            return state.submit_plan(document)
        except PlanRejected as rejected:
            return rejection(rejected)

    @app.put("/api/plan/narration", response_model=Plan, responses={422: {"model": PlanRejection}})
    def put_narration(document: Any = Body()) -> Any:  # noqa: B008
        try:
            return state.submit_narration(document)
        except PlanRejected as rejected:
            return rejection(rejected)

    @app.post("/api/plan/steps", response_model=Plan, responses={422: {"model": PlanRejection}})
    def add_step(addition: StepAddition) -> Any:
        try:
            return state.add_step(addition)
        except PlanRejected as rejected:
            return rejection(rejected)

    @app.post("/api/plan/visuals", response_model=Plan, responses={422: {"model": PlanRejection}})
    def add_visual(addition: VisualAddition) -> Any:
        try:
            return state.add_visual(addition)
        except PlanRejected as rejected:
            return rejection(rejected)

    @app.post("/api/show", response_model=ShowResult, responses={422: {"model": PlanRejection}})
    def show(request: Show) -> Any:
        try:
            state.check_show(request)
        except PlanRejected as rejected:
            return rejection(rejected)
        events.publish({"type": "show", **request.model_dump(mode="json", by_alias=True, exclude_none=True)})
        return ShowResult(viewers=events.viewers)

    # The agent session

    @app.get("/api/agent")
    def agent_status() -> AgentStatus:
        return agent.status()

    @app.get("/api/agent/sessions")
    def agent_sessions() -> list[SessionChoiceItem]:
        """Sessions that can replace the review's: background sessions that run, newest first."""
        try:
            found = claude.sessions()
        except claude.ClaudeError as error:
            raise HTTPException(502, str(error)) from error
        return [
            SessionChoiceItem(session=s.session_id, name=s.name, kind=s.kind, running=s.running, cwd=s.cwd)
            for s in reversed(found)
            if s.kind == "background" and s.running
        ]

    @app.put("/api/agent/session")
    def choose_session(choice: SessionChoice) -> AgentStatus:
        if not agent.choose(choice.session, replace=choice.replace):
            raise HTTPException(409, f"this review already has session {agent.session_id}")
        return agent.status()

    @app.post("/api/agent/continue")
    async def continue_session() -> AgentStatus:
        try:
            return await agent.continue_here()
        except AgentError as error:
            raise HTTPException(error.status, str(error)) from error

    @app.post("/api/agent/start")
    async def start_session() -> AgentStatus:
        try:
            return await agent.start_new()
        except AgentError as error:
            raise HTTPException(error.status, str(error)) from error

    @app.post("/api/agent/ask")
    async def ask(question: Question) -> Delivery:
        try:
            return await agent.deliver(agent.question(question))
        except AgentError as error:
            raise HTTPException(error.status, str(error)) from error

    @app.post("/api/agent/request")
    async def request(request: AgentRequest) -> Delivery:
        try:
            return await agent.deliver(agent.request(request))
        except AgentError as error:
            raise HTTPException(error.status, str(error)) from error

    @app.websocket("/api/events")
    async def viewer_events(socket: WebSocket) -> None:
        await socket.accept()
        queue = events.subscribe()
        receiver = asyncio.create_task(_until_closed(socket))
        try:
            while True:
                getter = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait({getter, receiver}, return_when=asyncio.FIRST_COMPLETED)
                if receiver in done:
                    getter.cancel()
                    break
                await socket.send_json(getter.result())
        except WebSocketDisconnect:
            pass
        finally:
            receiver.cancel()
            events.unsubscribe(queue)

    @app.websocket("/api/agent/terminal")
    async def agent_terminal(socket: WebSocket, cols: int = 100, rows: int = 30) -> None:
        await socket.accept()
        try:
            session = await asyncio.to_thread(agent.attachable)
            cwd = Path(session.cwd) if session.cwd and Path(session.cwd).is_dir() else target.repo
            terminal = await Terminal.spawn(claude.attach_command(session), cwd, claude.child_env(), cols, rows)
        except (AgentError, claude.ClaudeError) as error:
            await socket.send_json({"type": "unavailable", "reason": str(error)})
            await socket.close()
            return
        agent.terminals.append(terminal)
        try:
            await _bridge(socket, terminal)
        finally:
            # The attach program ends with the viewer; the session it shows keeps running.
            agent.terminals.remove(terminal)
            await terminal.close()

    # Keep this last: a mount at "/" answers for every route added after it, WebSockets included.
    if viewer_dir is None:

        @app.get("/", response_class=PlainTextResponse, status_code=503)
        def viewer_missing() -> str:
            return VIEWER_MISSING

    else:
        app.mount("/", ViewerFiles(directory=viewer_dir, html=True), name="viewer")
    return app


def _agent_settings(repo: Path) -> AgentSettings:
    session = config.load(repo).session
    return AgentSettings(name_template=session.name, permission_mode=session.permission_mode)


class _MemoryStore(ReviewStore):
    """Keeps the agent's session in memory, for an application built without saved state."""

    def __init__(self, target: ReviewTarget) -> None:
        super().__init__(target.review_id)
        self._session: str | None = None

    def load(self) -> None:
        return None

    def set_session(self, session: str | None, name: str | None = None, cwd: str | None = None) -> None:
        self._session = session


AGENT_POLL_SECONDS = 2.0


async def _follow_agent(agent: Agent, events: Events) -> None:
    """While a viewer is open, tell it when the session's state changes: working, idle, waiting for the reviewer,
    ended, or shown elsewhere (spec: agent-link). Claude Code is asked through `claude agents`, which is cheap."""
    last: AgentStatus | None = None
    while True:
        await asyncio.sleep(AGENT_POLL_SECONDS)
        if events.viewers == 0 or agent.session_id is None:
            last = None
            continue
        status = await asyncio.to_thread(agent.status)
        if last is not None and status != last:
            events.publish({"type": "agent"})
        last = status


async def _watch_idle(events: Events, idle: IdlePolicy, on_idle: Callable[[], None]) -> None:
    while not idle.expired(events, time.monotonic()):
        await asyncio.sleep(idle.check_every)
    on_idle()


async def _until_closed(socket: WebSocket) -> None:
    with contextlib.suppress(WebSocketDisconnect):
        while True:
            await socket.receive_text()


async def _bridge(socket: WebSocket, terminal: Terminal) -> None:
    """Terminal output to the socket as binary messages; keystrokes and size changes back as JSON text messages."""

    async def output() -> None:
        while data := await terminal.read():
            await socket.send_bytes(data)
        await socket.send_json({"type": "exit"})

    async def keys() -> None:
        while True:
            message = await socket.receive_text()
            try:
                command = json.loads(message)
            except ValueError:
                continue
            if not isinstance(command, dict):
                continue
            if command.get("type") == "input" and isinstance(command.get("data"), str):
                terminal.write(command["data"].encode())
            elif command.get("type") == "resize":
                cols, rows = command.get("cols"), command.get("rows")
                if isinstance(cols, int) and isinstance(rows, int):
                    terminal.resize(cols, rows)

    tasks = {asyncio.create_task(output()), asyncio.create_task(keys())}
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                await task
        # Closing a socket the viewer already closed raises WebSocketDisconnect (Starlette 1.x) or RuntimeError.
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await socket.close()
