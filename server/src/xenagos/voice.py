"""The `command` voice provider (spec: walkthrough-narration, "Voice is pluggable"; design decision 6).

A user-configured program receives a step's narration on standard input and writes audio to a file. The audio is
cached under the XDG cache home by a hash of the text and everything that changes how it sounds (provider, command,
voice, speed), so a step is spoken once and replayed from the cache. The `browser` provider runs in the viewer.
"""

import hashlib
import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from xenagos.config import VoiceSettings
from xenagos.paths import cache_home

TIMEOUT_SECONDS = 120.0
WORDS_PER_MINUTE = 175
"""macOS `say` speaks about this many words a minute at its default rate; {rate} is this times the speed."""

_EXTENSIONS = {"audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/flac": "flac", "audio/mp4": "m4a"}


class VoiceError(Exception):
    """The voice produced no usable audio; the message says why, for the reviewer."""


@dataclass(frozen=True)
class Audio:
    data: bytes
    media_type: str
    cached: bool


def audio_cache() -> Path:
    return cache_home() / "audio"


def media_type(data: bytes) -> str:
    """The audio format, from the file's first bytes."""
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"fLaC":
        return "audio/flac"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data[:4] == b"FORM" and data[8:12] in (b"AIFF", b"AIFC"):
        raise VoiceError(
            "the voice command wrote AIFF audio, which Chromium cannot play; ask it for WAV "
            "(for macOS say: --data-format=LEI16@22050 and an output file ending in .wav)"
        )
    raise VoiceError("the voice command wrote no audio xenagos recognises (WAV, MP3, Ogg, FLAC or MP4)")


def cache_key(settings: VoiceSettings, text: str, voice: str | None, speed: float) -> str:
    material = json.dumps([text, settings.provider, settings.command, voice, speed], ensure_ascii=False)
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def speak(settings: VoiceSettings, text: str, voice: str | None = None, speed: float | None = None) -> Audio:
    """Audio for `text` from the configured command, from the cache when it was made before."""
    if settings.command is None:
        raise VoiceError("no voice command is configured; the viewer speaks with the browser's voice")
    voice = voice if voice is not None else settings.name
    speed = speed if speed is not None else settings.speed
    folder = audio_cache()
    key = cache_key(settings, text, voice, speed)
    for found in folder.glob(f"{key}.*"):
        data = found.read_bytes()
        return Audio(data, media_type(data), cached=True)
    folder.mkdir(parents=True, exist_ok=True)
    data = _run(settings.command, text, voice, speed, folder)
    kind = media_type(data)
    final = folder / f"{key}.{_EXTENSIONS[kind]}"
    with tempfile.NamedTemporaryFile(dir=folder, delete=False, suffix=".part") as part:
        part.write(data)
    Path(part.name).replace(final)
    return Audio(data, kind, cached=False)


def _run(command: list[str], text: str, voice: str | None, speed: float, folder: Path) -> bytes:
    if any("{voice}" in part for part in command) and voice is None:
        raise VoiceError("the voice command uses {voice}, but voice.name is not set")
    with tempfile.TemporaryDirectory(dir=folder) as work:
        output = Path(work) / "narration.wav"
        values = {
            "output": str(output),
            "voice": voice or "",
            "speed": f"{speed:g}",
            "rate": str(round(WORDS_PER_MINUTE * speed)),
        }
        argv = [_fill(part, values) for part in command]
        try:
            result = subprocess.run(  # noqa: S603 - the user's own configured command, without a shell
                argv, input=text.encode(), capture_output=True, timeout=TIMEOUT_SECONDS, check=False
            )
        except FileNotFoundError as error:
            raise VoiceError(f"the voice command {argv[0]!r} was not found") from error
        except subprocess.TimeoutExpired as error:
            raise VoiceError(f"the voice command took longer than {TIMEOUT_SECONDS:g} seconds") from error
        if result.returncode != 0:
            detail = result.stderr.decode(errors="replace").strip().splitlines()
            last = f": {detail[-1]}" if detail else ""
            raise VoiceError(f"the voice command failed with status {result.returncode}{last}")
        if not output.is_file() or output.stat().st_size == 0:
            raise VoiceError("the voice command wrote no audio to {output}")
        return output.read_bytes()


def _fill(part: str, values: dict[str, str]) -> str:
    for name, value in values.items():
        part = part.replace(f"{{{name}}}", value)
    return part
