"""File locations (design decision 8a). Each follows the XDG base directory variables with their usual fallbacks."""

import os
from pathlib import Path


def _xdg(variable: str, fallback: str) -> Path:
    value = os.environ.get(variable, "")
    base = Path(value) if value and Path(value).is_absolute() else Path.home() / fallback
    return base / "xenagos"


def state_home() -> Path:
    """Records of running reviews."""
    return _xdg("XDG_STATE_HOME", ".local/state")


def data_home() -> Path:
    """Review data and private clones."""
    return _xdg("XDG_DATA_HOME", ".local/share")


def config_home() -> Path:
    """User configuration and styles."""
    return _xdg("XDG_CONFIG_HOME", ".config")


def cache_home() -> Path:
    """Audio cache."""
    return _xdg("XDG_CACHE_HOME", ".cache")
