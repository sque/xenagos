"""The `xen` command.

`xen [target]` opens a review in the foreground. Other commands are named first (`xen list`); a target that has the
same name as a command is given after `--` (`xen -- list`).
"""

import argparse
import socket
import sys
import webbrowser
from collections.abc import Sequence
from pathlib import Path

import uvicorn

from xenagos import __version__
from xenagos.app import bundled_viewer_dir, create_app
from xenagos.target import ReviewTarget, TargetError, resolve

LOOPBACK = "127.0.0.1"


def review_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xen",
        description="Open a review of a code change. With no target: the current branch against the default branch.",
        epilog="Targets: A...B (from the fork point), A..B (directly), REV (one commit), or --base BRANCH.",
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


def serve(target: ReviewTarget, port: int, open_browser: bool) -> None:
    sock = listen_on_loopback(port)
    url = f"http://{LOOPBACK}:{sock.getsockname()[1]}/"
    print(f"Reviewing {target.label} ({target.base[:10]}..{target.head[:10]})", flush=True)
    print(f"Viewer: {url}  (Ctrl+C stops the review)", flush=True)
    if open_browser:
        webbrowser.open(url)
    server = uvicorn.Server(uvicorn.Config(create_app(target, bundled_viewer_dir()), log_level="warning"))
    server.run(sockets=[sock])


def main(argv: Sequence[str] | None = None) -> int:
    args = review_parser().parse_args(argv)
    try:
        target = resolve(args.path, args.target, args.base)
    except TargetError as error:
        print(f"xen: {error}", file=sys.stderr)
        return 2
    serve(target, args.port, open_browser=not args.no_browser)
    return 0
