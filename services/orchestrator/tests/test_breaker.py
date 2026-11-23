from sifer_orchestrator.breaker import Breaker


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_opens_after_three_failures() -> None:
    breaker = Breaker(clock=Clock())
    breaker.fail()
    breaker.fail()
    assert breaker.allows()
    breaker.fail()
    assert breaker.open
    assert not breaker.allows()


def test_a_timeout_opens_at_once() -> None:
    breaker = Breaker(clock=Clock())
    breaker.fail(trip=True)
    assert not breaker.allows()


def test_success_resets_the_count() -> None:
    breaker = Breaker(clock=Clock())
    breaker.fail()
    breaker.fail()
    breaker.succeed()
    breaker.fail()
    breaker.fail()
    assert breaker.allows()


def test_allows_one_probe_after_the_cooldown() -> None:
    clock = Clock()
    breaker = Breaker(clock=clock)
    breaker.fail(trip=True)
    clock.now += 29.9
    assert not breaker.allows()
    clock.now += 0.1
    assert breaker.allows()
    breaker.fail()
    assert not breaker.allows()
    clock.now += 30
    breaker.succeed()
    assert not breaker.open
