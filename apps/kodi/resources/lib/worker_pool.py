"""Small bounded daemon worker pool with a time-bounded shutdown."""

from __future__ import annotations

import queue
import threading
import time
from typing import Any, Callable, Tuple


WorkItem = Tuple[Callable[..., Any], tuple, dict]


class BoundedWorkerPool:
    def __init__(
        self,
        maximum_workers: int,
        name_prefix: str,
        queue_capacity: int = 64,
    ) -> None:
        if maximum_workers < 1 or queue_capacity < maximum_workers:
            raise ValueError("Worker pool bounds are invalid")
        self._queue = queue.Queue(maxsize=queue_capacity)
        self._stopping = threading.Event()
        self._threads = tuple(
            threading.Thread(
                target=self._run,
                name=f"{name_prefix}-{index + 1}",
                daemon=True,
            )
            for index in range(maximum_workers)
        )
        for thread in self._threads:
            thread.start()

    def submit(self, function: Callable[..., Any], *arguments: Any) -> bool:
        if self._stopping.is_set():
            return False
        try:
            self._queue.put_nowait((function, arguments, {}))
        except queue.Full:
            return False
        return True

    def shutdown(self, join_timeout: float = 1.0) -> int:
        self._stopping.set()
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        for _ in self._threads:
            try:
                self._queue.put_nowait(None)
            except queue.Full:
                break
        deadline = time.monotonic() + max(0.0, join_timeout)
        for thread in self._threads:
            remaining = max(0.0, deadline - time.monotonic())
            if remaining <= 0:
                break
            thread.join(remaining)
        return sum(1 for thread in self._threads if thread.is_alive())

    def _run(self) -> None:
        while True:
            try:
                item = self._queue.get(timeout=0.1)
            except queue.Empty:
                if self._stopping.is_set():
                    return
                continue
            if item is None:
                return
            if self._stopping.is_set():
                continue
            function, arguments, keywords = item
            function(*arguments, **keywords)
