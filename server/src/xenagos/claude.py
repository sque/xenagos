"""The `claude` command, as xenagos uses it (design decision 4a).

xenagos reads which sessions exist from `claude agents --json`, starts a background session with `claude --bg`, and
shows one by running `claude attach` on a pseudo-terminal. Measured on Claude Code 2.1.323:

- `claude agents --json --all` lists interactive and background sessions. Only background sessions have a short `id`;
  a session whose process runs has a `pid`.
- `claude attach` takes the short id (or part of the name), not the full session id.
- `claude --bg` prints `backgrounded · <short id> · <name>` and refuses a folder never trusted in Claude Code, saying
  how to trust it. Trusting a parent folder is not enough.
- `claude attach` on a stopped background session starts it again, so xenagos attaches only to running sessions: it
  never resumes a session by itself.
- `claude --resume <id> --bg` continues a session in the background under the same id once its process has ended
  (spike 2.5). While the session is still open elsewhere it starts a copy instead and says
  `note: session <id> is open in another Claude Code process, so this started a copy as <copy id>`.

The command is `claude` on the PATH, or the program named by `XENAGOS_CLAUDE` (tests use a stand-in).
"""

import json
import os
import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

# Set by Claude Code for the commands a session runs. A `claude` started with them believes it runs inside that
# session (and refuses to start, or reports to it), so they are removed from everything xenagos starts.
SESSION_VARIABLES = frozenset(
    {
        "CLAUDECODE",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_SESSION_ID",
        "CLAUDE_PID",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_CODE_MESSAGING_SOCKET",
        "CLAUDE_CODE_MESSAGING_TOKEN",
        "CLAUDE_CODE_SESSION_ATTENDED",
        "CLAUDE_AGENT_SDK_VERSION",
        "CLAUDE_EFFORT",
    }
)
TIMEOUT_SECONDS = 30.0
_STARTED = re.compile(r"^backgrounded\s+\S+\s+([0-9a-f]{6,})\b", re.MULTILINE)
_COPY = re.compile(r"is open in another Claude Code process, so this started a copy as ([0-9a-f]{6,})")


class ClaudeError(Exception):
    """A `claude` command failed; the message is meant for the user."""


class StillOpen(ClaudeError):
    """The session to continue is still open in another Claude Code process."""


@dataclass(frozen=True)
class Session:
    session_id: str
    short_id: str | None
    """What `claude attach` takes. Only background sessions have one."""
    name: str | None
    kind: str
    """`background` or `interactive`, as Claude Code reports it."""
    running: bool
    status: str | None
    """While running: `idle`, `busy`, ..."""
    state: str | None
    cwd: str | None

    @property
    def can_attach(self) -> bool:
        return self.kind == "background" and self.short_id is not None and self.running

    @property
    def label(self) -> str:
        return self.name or self.short_id or self.session_id[:8]


def executable() -> str:
    return os.environ.get("XENAGOS_CLAUDE") or "claude"


def child_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The environment for a program xenagos starts: its own, without the variables of a Claude Code session."""
    env = {key: value for key, value in os.environ.items() if key not in SESSION_VARIABLES}
    env.update(extra or {})
    return env


def opener_session() -> str | None:
    """The session that runs this command, if a Claude Code session does (spike 2.3)."""
    return os.environ.get("CLAUDE_CODE_SESSION_ID") or None


def _run(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(  # noqa: S603 - fixed program, arguments are not interpreted by a shell
            [executable(), *args],
            cwd=cwd,
            env=child_env(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError as error:
        raise ClaudeError(f"Claude Code is not installed: `{executable()}` was not found") from error
    except subprocess.TimeoutExpired as error:
        raise ClaudeError(f"`claude {args[0]}` did not answer within {TIMEOUT_SECONDS:.0f} seconds") from error


def _failure(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stderr.strip() or result.stdout.strip() or f"exit status {result.returncode}").splitlines()[0]


def sessions() -> list[Session]:
    """Every session Claude Code knows on this machine, running or not."""
    result = _run("agents", "--json", "--all")
    if result.returncode != 0:
        raise ClaudeError(f"`claude agents` failed: {_failure(result)}")
    try:
        rows = json.loads(result.stdout)
    except ValueError as error:
        raise ClaudeError("`claude agents --json` printed something that is not JSON") from error
    return [_session(row) for row in rows if isinstance(row, dict) and isinstance(row.get("sessionId"), str)]


def _session(row: dict[str, object]) -> Session:
    def text(key: str) -> str | None:
        value = row.get(key)
        return value if isinstance(value, str) and value else None

    return Session(
        session_id=str(row["sessionId"]),
        short_id=text("id"),
        name=text("name"),
        kind=text("kind") or "unknown",
        running=isinstance(row.get("pid"), int),
        status=text("status"),
        state=text("state"),
        cwd=text("cwd"),
    )


def find(session_id: str) -> Session | None:
    return next((s for s in sessions() if s.session_id == session_id), None)


def resolve(reference: str) -> Session:
    """The session a person names: its full id, its short id, or its whole name."""
    known = sessions()
    for matches in (
        [s for s in known if s.session_id == reference],
        [s for s in known if s.short_id == reference],
        [s for s in known if s.name == reference],
    ):
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ClaudeError(f"more than one session is called {reference!r}; name it by id (see `claude agents`)")
    raise ClaudeError(f"no Claude Code session {reference!r}; see `claude agents`")


def start(cwd: Path, name: str, permission_mode: str | None, prompt: str, extra: Sequence[str] = ()) -> Session:
    """Start a background session in `cwd` whose first message is `prompt`."""
    mode = ["--permission-mode", permission_mode] if permission_mode else []
    result = _run("--bg", "-n", name, *mode, *extra, prompt, cwd=cwd)
    if result.returncode != 0:
        raise ClaudeError(f"Claude Code did not start a session: {_failure(result)}")
    return _backgrounded(result)


def continue_in_background(session_id: str, cwd: Path, name: str, prompt: str, extra: Sequence[str] = ()) -> Session:
    """Continue a session whose process has ended as a background session, keeping its id, conversation and name.
    If it is still open elsewhere, the copy Claude Code starts instead is stopped and removed, and StillOpen raised."""
    result = _run("--resume", session_id, "--bg", "-n", name, *extra, prompt, cwd=cwd)
    copy = _COPY.search(result.stdout + result.stderr)
    if copy is not None:
        remove(copy.group(1))
        raise StillOpen(
            f"Session {name} is still open in another terminal, so it cannot be continued here. "
            "Close it there, then choose continue again."
        )
    if result.returncode != 0:
        raise ClaudeError(f"Claude Code did not continue the session: {_failure(result)}")
    session = _backgrounded(result)
    if session.session_id != session_id:
        if session.short_id is not None:
            remove(session.short_id)
        raise ClaudeError(f"Claude Code continued a different session ({session.session_id}); it was removed")
    return session


def remove(short_id: str) -> None:
    """Stop a background session and remove it from Claude Code's list. Its conversation is kept."""
    _run("stop", short_id)
    result = _run("rm", short_id)
    if result.returncode != 0:
        raise ClaudeError(f"Claude Code did not remove session {short_id}: {_failure(result)}")


def _backgrounded(result: subprocess.CompletedProcess[str]) -> Session:
    found = _STARTED.search(result.stdout)
    if found is None:
        raise ClaudeError(f"Claude Code started a session but its id could not be read from: {result.stdout.strip()}")
    short_id = found.group(1)
    session = next((s for s in sessions() if s.short_id == short_id), None)
    if session is None:
        raise ClaudeError(f"Claude Code started session {short_id}, but `claude agents` does not list it")
    return session


def attach_command(session: Session) -> list[str]:
    if session.short_id is None:
        raise ClaudeError(f"session {session.label} is not a background session and cannot be shown")
    return [executable(), "attach", session.short_id]
