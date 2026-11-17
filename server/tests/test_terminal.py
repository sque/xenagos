import asyncio
import sys
from pathlib import Path

import pytest

from tests.conftest import FakeClaude
from xenagos import claude
from xenagos.terminal import Terminal


async def read_until(terminal: Terminal, text: str, timeout: float = 10.0) -> str:
    seen = b""
    async with asyncio.timeout(timeout):
        while text.encode() not in seen:
            data = await terminal.read()
            if not data:
                break
            seen += data
    return seen.decode(errors="replace")


async def attach(fake_claude: FakeClaude, tmp_path: Path, cols: int = 90, rows: int = 25) -> Terminal:
    fake_claude.add("abcd1234")
    session = claude.resolve("abcd1234")
    return await Terminal.spawn(claude.attach_command(session), tmp_path, claude.child_env(), cols, rows)


def test_program_sees_terminal_size_input_and_resize(fake_claude: FakeClaude, tmp_path: Path) -> None:
    async def scenario() -> None:
        terminal = await attach(fake_claude, tmp_path)
        try:
            assert "attached abcd1234 90x25" in await read_until(terminal, "90x25")
            terminal.write(b"hello\x03")
            assert "got b'hello\\x03'" in await read_until(terminal, "hello")
            # A size change reaches the program as SIGWINCH only on its controlling terminal.
            terminal.resize(120, 40)
            assert "size 120x40" in await read_until(terminal, "120x40")
        finally:
            await terminal.close()
        assert not terminal.running
        assert terminal.process.returncode is not None

    asyncio.run(scenario())


def test_closing_ends_the_program_and_reading_ends(fake_claude: FakeClaude, tmp_path: Path) -> None:
    async def scenario() -> None:
        terminal = await attach(fake_claude, tmp_path)
        await read_until(terminal, "attached")
        await terminal.close()
        assert await terminal.read() == b""
        terminal.write(b"ignored after close")

    asyncio.run(scenario())


def test_program_that_exits_by_itself_ends_the_output(tmp_path: Path) -> None:
    async def scenario() -> None:
        terminal = await Terminal.spawn([sys.executable, "-c", "print('bye')"], tmp_path, claude.child_env(), 80, 24)
        output = b""
        async with asyncio.timeout(10):
            while data := await terminal.read():
                output += data
        assert b"bye" in output
        await terminal.close()

    asyncio.run(scenario())


def test_started_programs_do_not_inherit_the_calling_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "outer")
    monkeypatch.setenv("CLAUDECODE", "1")
    env = claude.child_env()
    assert "CLAUDE_CODE_SESSION_ID" not in env
    assert "CLAUDECODE" not in env
    assert "PATH" in env
