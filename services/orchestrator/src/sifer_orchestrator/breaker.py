import time
from collections.abc import Callable

FAILURE_THRESHOLD = 3
COOLDOWN_S = 30.0


class Breaker:
    def __init__(
        self,
        threshold: int = FAILURE_THRESHOLD,
        cooldown_s: float = COOLDOWN_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._cooldown_s = cooldown_s
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None

    @property
    def open(self) -> bool:
        return self._opened_at is not None

    def allows(self) -> bool:
        return self._opened_at is None or self._clock() - self._opened_at >= self._cooldown_s

    def succeed(self) -> None:
        self._failures = 0
        self._opened_at = None

    def fail(self, *, trip: bool = False) -> None:
        self._failures += 1
        if trip or self._opened_at is not None or self._failures >= self._threshold:
            self._opened_at = self._clock()
