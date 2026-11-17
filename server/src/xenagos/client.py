"""Requests from the `xen` command to a review's server, authenticated with the secret from the registry."""

import json
import urllib.error
import urllib.request
from typing import Any

from xenagos.access import SECRET_HEADER
from xenagos.registry import Entry

TIMEOUT_SECONDS = 60.0


class ServerError(Exception):
    def __init__(self, status: int, detail: Any) -> None:
        super().__init__(f"the review server answered {status}: {detail}")
        self.status = status
        self.detail = detail

    @property
    def problems(self) -> list[str]:
        """The problems a rejection names, or the error message as a single problem."""
        if isinstance(self.detail, dict):
            problems = self.detail.get("problems")
            if isinstance(problems, list):
                return [str(p) for p in problems]
            message = self.detail.get("detail")
            if isinstance(message, str):
                return [message]
            if isinstance(message, list):
                return [_validation_error(e) for e in message]
        return [str(self.detail)]


def call(entry: Entry, method: str, path: str, body: Any = None) -> Any:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(  # noqa: S310 - loopback http only
        entry.url + path.lstrip("/"),
        data=data,
        method=method,
        headers={SECRET_HEADER: entry.secret, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail: Any = json.loads(raw)
        except ValueError:
            detail = raw.decode("utf-8", "replace")
        raise ServerError(error.code, detail) from None


def _validation_error(error: Any) -> str:
    if not isinstance(error, dict):
        return str(error)
    location = ".".join(str(part) for part in error.get("loc", []) if part != "body")
    return f"{location or 'request'}: {error.get('msg', 'invalid')}"
