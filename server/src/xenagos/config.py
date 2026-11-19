"""Settings and narration styles (spec: configuration; design decisions 6 and 8a).

Settings come from built-in defaults, then the user's `config.toml` under the XDG configuration home, then the
reviewed repository's `.xenagos/config.toml`, merged key by key, the repository winning. Every file is checked against
the same schema on its own, so an unknown or misspelled setting, or a bad value, is reported with its file and name
instead of being ignored. Nothing is cached: settings and styles are read on each use, so an edit applies to the next
review, guide or submitted plan with nothing restarted.

A narration style is a folder holding `style.md` (the narrator's voice, with examples, given to the agent in the
guide) and `limits.toml` (checked when narration is submitted). It is looked up in the repository's
`.xenagos/styles/<name>/`, then the user's `styles/<name>/`, then the styles built into xenagos.
"""

import hashlib
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    PositiveInt,
    StringConstraints,
    ValidationError,
    field_validator,
)

from xenagos.paths import config_home

PermissionMode = Literal["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"]
"""The modes `claude --permission-mode` accepts (Claude Code 2.1.326)."""
STYLE_NAME = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"


class ConfigError(Exception):
    """Configuration that cannot be used; the message names the file and the setting."""


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SessionSettings(_Section):
    name: str = Field(default="review {repo} {branch}", min_length=1)
    """Template for the name of a session xenagos starts: {repo}, {branch} and {review} are filled in."""
    permission_mode: PermissionMode | None = None
    """None leaves Claude Code's own default."""

    @field_validator("name")
    @classmethod
    def _known_fields(cls, value: str) -> str:
        unknown = set(re.findall(r"{([^{}]*)}", value)) - {"repo", "branch", "review"}
        if unknown:
            raise ValueError(f"the template may use {{repo}}, {{branch}} and {{review}}, not {{{sorted(unknown)[0]}}}")
        return value


class NarrationSettings(_Section):
    style: str = Field(default="default", pattern=STYLE_NAME)


VOICE_PLACEHOLDERS = ("output", "voice", "speed", "rate")
VOICE_NAME = r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,63}$"
"""A voice name the menu may send to the command: no characters a program could read as options or syntax."""


class VoiceSettings(_Section):
    enabled: bool = True
    provider: Literal["browser", "command"] = "browser"
    name: str | None = None
    speed: PositiveFloat = 1.0
    command: list[str] | None = Field(default=None, min_length=1)
    """For the `command` provider: the program and its arguments, run without a shell, with the narration on standard
    input. It writes the audio to {output}; {voice} is `name`, {speed} is `speed`, {rate} is `speed` in words a minute
    (175 at speed 1), for macOS `say -r`."""
    off_machine: bool = False
    """Set when the command sends narration text off this machine; the viewer says so before the first use."""
    choices: list[Annotated[str, StringConstraints(pattern=VOICE_NAME)]] = Field(default_factory=list)
    """Voice names of the command that the narration menu offers, beside the browser's own voices, so the reviewer
    can switch between them while listening."""

    @field_validator("command")
    @classmethod
    def _command_fields(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        used = {name for part in value for name in re.findall(r"{([^{}]*)}", part)}
        unknown = used - set(VOICE_PLACEHOLDERS)
        if unknown:
            allowed = ", ".join(f"{{{name}}}" for name in VOICE_PLACEHOLDERS)
            raise ValueError(f"the command may use {allowed}, not {{{sorted(unknown)[0]}}}")
        if "output" not in used:
            raise ValueError("the command must write its audio to {output}")
        return value


class Settings(_Section):
    agent_open: Literal["window", "link"] = "window"
    """Whether a review an agent opens is shown in a browser window, or only its link is given."""
    idle_minutes: PositiveInt = 30
    unopened_hours: PositiveInt = 24
    session: SessionSettings = SessionSettings()
    narration: NarrationSettings = NarrationSettings()
    voice: VoiceSettings = VoiceSettings()


def user_file() -> Path:
    return config_home() / "config.toml"


def repo_file(repo: Path) -> Path:
    return repo / ".xenagos" / "config.toml"


def load(repo: Path | None = None) -> Settings:
    """The settings for a review of `repo` (or user-wide ones), read now."""
    merged: dict[str, Any] = {}
    for path in [user_file(), *([repo_file(repo)] if repo is not None else [])]:
        layer = _read(path)
        if layer is not None:
            _check(path, layer)
            merged = _merge(merged, layer)
    settings = Settings.model_validate(merged)
    if settings.voice.provider == "command" and settings.voice.command is None:
        raise ConfigError('voice.command: must be set when voice.provider is "command"')
    if settings.voice.choices and settings.voice.command is None:
        raise ConfigError("voice.choices: needs voice.command, the program that speaks them")
    return settings


def _read(path: Path) -> dict[str, Any] | None:
    try:
        text = path.read_text()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ConfigError(f"{path}: cannot be read: {error.strerror}") from error
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{path}: is not valid TOML: {error}") from error


def _check(path: Path, layer: dict[str, Any]) -> None:
    try:
        Settings.model_validate(layer)
    except ValidationError as error:
        problems = []
        for e in error.errors():
            name = ".".join(str(part) for part in e["loc"])
            message = "is not a setting xenagos knows" if e["type"] == "extra_forbidden" else e["msg"]
            problems.append(f"{path}: {name}: {message}")
        raise ConfigError("\n".join(problems)) from error


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


# Styles


class Limits(_Section):
    max_sentences_per_step: PositiveInt | None = None
    max_words_per_step: PositiveInt | None = None
    max_steps_per_section: PositiveInt | None = None
    forbid: list[str] = Field(default_factory=list, description="Patterns that must not appear in narration.")

    @field_validator("forbid")
    @classmethod
    def _patterns(cls, values: list[str]) -> list[str]:
        for value in values:
            try:
                re.compile(value)
            except re.error as error:
                raise ValueError(f"{value!r} is not a valid pattern: {error}") from error
        return values


@dataclass(frozen=True)
class Style:
    name: str
    text: str
    """The narrator's voice, given to the agent in the guide."""
    limits: Limits
    hash: str
    """Of `style.md` and `limits.toml` together, recorded on a plan narrated with this style."""
    folder: Path | None


def builtin_styles() -> Path:
    return Path(__file__).with_name("styles")


def style_folders(repo: Path | None) -> list[Path]:
    folders = [config_home() / "styles", builtin_styles()]
    return [repo / ".xenagos" / "styles", *folders] if repo is not None else folders


def load_style(name: str, repo: Path | None = None) -> Style:
    if not re.match(STYLE_NAME, name):
        raise ConfigError(f"narration style {name!r} is not a valid style name")
    for root in style_folders(repo):
        folder = root / name
        if (folder / "style.md").is_file():
            return _style(name, folder)
    places = ", ".join(str(root) for root in style_folders(repo))
    raise ConfigError(f"narration style {name!r} was not found in {places}")


def active_style(repo: Path | None = None) -> Style:
    return load_style(load(repo).narration.style, repo)


def _style(name: str, folder: Path) -> Style:
    text = (folder / "style.md").read_text()
    limits_path = folder / "limits.toml"
    raw = limits_path.read_text() if limits_path.is_file() else ""
    try:
        limits = Limits.model_validate(tomllib.loads(raw))
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{limits_path}: is not valid TOML: {error}") from error
    except ValidationError as error:
        problems = [
            f"{limits_path}: {'.'.join(str(p) for p in e['loc'])}: "
            + ("is not a limit xenagos knows" if e["type"] == "extra_forbidden" else e["msg"])
            for e in error.errors()
        ]
        raise ConfigError("\n".join(problems)) from error
    digest = hashlib.sha256(text.encode() + b"\0" + raw.encode()).hexdigest()[:12]
    return Style(name=name, text=text, limits=limits, hash=digest, folder=folder)
