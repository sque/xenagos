"""A stand-in for the `claude` command, for tests. Never starts a real session.

Its sessions and every call made to it are kept in the JSON file named by `XENAGOS_FAKE_CLAUDE_STATE`:
`{"sessions": [...], "calls": [{"argv": [...], "cwd": "..."}], "refuse": null | "message"}`. Sessions use the field
names of `claude agents --json`.

- `agents --json --all` prints the sessions.
- `--bg -n NAME [--permission-mode MODE] PROMPT` adds a running background session, or fails with `refuse`.
- `attach ID` behaves like a full-screen program: raw terminal, prints `attached ID COLSxROWS`, then `got <bytes>` for
  every input it reads and `size COLSxROWS` when the terminal is resized.
"""

import fcntl
import json
import os
import secrets
import signal
import struct
import sys
import termios
import time
import tty
import uuid
from pathlib import Path
from typing import Any

STATE = Path(os.environ["XENAGOS_FAKE_CLAUDE_STATE"])


def update(change: Any) -> Any:
    with STATE.open("r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        state = json.load(f)
        result = change(state)
        f.seek(0)
        f.truncate()
        json.dump(state, f)
    return result


def main(argv: list[str]) -> int:
    update(lambda s: s["calls"].append({"argv": argv, "cwd": str(Path.cwd())}))
    if argv[:1] == ["agents"]:
        print(json.dumps(json.loads(STATE.read_text())["sessions"]))
        return 0
    if argv[:1] == ["--bg"]:
        return start(argv[1:])
    if argv[:1] == ["attach"]:
        return attach(argv[1])
    print(f"fake claude: unknown command {argv}", file=sys.stderr)
    return 2


def start(argv: list[str]) -> int:
    refusal = json.loads(STATE.read_text()).get("refuse")
    if refusal:
        print(refusal, file=sys.stderr)
        return 1
    name = argv[argv.index("-n") + 1]
    short = secrets.token_hex(4)
    session = {
        "pid": os.getpid(),
        "id": short,
        "cwd": str(Path.cwd()),
        "kind": "background",
        "startedAt": int(time.time() * 1000),
        "sessionId": f"{short}{str(uuid.uuid4())[8:]}",
        "name": name,
        "status": "busy",
        "state": "working",
    }
    update(lambda s: s["sessions"].append(session))
    print(f"backgrounded · {short} · {name}")
    print(f"  claude attach {short}    open in this terminal")
    return 0


def attach(short: str) -> int:
    def size() -> str:
        rows, cols, _, _ = struct.unpack("HHHH", fcntl.ioctl(1, termios.TIOCGWINSZ, b"\0" * 8))
        return f"{cols}x{rows}"

    def say(text: str) -> None:
        os.write(1, f"{text}\r\n".encode())

    tty.setraw(0)
    signal.signal(signal.SIGWINCH, lambda signum, frame: say(f"size {size()}"))
    say(f"attached {short} {size()}")
    while data := os.read(0, 4096):
        say(f"got {data!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
