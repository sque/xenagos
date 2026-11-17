"""The `xen` command."""

import argparse
import socket
from collections.abc import Sequence

import uvicorn

from xenagos import __version__
from xenagos.app import bundled_viewer_dir, create_app

LOOPBACK = "127.0.0.1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="xen", description="Walk a reviewer through a code change.")
    parser.add_argument("--version", action="version", version=f"xen {__version__}")
    parser.add_argument("--port", type=int, default=0, help="loopback port to serve on (default: a free one)")
    return parser


def bind_loopback(port: int) -> socket.socket:
    """Bind a listening socket on the loopback address. Port 0 picks a free port with no race."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((LOOPBACK, port))
    return sock


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    sock = bind_loopback(args.port)
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(bundled_viewer_dir()), log_level="warning"))
    print(f"xenagos viewer: http://{LOOPBACK}:{port}/", flush=True)
    server.run(sockets=[sock])
    return 0
