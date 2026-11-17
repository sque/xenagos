import os
import signal
import stat
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.conftest import FixtureRepo, feature_repo
from xenagos import cli, registry
from xenagos.target import resolve


class Server:
    """A `xen` review server running as its own process, reaped as soon as it exits."""

    def __init__(self, repo: Path) -> None:
        self.process = subprocess.Popen(  # noqa: S603
            [sys.executable, "-m", "xenagos", "-C", str(repo), "--no-browser"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        threading.Thread(target=self.process.wait, daemon=True).start()
        self.review_id = resolve(repo).review_id
        self.entry = wait_until_answering(self.review_id)

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)


def wait_until_answering(review_id: str, timeout: float = 15.0) -> registry.Entry:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for entry in registry.find(review_id):
            if registry.answers(entry):
                return entry
        time.sleep(0.05)
    raise AssertionError(f"review {review_id} did not start")


@pytest.fixture
def servers(state_home: Path) -> Iterator[list[Server]]:
    started: list[Server] = []
    yield started
    for server in started:
        server.stop()


def test_two_reviews_run_side_by_side_and_stop_independently(
    servers: list[Server], tmp_path: Path, state_home: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    a = Server(feature_repo(tmp_path / "a").path)
    b = Server(feature_repo(tmp_path / "b").path)
    servers += [a, b]
    assert a.entry.port != b.entry.port

    assert cli.main(["list"]) == 0
    listed = capsys.readouterr().out
    assert a.review_id in listed
    assert b.review_id in listed
    assert "feature against main" in listed

    record = state_home / "xenagos" / "reviews" / f"{b.review_id}.json"
    assert cli.main(["stop", b.review_id[:6]]) == 0
    assert b.process.wait(timeout=10) == 0
    assert not record.exists()
    assert registry.answers(a.entry)
    assert [e.review_id for e in registry.live_entries()] == [a.review_id]


def test_reopening_a_target_presents_the_running_review(servers: list[Server], repo: FixtureRepo) -> None:
    a = Server(repo.path)
    servers.append(a)
    again = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "xenagos", "-C", str(repo.path), "--no-browser"],
        capture_output=True,
        text=True,
        timeout=20,
        check=True,
    )
    assert "Already open" in again.stdout
    assert a.entry.url in again.stdout
    assert len(registry.live_entries()) == 1


def test_a_killed_review_is_cleaned_up(servers: list[Server], repo: FixtureRepo, state_home: Path) -> None:
    a = Server(repo.path)
    servers.append(a)
    record = state_home / "xenagos" / "reviews" / f"{a.review_id}.json"
    assert record.exists()
    os.kill(a.process.pid, signal.SIGKILL)
    a.process.wait(timeout=10)
    assert registry.live_entries() == []
    assert not record.exists()


def test_records_are_private_to_the_user(servers: list[Server], repo: FixtureRepo, state_home: Path) -> None:
    servers.append(Server(repo.path))
    reviews = state_home / "xenagos" / "reviews"
    assert stat.S_IMODE(reviews.stat().st_mode) == 0o700
    (record,) = reviews.glob("*.json")
    assert stat.S_IMODE(record.stat().st_mode) == 0o600


def test_second_claim_for_a_starting_review_gets_the_first(repo: FixtureRepo, state_home: Path) -> None:
    target = resolve(repo.path)
    first = registry.new_entry(target, port=1)  # not answering yet, but within its start-up grace period
    assert registry.claim(first) is None
    second = registry.new_entry(target, port=2)
    assert registry.claim(second) == first


def test_record_of_a_dead_process_is_replaced(repo: FixtureRepo, state_home: Path) -> None:
    target = resolve(repo.path)
    dead = registry.new_entry(target, port=1).model_copy(update={"pid": 2**22 + 12345})
    assert registry.claim(dead) is None
    fresh = registry.new_entry(target, port=2)
    assert registry.claim(fresh) is None
    assert registry.find(target.review_id) == [fresh]


def test_stop_needs_a_review_or_all(state_home: Path) -> None:
    with pytest.raises(SystemExit):
        cli.main(["stop"])
    assert cli.main(["stop", "nothing"]) == 2
