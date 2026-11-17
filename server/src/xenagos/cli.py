"""The `xen` command.

`xen [target]` opens a review in the foreground, or brings up the one already running for the same target. Other
commands are named first (`xen list`); a target with the same name as a command goes after `--` (`xen -- list`).
"""

import argparse
import signal
import socket
import sys
import webbrowser
from collections.abc import Callable, Sequence
from pathlib import Path
from types import FrameType

import uvicorn

from xenagos import __version__, registry
from xenagos.app import bundled_viewer_dir, create_app
from xenagos.registry import LOOPBACK, Entry
from xenagos.target import ReviewTarget, TargetError, resolve


def review_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xen",
        description="Open a review of a code change. With no target: the current branch against the default branch.",
        epilog="Targets: A...B (from the fork point), A..B (directly), REV (one commit), or --base BRANCH. "
        "Other commands: xen list, xen stop.",
    )
    parser.add_argument("--version", action="version", version=f"xen {__version__}")
    parser.add_argument("target", nargs="?", help="what to review; see below")
    parser.add_argument("--base", help="review the current branch against this branch, from their fork point")
    parser.add_argument("-C", dest="path", type=Path, default=Path(), help="repository to review (default: here)")
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


def serve(target: ReviewTarget, port: int, open_browser: bool) -> None:
    """Serve the review in the foreground, or present the server already running for it."""
    sock = listen_on_loopback(port)
    entry = registry.new_entry(target, sock.getsockname()[1])
    existing = registry.claim(entry)
    if existing is not None:
        sock.close()
        print(f"Already open: {existing.label} ({existing.review_id})", flush=True)
        present(existing, open_browser)
        return
    try:
        print(f"Reviewing {target.label} ({target.base[:10]}..{target.head[:10]}), review {target.review_id}")
        present(entry, open_browser)
        print("Ctrl+C stops the review.", flush=True)
        server = uvicorn.Server(
            uvicorn.Config(create_app(target, entry.access, bundled_viewer_dir()), log_level="warning")
        )
        # uvicorn shuts down gracefully on SIGTERM, then raises it again under the handler found before it started.
        # Ending through SystemExit here lets the record be released below.
        signal.signal(signal.SIGTERM, _end_on_terminate)
        server.run(sockets=[sock])
    finally:
        registry.release(entry)


def cmd_review(argv: Sequence[str]) -> int:
    args = review_parser().parse_args(argv)
    try:
        target = resolve(args.path, args.target, args.base)
    except TargetError as error:
        print(f"xen: {error}", file=sys.stderr)
        return 2
    serve(target, args.port, open_browser=not args.no_browser)
    return 0


def cmd_list(argv: Sequence[str]) -> int:
    argparse.ArgumentParser(prog="xen list", description="List open reviews.").parse_args(argv)
    entries = registry.live_entries()
    if not entries:
        print("No open reviews.")
        return 0
    rows = [("REVIEW", "TARGET", "COMMITS", "ADDRESS", "AGENT", "REPOSITORY")]
    rows += [
        (e.review_id, e.label, f"{e.base[:8]}..{e.head[:8]}", e.viewer_url, e.session or "-", e.repo) for e in entries
    ]
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]) - 1)]
    for row in rows:
        print("  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=False)) + "  " + row[-1])
    return 0


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


COMMANDS: dict[str, Callable[[Sequence[str]], int]] = {"list": cmd_list, "stop": cmd_stop}


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] in COMMANDS:
        return COMMANDS[args[0]](args[1:])
    return cmd_review(args)
