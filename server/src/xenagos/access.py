"""Who may reach a review server (spec: review-session, "Access is local and secret-bound"; design decision 9).

A request is let through only when all of these hold:

- its `Host` is this server's loopback address, which stops pages that rebind a domain name to 127.0.0.1;
- its `Origin`, when it has one, is this server, which stops pages of other sites, including sandboxed frames;
- it carries this server's secret: in the review's cookie (the viewer), or in a header (the `xen` command).

One exception: files under `/visual-assets/` are served without the secret. They are copies of public libraries
(Mermaid) that a visual loads from its sandboxed frame, whose origin is opaque, so the browser sends no cookie.

The address given to the user carries the secret as `?secret=`. The first request with it gets the cookie and is
redirected to the same address without it. Cookies are shared by every port of a host, so each review's cookie is
named after the review.
"""

import hmac
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode

from starlette.datastructures import Headers
from starlette.requests import HTTPConnection
from starlette.responses import PlainTextResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocketClose

SECRET_HEADER = "X-Xenagos-Secret"  # noqa: S105 - a header name, not a secret
SECRET_PARAM = "secret"  # noqa: S105 - a query parameter name, not a secret
PUBLIC = "/visual-assets/"
REFUSED = "Refused. Open the address that `xen` printed for this review; it carries the review's secret."


@dataclass(frozen=True)
class Access:
    review_id: str
    port: int
    secret: str

    @property
    def cookie(self) -> str:
        return f"xenagos_{self.review_id}"

    @property
    def hosts(self) -> frozenset[str]:
        return frozenset({f"127.0.0.1:{self.port}", f"localhost:{self.port}"})

    @property
    def origins(self) -> frozenset[str]:
        return frozenset(f"http://{host}" for host in self.hosts)

    def matches(self, candidate: str | None) -> bool:
        return candidate is not None and hmac.compare_digest(candidate.encode(), self.secret.encode())


class AccessControl:
    """ASGI middleware enforcing `Access` on every HTTP request and WebSocket."""

    def __init__(self, app: ASGIApp, access: Access) -> None:
        self.app = app
        self.access = access

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        connection = HTTPConnection(scope)
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        public = scope["type"] == "http" and scope["method"] in ("GET", "HEAD") and scope["path"].startswith(PUBLIC)
        # A sandboxed visual frame sends `Origin: null`; public files are given to it like to anyone on this machine.
        foreign = origin is not None and origin not in self.access.origins and not public
        if headers.get("host") not in self.access.hosts or foreign:
            await self._refuse(scope, receive, send)
            return
        if (
            public
            or self.access.matches(headers.get(SECRET_HEADER))
            or self.access.matches(connection.cookies.get(self.access.cookie))
        ):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "http" and scope["method"] in ("GET", "HEAD"):
            query = parse_qsl(scope["query_string"].decode("latin-1"), keep_blank_values=True)
            given = [value for key, value in query if key == SECRET_PARAM]
            if len(given) == 1 and self.access.matches(given[0]):
                await self._exchange(scope, query, receive, send)
                return
        await self._refuse(scope, receive, send)

    async def _exchange(self, scope: Scope, query: list[tuple[str, str]], receive: Receive, send: Send) -> None:
        rest = urlencode([(key, value) for key, value in query if key != SECRET_PARAM])
        response = RedirectResponse(scope["path"] + (f"?{rest}" if rest else ""), status_code=303)
        response.set_cookie(self.access.cookie, self.access.secret, httponly=True, samesite="strict", path="/")
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        await response(scope, receive, send)

    async def _refuse(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await WebSocketClose(code=1008)(scope, receive, send)
            return
        response: Response = PlainTextResponse(REFUSED, status_code=403)
        await response(scope, receive, send)
