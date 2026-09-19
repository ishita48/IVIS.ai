"""Per-session event bus. In-memory: one process, one venue, one weekend."""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

_QUEUES: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _QUEUES[session_id].append(q)
    return q


def unsubscribe(session_id: str, q: asyncio.Queue) -> None:
    if q in _QUEUES[session_id]:
        _QUEUES[session_id].remove(q)


async def publish(session_id: str, event: str, data: Any) -> None:
    payload = {"event": event, "data": json.dumps(data, default=str)}
    for q in list(_QUEUES[session_id]):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # a slow tab must not stall the demo
