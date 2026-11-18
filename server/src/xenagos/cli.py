"""The `xen` command.

`xen [target]` opens a review in the foreground, or brings up the one already running for the same target. Other
commands are named first (`xen list`); a target with the same name as a command goes after `--` (`xen -- list`).

An agent session uses `xen open` to open a review of its work for the user, and the agent commands (`xen guide`,
`xen plan`, `xen narration`, `xen show`, `xen step`, `xen visual`) to write the walkthrough and point at code. An
agent command finds its review by the session that runs it, or by `--review`; if the review's server has ended, it is
started again from the review's saved state (design decision 4a).
"""

import argparse
import contextlib
import json
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Callable, Sequence
from pathlib import Path
from types import FrameType
from typing import Any

import uvicorn

from xenagos import __version__, claude, config, registry
from xenagos.api import Coverage
from xenagos.app import IdlePolicy, bundled_viewer_dir, create_app
from xenagos.claude import ClaudeError
from xenagos.client import ServerError, call
from xenagos.coverage import summary as coverage_summary
from xenagos.diff import changes
from xenagos.guide import RULES, hunk_list, style_section
from xenagos.registry import LOOPBACK, Entry
from xenagos.schema import render as render_schema
from xenagos.store import ReviewStore, SavedReview, saved_reviews
from xenagos.target import ReviewTarget, TargetError, repository_root, resolve

START_TIMEOUT_SECONDS = 20.0


class CommandError(Exception):
    """Ends the command with this message on standard error and exit status `status`."""

    def __init__(self, message: str, status: int = 2) -> None:
        super().__init__(message)
        self.status = status


def target_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("target", nargs="?", help="what to review; see below")
    parser.add_argument("--base", help="review the current branch against this branch, from their fork point")
    parser.add_argument("-C", dest="path", type=Path, default=Path(), help="repository to review (default: here)")
    parser.add_argument("--session", help="Claude Code session to be the review's agent: its id or name")


def review_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xen",
        description="Open a review of a code change. With no target: the current branch against the default branch.",
        epilog="Targets: A...B (from the fork point), A..B (directly), REV (one commit), or --base BRANCH. "
        "Other commands: xen list, xen stop, xen open, xen skill; "
        "for agents: xen guide, plan, narration, show, step, visual.",
    )
    parser.add_argument("--version", action="version", version=f"xen {__version__}")
    target_arguments(parser)
    parser.add_argument("--port", type=int, default=0, help="loopback port to serve on (default: a free one)")
    parser.add_argument("--no-browser", action="store_true", help="print the address instead of opening a browser")
    return parser


def listen_on_loopback(port: int) -> socket.socket:
    """A listening socket on the loopback address. Port 0 picks a free port with no race."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((LOOPBACK, port))
    sock.listen(128)
    return sock


def present(entry: Entry, open_browser: bool) -> None:
    print(f"Viewer: {entry.viewer_url}", flush=True)
    if open_browser:
        webbrowser.open(entry.viewer_url)


def _end_on_terminate(signum: int, frame: FrameType | None) -> None:
    raise SystemExit(0)


def serve(target: ReviewTarget, port: int, open_browser: bool, session: claude.Session | None = None) -> None:
    """Serve the review in the foreground, or present the server already running for it. `session` becomes the
    review's agent session, replacing any it had: naming one is the user's own request."""
    settings = load_settings(target.repo)
    store = ReviewStore(target.review_id)
    store.save_target(target)
    if session is not None:
        store.set_session(session.session_id, session.name, session.cwd)
    sock = listen_on_loopback(port)
    entry = registry.new_entry(target, sock.getsockname()[1])
    existing = registry.claim(entry)
    if existing is not None:
        sock.close()
        print(f"Already open: {existing.label} ({existing.review_id})", flush=True)
        if session is not None:
            call(existing, "PUT", "/api/agent/session", {"session": session.session_id, "replace": True})
        present(existing, open_browser)
        return
    try:
        print(f"Reviewing {target.label} ({target.base[:10]}..{target.head[:10]}), review {target.review_id}")
        present(entry, open_browser)
        print("Ctrl+C stops the review.", flush=True)
        holder: dict[str, uvicorn.Server] = {}

        def end_when_idle() -> None:
            print("No viewer for a while: ending the review. Its state is kept.", flush=True)
            holder["server"].should_exit = True

        app = create_app(
            target,
            entry.access,
            bundled_viewer_dir(),
            store=store,
            idle=IdlePolicy(idle_seconds=settings.idle_minutes * 60, unopened_seconds=settings.unopened_hours * 3600),
            on_idle=end_when_idle,
        )
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
        holder["server"] = server
        # uvicorn shuts down gracefully on SIGTERM, then raises it again under the handler found before it started.
        # Ending through SystemExit here lets the record be released below.
        signal.signal(signal.SIGTERM, _end_on_terminate)
        server.run(sockets=[sock])
    finally:
        registry.release(entry)


def load_settings(repo: Path) -> config.Settings:
    """The settings for a review of `repo`; invalid configuration stops the command, naming file and setting."""
    try:
        return config.load(repo)
    except config.ConfigError as error:
        raise CommandError(f"the configuration cannot be used:\n{error}") from error


def resolve_target(args: argparse.Namespace) -> ReviewTarget:
    try:
        return resolve(args.path, args.target, args.base)
    except TargetError as error:
        raise CommandError(str(error)) from error


def named_session(reference: str | None) -> claude.Session | None:
    if reference is None:
        return None
    try:
        return claude.resolve(reference)
    except ClaudeError as error:
        raise CommandError(str(error)) from error


def cmd_review(argv: Sequence[str]) -> int:
    args = review_parser().parse_args(argv)
    target = resolve_target(args)
    serve(target, args.port, open_browser=not args.no_browser, session=named_session(args.session))
    return 0


def cmd_list(argv: Sequence[str]) -> int:
    argparse.ArgumentParser(prog="xen list", description="List open reviews.").parse_args(argv)
    entries = registry.live_entries()
    if not entries:
        print("No open reviews.")
        return 0
    rows = [("REVIEW", "TARGET", "COMMITS", "ADDRESS", "AGENT", "REPOSITORY")]
    saved_by_id = {e.review_id: ReviewStore(e.review_id).load() for e in entries}
    names = _session_names([s.session for s in saved_by_id.values() if s is not None and not s.session_name])
    for e in entries:
        saved = saved_by_id[e.review_id]
        session = "-"
        if saved is not None and saved.session:
            session = saved.session_name or names.get(saved.session) or saved.session[:8]
        rows.append((e.review_id, e.label, f"{e.base[:8]}..{e.head[:8]}", e.viewer_url, session, e.repo))
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]) - 1)]
    for row in rows:
        print("  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=False)) + "  " + row[-1])
    return 0


def _session_names(sessions: list[str | None]) -> dict[str, str]:
    """Names Claude Code knows for these sessions; nothing if it cannot be asked."""
    if not any(sessions):
        return {}
    try:
        return {s.session_id: s.name for s in claude.sessions() if s.name is not None}
    except ClaudeError:
        return {}


def cmd_stop(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="xen stop", description="Stop open reviews. Their saved state is kept.")
    parser.add_argument("review", nargs="*", help="review id, or the start of one, as `xen list` shows it")
    parser.add_argument("--all", action="store_true", help="stop every open review")
    args = parser.parse_args(argv)
    if args.all == bool(args.review):
        parser.error("name one or more reviews, or --all")
    if args.all:
        targets = registry.live_entries()
    else:
        targets = []
        for prefix in args.review:
            matches = registry.find(prefix)
            if len(matches) != 1:
                problem = "no open review" if not matches else "more than one open review"
                print(f"xen stop: {problem} matches {prefix!r}; see `xen list`", file=sys.stderr)
                return 2
            targets.append(matches[0])
    status = 0
    for entry in targets:
        if registry.stop(entry):
            print(f"Stopped {entry.review_id} ({entry.label})")
        else:
            print(f"xen stop: review {entry.review_id} did not stop", file=sys.stderr)
            status = 1
    return status


# Opening a review for an agent, and reaching one


def start_in_background(review_id: str) -> Entry:
    """Start a server for a saved review as a process of its own and wait until it answers."""
    store = ReviewStore(review_id)
    saved = store.load()
    if saved is None:
        raise CommandError(f"no saved review {review_id}")
    store.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with store.log_path.open("ab") as log:
        process = subprocess.Popen(  # noqa: S603 - this program, with a review id
            [sys.executable, "-m", "xenagos", "_serve", review_id],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=saved.repo,
            env=claude.child_env(),
            start_new_session=True,
        )
    # Reaps the server if it ends while this command still runs; an unreaped server would still count as running.
    threading.Thread(target=process.wait, daemon=True).start()
    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        for entry in registry.find(review_id):
            if registry.answers(entry):
                return entry
        if process.poll() is not None and not registry.find(review_id):
            break
        time.sleep(0.05)
    tail = store.log_path.read_text(errors="replace").strip().splitlines()[-5:]
    raise CommandError(f"the review server did not start; its log ({store.log_path}) ends with:\n" + "\n".join(tail))


def cmd_serve_saved(argv: Sequence[str]) -> int:
    """Internal: serve a saved review. `xen open` and the agent commands start this in the background."""
    parser = argparse.ArgumentParser(prog="xen _serve")
    parser.add_argument("review")
    args = parser.parse_args(argv)
    saved = ReviewStore(args.review).load()
    if saved is None:
        raise CommandError(f"no saved review {args.review}")
    serve(saved.target, 0, open_browser=False)
    return 0


def cmd_open(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="xen open",
        description="Open a review for your user, with the calling Claude Code session as its agent. "
        "Prints the review's link; the server ends by itself once no viewer has been open for a while.",
    )
    target_arguments(parser)
    parser.add_argument("--no-browser", action="store_true", help="only print the link; do not open a browser")
    args = parser.parse_args(argv)
    target = resolve_target(args)
    settings = load_settings(target.repo)
    named = named_session(args.session)
    session = named.session_id if named is not None else claude.opener_session()
    store = ReviewStore(target.review_id)
    saved = store.save_target(target)
    live = registry.find(target.review_id)
    entry = live[0] if live else None
    if session is not None:
        if entry is not None:
            if not _choose(entry, session):
                print(_kept_notice(store.load() or saved), flush=True)
        elif saved.session is None:
            store.set_session(session, named.name if named else None, named.cwd if named else None)
        elif saved.session != session:
            print(_kept_notice(saved), flush=True)
    if entry is None:
        entry = start_in_background(target.review_id)
    print(f"Review of {target.label} ({target.review_id})", flush=True)
    # Whether the agent opens a window on the user's screen or only gives the link is the user's setting.
    present(entry, open_browser=not args.no_browser and settings.agent_open == "window")
    return 0


def _choose(entry: Entry, session: str) -> bool:
    try:
        call(entry, "PUT", "/api/agent/session", {"session": session})
    except ServerError as error:
        if error.status == 409:
            return False
        raise
    return True


def _kept_notice(saved: SavedReview) -> str:
    return (
        f"This review already has agent session {saved.session_name or saved.session}, which stays its agent. "
        "The user can replace it from the viewer."
    )


def locate(review: str | None) -> Entry:
    """The running server of the review an agent command is for, started again from saved state if it has ended."""
    if review is not None:
        live = registry.find(review)
        if len(live) == 1:
            return live[0]
        saved = [s for s in saved_reviews() if s.review_id.startswith(review)]
        if len(live) > 1 or len(saved) > 1:
            raise CommandError(f"more than one review starts with {review!r}.\n{_open_reviews()}")
        if not saved:
            raise CommandError(f"there is no review {review!r}.\n{_open_reviews()}")
        return start_in_background(saved[0].review_id)
    session = claude.opener_session()
    if session is None:
        raise CommandError(f"name the review with --review <id>.\n{_open_reviews()}")
    mine = [s for s in saved_reviews() if s.session == session]
    if not mine:
        raise CommandError(
            "this session is not the agent of any review. Open one with `xen open`, "
            f"or name one with --review <id>.\n{_open_reviews()}"
        )
    live = [e for e in registry.live_entries() if e.review_id in {s.review_id for s in mine}]
    if len(live) == 1:
        return live[0]
    if len(live) > 1 or len(mine) > 1:
        raise CommandError(
            f"this session is the agent of more than one review; name one with --review <id>.\n{_open_reviews()}"
        )
    return start_in_background(mine[0].review_id)


def _open_reviews() -> str:
    entries = registry.live_entries()
    if not entries:
        return "No reviews are open."
    return "Open reviews:\n" + "\n".join(f"  {e.review_id}  {e.label}  ({e.repo})" for e in entries)


# Agent commands


def _with_review(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("--review", help="review id, or the start of one (default: the review of this session)")
    return parser


def _read_json(source: str) -> Any:
    try:
        text = sys.stdin.read() if source == "-" else Path(source).read_text()
    except OSError as error:
        raise CommandError(f"cannot read {source}: {error.strerror}") from error
    try:
        return json.loads(text)
    except ValueError as error:
        raise CommandError(f"{source} is not valid JSON: {error}", status=1) from error


def _rejected(what: str, error: ServerError) -> CommandError:
    if error.status not in (409, 422):
        return CommandError(str(error), status=1)
    problems = "\n".join(f"- {p}" for p in error.problems)
    return CommandError(f"{what} rejected:\n{problems}", status=1)


def _plan_summary(plan: dict[str, Any]) -> str:
    sections = plan.get("sections", [])
    steps = sum(len(s.get("steps", [])) for s in sections)
    return f"{len(sections)} section{'s' * (len(sections) != 1)}, {steps} step{'s' * (steps != 1)}"


def cmd_guide(argv: Sequence[str]) -> int:
    parser = _with_review(argparse.ArgumentParser(prog="xen guide", description="How to write a walkthrough."))
    parser.add_argument("--schema", action="store_true", help="print the plan's JSON Schema instead")
    args = parser.parse_args(argv)
    if args.schema:
        print(render_schema(), end="")
        return 0
    missing: Exception | str = "the review has no saved state"
    try:
        entry: Entry | None = locate(args.review)
    except CommandError as error:
        entry, missing = None, error
    saved = ReviewStore(entry.review_id).load() if entry is not None else None
    repo = Path(saved.repo) if saved is not None else _repository_here()
    try:
        style = config.active_style(repo)
    except config.ConfigError as error:
        raise CommandError(str(error)) from error
    print(RULES)
    print(style_section(style))
    if saved is None:
        print(f"(No hunks listed: {missing})")
        return 0
    print(f"Review {saved.review_id}: {saved.label}")
    print(f"Repository: {saved.repo}")
    print(f"Base: {saved.base}  Head: {saved.head}\n")
    print(hunk_list(changes(Path(saved.repo), saved.base, saved.head)), end="")
    return 0


def _repository_here() -> Path | None:
    try:
        return repository_root(Path())
    except TargetError:
        return None


def cmd_plan(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="xen plan", description="Submit or read the walkthrough plan.")
    sub = parser.add_subparsers(dest="action", required=True)
    submit = _with_review(sub.add_parser("submit", help="submit a whole plan; it replaces the current one"))
    submit.add_argument("file", help="plan JSON file, or - for standard input")
    get = _with_review(sub.add_parser("get", help="print the current plan"))
    get.add_argument("--without-narration", action="store_true", help="with every narration emptied")
    args = parser.parse_args(argv)
    if args.action == "submit":
        document = _read_json(args.file)
        entry = locate(args.review)
        try:
            plan = call(entry, "PUT", "/api/plan", document)
        except ServerError as error:
            raise _rejected("Plan", error) from error
        print(f"Plan accepted: {_plan_summary(plan)}. The reviewer sees it at {entry.viewer_url}")
        with contextlib.suppress(ServerError):
            print(coverage_summary(Coverage.model_validate(call(entry, "GET", "/api/coverage"))))
        return 0
    entry = locate(args.review)
    path = "/api/plan/without-narration" if args.without_narration else "/api/plan"
    try:
        print(json.dumps(call(entry, "GET", path), indent=2))
    except ServerError as error:
        raise CommandError("; ".join(error.problems), status=1) from error
    return 0


def cmd_narration(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="xen narration", description="Replace the walkthrough's narration.")
    sub = parser.add_subparsers(dest="action", required=True)
    submit = _with_review(sub.add_parser("submit", help="submit the plan with new narration and nothing else changed"))
    submit.add_argument("file", help="plan JSON file, or - for standard input")
    args = parser.parse_args(argv)
    document = _read_json(args.file)
    entry = locate(args.review)
    try:
        plan = call(entry, "PUT", "/api/plan/narration", document)
    except ServerError as error:
        raise _rejected("Narration", error) from error
    print(f"Narration accepted: {_plan_summary(plan)}.")
    return 0


_LOCATION = re.compile(r"^(?P<path>.+?):(?P<start>\d+)(?:-(?P<end>\d+))?(?::(?P<c1>\d+)-(?P<c2>\d+))?$")


def show_target(location: str, side: str, expect: str | None) -> dict[str, Any]:
    found = _LOCATION.match(location)
    if found is None:
        raise CommandError(f"{location!r} is not <path>:<start>[-<end>][:<startCol>-<endCol>]")
    start = int(found["start"])
    target: dict[str, Any] = {
        "path": found["path"],
        "side": side,
        "startLine": start,
        "endLine": int(found["end"] or start),
    }
    if found["c1"] is not None:
        target |= {"startCol": int(found["c1"]), "endCol": int(found["c2"])}
    if expect is not None:
        target["expect"] = expect
    return target


def cmd_show(argv: Sequence[str]) -> int:
    parser = _with_review(
        argparse.ArgumentParser(
            prog="xen show",
            description="Point at code, or at an element of a visual, in the reviewer's viewer.",
            epilog="Example: xen show src/app.py:40-52 --form box",
        )
    )
    parser.add_argument("location", nargs="?", help="<path>:<start>[-<end>][:<startCol>-<endCol>]")
    parser.add_argument("--side", choices=["base", "head"], default="head", help="revision (default: head)")
    parser.add_argument("--form", choices=["lines", "box", "circle"], default="lines", help="spotlight form")
    parser.add_argument("--expect", help="text that must occur in the range")
    parser.add_argument("--element", help="<visual>#<element> instead of code")
    args = parser.parse_args(argv)
    if (args.location is None) == (args.element is None):
        parser.error("give a code location or --element, not both")
    if args.element is not None:
        visual, _, element = args.element.partition("#")
        target: dict[str, Any] = {"visual": visual, "element": element}
    else:
        target = show_target(args.location, args.side, args.expect)
    entry = locate(args.review)
    try:
        result = call(entry, "POST", "/api/show", {"target": target, "form": args.form})
    except ServerError as error:
        raise _rejected("Show", error) from error
    if result.get("viewers", 0) == 0:
        print(f"No viewer is open, so the reviewer did not see it. The review is at {entry.viewer_url}")
    else:
        print("Shown in the viewer.")
    return 0


def cmd_step(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="xen step", description="Change the steps of a section.")
    sub = parser.add_subparsers(dest="action", required=True)
    add = _with_review(sub.add_parser("add", help="add one step to a section"))
    add.add_argument("--section", type=int, required=True, help="section number, from 1")
    add.add_argument("--after", type=int, help="insert after this step number (0 = first; default: last)")
    add.add_argument("file", help="step JSON file, or - for standard input")
    args = parser.parse_args(argv)
    step = _read_json(args.file)
    entry = locate(args.review)
    body: dict[str, Any] = {"section": args.section, "step": step}
    if args.after is not None:
        body["after"] = args.after
    try:
        call(entry, "POST", "/api/plan/steps", body)
    except ServerError as error:
        raise _rejected("Step", error) from error
    print(f"Step added to section {args.section}.")
    return 0


def cmd_visual(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="xen visual", description="Change the visuals of a section.")
    sub = parser.add_subparsers(dest="action", required=True)
    add = _with_review(sub.add_parser("add", help="add a visual to a section, or replace the one with its id"))
    add.add_argument("--section", type=int, required=True, help="section number, from 1")
    add.add_argument("file", help="visual JSON file, or - for standard input")
    args = parser.parse_args(argv)
    visual = _read_json(args.file)
    entry = locate(args.review)
    try:
        call(entry, "POST", "/api/plan/visuals", {"section": args.section, "visual": visual})
    except ServerError as error:
        raise _rejected("Visual", error) from error
    print(f"Visual added to section {args.section}.")
    return 0


def cmd_skill(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="xen skill",
        description="The Claude Code skill that teaches a session the xen commands. Sessions xenagos starts load it "
        "by themselves; install it to use xenagos from your own sessions.",
    )
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("path", help="print the plugin folder, for `claude --plugin-dir`")
    install = sub.add_parser("install", help="copy the skill into a Claude Code skills folder")
    install.add_argument("--dir", type=Path, help="skills folder (default: ~/.claude/skills)")
    install.add_argument("--force", action="store_true", help="replace a different skill of the same name")
    args = parser.parse_args(argv)
    plugin = claude.plugin_dir()
    if args.action == "path":
        print(plugin)
        return 0
    source = plugin / "skills" / "xenagos"
    target = (args.dir or Path.home() / ".claude" / "skills") / "xenagos"
    new = (source / "SKILL.md").read_text()
    existing = target / "SKILL.md"
    if existing.is_file() and existing.read_text() == new:
        print(f"The skill is already installed in {target}")
        return 0
    if existing.is_file() and not args.force:
        raise CommandError(f"{target} holds a different xenagos skill; use --force to replace it")
    target.mkdir(parents=True, exist_ok=True)
    existing.write_text(new)
    print(f"Installed the xenagos skill in {target}")
    return 0


COMMANDS: dict[str, Callable[[Sequence[str]], int]] = {
    "list": cmd_list,
    "stop": cmd_stop,
    "open": cmd_open,
    "guide": cmd_guide,
    "plan": cmd_plan,
    "narration": cmd_narration,
    "show": cmd_show,
    "step": cmd_step,
    "visual": cmd_visual,
    "skill": cmd_skill,
    "_serve": cmd_serve_saved,
}


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    command = COMMANDS[args[0]] if args and args[0] in COMMANDS else cmd_review
    rest = args[1:] if args and args[0] in COMMANDS else args
    try:
        return command(rest)
    except CommandError as error:
        name = f"xen {args[0]}" if command is not cmd_review else "xen"
        print(f"{name}: {error}", file=sys.stderr)
        return error.status
