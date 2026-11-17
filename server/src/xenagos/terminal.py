"""A program running on a pseudo-terminal, read and written from asyncio (design decision 4a).

The agent pane runs `claude attach` this way: what the program writes goes to the viewer's terminal emulator, and
keystrokes and size changes come back. Closing ends the program (hang-up, then kill), not the session it shows.
"""

import asyncio
import contextlib
import errno
import fcntl
import os
import signal
import struct
import subprocess
import sys
import termios
import time
from collections.abc import Sequence
from pathlib import Path

READ_SIZE = 65536
CLOSE_GRACE_SECONDS = 2.0


class Terminal:
    def __init__(self, process: subprocess.Popen[bytes], master: int) -> None:
        self.process = process
        self._master = master
        self._output: asyncio.Queue[bytes] = asyncio.Queue()
        self._pending = bytearray()
        self._loop = asyncio.get_running_loop()
        self._closed = False
        self.started = time.monotonic()
        self.last_output = self.started
        self._loop.add_reader(master, self._readable)

    @classmethod
    async def spawn(cls, argv: Sequence[str], cwd: Path, env: dict[str, str], cols: int, rows: int) -> "Terminal":
        master, slave = os.openpty()
        try:
            _set_size(master, cols, rows)
            env = {**env, "TERM": "xterm-256color", "COLORTERM": "truecolor"}
            process = subprocess.Popen(  # noqa: S603 - argv chosen by the server
                [sys.executable, "-m", "xenagos.ttyexec", *argv],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                cwd=cwd,
                env=env,
                start_new_session=True,
                close_fds=True,
            )
        except BaseException:
            os.close(master)
            raise
        finally:
            os.close(slave)
        os.set_blocking(master, False)
        return cls(process, master)

    async def read(self) -> bytes:
        """The next output, or b"" once the program has ended and everything was read."""
        return await self._output.get()

    def write(self, data: bytes) -> None:
        if self._closed or not data:
            return
        waiting = bool(self._pending)
        self._pending += data
        if not waiting:
            self._flush()

    def resize(self, cols: int, rows: int) -> None:
        if not self._closed:
            _set_size(self._master, cols, rows)

    @property
    def running(self) -> bool:
        return not self._closed and self.process.poll() is None

    async def close(self) -> None:
        """End the program: hang up, then kill it if it is still there after a grace period."""
        if self._closed:
            return
        self._closed = True
        self._loop.remove_reader(self._master)
        self._loop.remove_writer(self._master)
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(self.process.pid, signal.SIGHUP)
        try:
            await asyncio.wait_for(asyncio.to_thread(self.process.wait), CLOSE_GRACE_SECONDS)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(self.process.pid, signal.SIGKILL)
            await asyncio.to_thread(self.process.wait)
        os.close(self._master)
        self._output.put_nowait(b"")

    def _readable(self) -> None:
        try:
            data = os.read(self._master, READ_SIZE)
        except BlockingIOError:
            return
        except OSError as error:
            # EIO: every process on the terminal has closed it, which is how the end of the program shows.
            if error.errno != errno.EIO:
                raise
            data = b""
        if data:
            self.last_output = time.monotonic()
            self._output.put_nowait(data)
            return
        self._loop.remove_reader(self._master)
        self._output.put_nowait(b"")

    def _flush(self) -> None:
        while self._pending and not self._closed:
            try:
                written = os.write(self._master, self._pending)
            except BlockingIOError:
                break
            del self._pending[:written]
        if self._pending and not self._closed:
            self._loop.add_writer(self._master, self._flush)
        else:
            self._loop.remove_writer(self._master)


def _set_size(fd: int, cols: int, rows: int) -> None:
    cols = max(2, min(cols, 1000))
    rows = max(2, min(rows, 1000))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
