"""Run a program with its standard input as its controlling terminal: `python -m xenagos.ttyexec PROGRAM [ARGS]`.

The caller starts this in a new session with a pseudo-terminal as standard input, output and error. Taking the
terminal as the controlling one makes the kernel tell the program when the terminal is resized (SIGWINCH), which a
full-screen program such as Claude Code needs. Doing it here rather than in a `preexec_fn` keeps the server free of
code that runs between fork and exec in a threaded process.
"""

import fcntl
import os
import sys
import termios


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: python -m xenagos.ttyexec PROGRAM [ARGS]")
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.execvp(sys.argv[1], sys.argv[1:])  # noqa: S606 - runs the program the server chose


if __name__ == "__main__":
    main()
