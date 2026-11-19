import json
import shutil
import struct
import sys
from pathlib import Path

import pytest

from tests.conftest import FixtureRepo
from tests.test_app import client
from xenagos import config
from xenagos.config import ConfigError, VoiceSettings
from xenagos.target import resolve
from xenagos.voice import VoiceError, audio_cache, media_type, speak

FAKE_VOICE = """
import json, struct, sys
output, voice, speed, rate, log = sys.argv[1:6]
text = sys.stdin.read()
with open(log, "a") as f:
    f.write(json.dumps({"text": text, "voice": voice, "speed": speed, "rate": rate}) + "\\n")
if text.startswith("FAIL"):
    sys.stderr.write("could not load the model\\n")
    sys.exit(3)
if text.startswith("SILENT"):
    sys.exit(0)
if text.startswith("AIFF"):
    open(output, "wb").write(b"FORM\\0\\0\\0\\x10AIFFCOMM")
    sys.exit(0)
data = text.encode()
header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 8000, 1, 8)
open(output, "wb").write(header + b"data" + struct.pack("<I", len(data)) + data)
"""


@pytest.fixture
def fake(tmp_path: Path) -> tuple[VoiceSettings, Path]:
    script = tmp_path / "fake_voice.py"
    script.write_text(FAKE_VOICE)
    log = tmp_path / "voice.log"
    command = [sys.executable, str(script), "{output}", "{voice}", "{speed}", "{rate}", str(log)]
    return VoiceSettings(provider="command", command=command, name="Ava"), log


def calls(log: Path) -> list[dict[str, str]]:
    return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []


def test_command_gets_the_narration_and_its_audio_is_cached(fake: tuple[VoiceSettings, Path]) -> None:
    settings, log = fake
    first = speak(settings, "I wrapped the call so a failure ends only its batch.")
    assert (first.media_type, first.cached) == ("audio/wav", False)
    assert first.data.endswith(b"I wrapped the call so a failure ends only its batch.")
    assert calls(log) == [
        {"text": "I wrapped the call so a failure ends only its batch.", "voice": "Ava", "speed": "1", "rate": "175"}
    ]
    again = speak(settings, "I wrapped the call so a failure ends only its batch.")
    assert (again.data, again.cached) == (first.data, True)
    assert len(calls(log)) == 1
    assert [p.suffix for p in audio_cache().iterdir()] == [".wav"]


def test_voice_and_speed_are_part_of_the_cache_key(fake: tuple[VoiceSettings, Path]) -> None:
    settings, log = fake
    speak(settings, "Same words.")
    speak(settings, "Same words.", speed=1.2)
    speak(settings, "Same words.", voice="Zoe")
    speak(settings, "Same words.", voice="Zoe")
    runs = [(c["voice"], c["speed"], c["rate"]) for c in calls(log)]
    assert runs == [("Ava", "1", "175"), ("Ava", "1.2", "210"), ("Zoe", "1", "175")]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("FAIL now", "the voice command failed with status 3: could not load the model"),
        ("SILENT", "the voice command wrote no audio to {output}"),
        ("AIFF please", "the voice command wrote AIFF audio, which Chromium cannot play"),
    ],
)
def test_failures_are_explained_and_not_cached(fake: tuple[VoiceSettings, Path], text: str, message: str) -> None:
    settings, log = fake
    with pytest.raises(VoiceError, match=message.replace("{", r"\{").replace("}", r"\}")):
        speak(settings, text)
    with pytest.raises(VoiceError):
        speak(settings, text)
    assert len(calls(log)) == 2
    assert not [p for p in audio_cache().glob("*") if p.is_file()]


def test_missing_program_and_missing_voice_name(tmp_path: Path) -> None:
    with pytest.raises(VoiceError, match="'no-such-voice-program' was not found"):
        speak(VoiceSettings(provider="command", command=["no-such-voice-program", "{output}"]), "Hello.")
    with pytest.raises(VoiceError, match=r"voice\.name is not set"):
        speak(VoiceSettings(provider="command", command=["say", "-v", "{voice}", "-o", "{output}"]), "Hello.")


def test_media_types() -> None:
    assert media_type(b"OggS" + b"\0" * 8) == "audio/ogg"
    assert media_type(b"ID3\x04" + b"\0" * 8) == "audio/mpeg"
    assert media_type(b"\0\0\0\x18ftypM4A ") == "audio/mp4"
    assert media_type(b"fLaC" + b"\0" * 8) == "audio/flac"
    with pytest.raises(VoiceError, match="no audio xenagos recognises"):
        media_type(b"<html>")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def test_command_setting_is_checked(repo: FixtureRepo) -> None:
    write(config.user_file(), '[voice]\nprovider = "command"\ncommand = ["say", "-o", "{out}"]\n')
    with pytest.raises(ConfigError, match=r"voice.command: .*not \{out\}"):
        config.load()
    write(config.user_file(), '[voice]\ncommand = ["say", "-v", "{voice}"]\n')
    with pytest.raises(ConfigError, match=r"voice.command: .*must write its audio to \{output\}"):
        config.load()
    write(config.user_file(), '[voice]\nprovider = "command"\n')
    with pytest.raises(ConfigError, match=r'voice\.command: must be set when voice\.provider is "command"'):
        config.load()


def test_repository_picks_the_provider_and_the_user_gives_the_command(repo: FixtureRepo) -> None:
    write(config.user_file(), '[voice]\ncommand = ["piper", "--output_file", "{output}"]\noff_machine = false\n')
    write(repo.path / ".xenagos" / "config.toml", '[voice]\nprovider = "command"\n')
    voice = config.load(repo.path).voice
    assert (voice.provider, voice.command) == ("command", ["piper", "--output_file", "{output}"])


def test_voice_endpoint(repo: FixtureRepo, fake: tuple[VoiceSettings, Path]) -> None:
    settings, _ = fake
    command = json.dumps(settings.command)
    write(config.user_file(), f'[voice]\nprovider = "command"\nname = "Ava"\noff_machine = true\ncommand = {command}\n')
    viewer = client(resolve(repo.path))
    assert viewer.get("/api/review").json()["voice"] == {
        "enabled": True,
        "provider": "command",
        "name": "Ava",
        "speed": 1.0,
        "offMachine": True,
        "command": True,
        "choices": [],
    }
    response = viewer.post("/api/voice", json={"text": "Look here.", "speed": 1.5})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["x-xenagos-cached"] == "no"
    assert response.content.endswith(b"Look here.")
    assert viewer.post("/api/voice", json={"text": "Look here.", "speed": 1.5}).headers["x-xenagos-cached"] == "yes"
    failed = viewer.post("/api/voice", json={"text": "FAIL"})
    assert failed.status_code == 502
    assert failed.json()["detail"] == "the voice command failed with status 3: could not load the model"


def test_command_voices_are_offered_beside_the_browser_voice(
    repo: FixtureRepo, fake: tuple[VoiceSettings, Path]
) -> None:
    """The menu can offer the command's voices while the browser speaks by default, and each request names its voice."""
    settings, _ = fake
    command = json.dumps(settings.command)
    write(config.user_file(), f'[voice]\nchoices = ["af_heart", "bm_george"]\ncommand = {command}\n')
    viewer = client(resolve(repo.path))
    info = viewer.get("/api/review").json()["voice"]
    assert (info["provider"], info["command"], info["choices"]) == ("browser", True, ["af_heart", "bm_george"])
    response = viewer.post("/api/voice", json={"text": "Look here.", "voice": "bm_george"})
    assert response.status_code == 200
    assert response.content.endswith(b"Look here.")


def test_voice_choices_need_a_command(repo: FixtureRepo) -> None:
    write(config.user_file(), '[voice]\nchoices = ["af_heart"]\n')
    with pytest.raises(ConfigError, match=r"voice\.choices: needs voice\.command"):
        config.load()
    write(config.user_file(), '[voice]\nchoices = ["af heart; rm"]\ncommand = ["say", "-o", "{output}"]\n')
    with pytest.raises(ConfigError, match=r"voice\.choices"):
        config.load()


@pytest.mark.skipif(sys.platform != "darwin" or shutil.which("say") is None, reason="macOS say only")
def test_macos_say_example_writes_wav() -> None:
    """The example in the configuration documentation: macOS `say` with no install."""
    settings = VoiceSettings(
        provider="command", command=["say", "-r", "{rate}", "-o", "{output}", "--data-format=LEI16@22050"]
    )
    audio = speak(settings, "The loop goes on.")
    assert audio.media_type == "audio/wav"
    fmt = audio.data.index(b"fmt ")
    (channels, rate) = struct.unpack("<HI", audio.data[fmt + 10 : fmt + 16])
    assert (channels, rate) == (1, 22050)
    assert len(audio.data) > 22050  # more than half a second of 16-bit audio
