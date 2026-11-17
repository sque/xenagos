"""Messages from the server to open viewers, and whether any viewer is open (spec: review-session, "Idle instances
end themselves").

Each open viewer holds one events WebSocket. Agent commands arrive as ordinary requests, which FastAPI runs on worker
threads, so `publish` may be called from any thread.
"""

import asyncio
import time
from typing import Any


class Events:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue[dict[str, Any]]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.started = time.monotonic()
        self.ever_opened = False
        self.last_left: float | None = None

    @property
    def viewers(self) -> int:
        return len(self._queues)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        self._loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues.add(queue)
        self.ever_opened = True
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._queues.discard(queue)
        if not self._queues:
            self.last_left = time.monotonic()

    def publish(self, event: dict[str, Any]) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._deliver(event)
        else:
            loop.call_soon_threadsafe(self._deliver, event)

    def _deliver(self, event: dict[str, Any]) -> None:
        for queue in list(self._queues):
            queue.put_nowait(event)

    def idle_for(self, now: float) -> float:
        """Seconds without a viewer: since the last one left, or since the start if none ever came."""
        if self._queues:
            return 0.0
        return now - (self.last_left if self.last_left is not None else self.started)
