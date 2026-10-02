"""Commit validated generated files and retry a temporary GitHub push failure."""
from __future__ import annotations

import subprocess
import time
from typing import Callable


def push_with_retries(runner: Callable = subprocess.run, sleeper: Callable = time.sleep) -> None:
    for attempt in range(3):
        try:
            runner(["git", "push"], check=True, timeout=60)
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            delay = (5, 15)[attempt]
            print(f"Push failed; retrying the same commit in {delay} seconds.", flush=True)
            sleeper(delay)


def main() -> None:
    changes = subprocess.run(
        ["git", "status", "--porcelain", "--", "public/data"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    if not changes:
        print("No generated-data changes")
        return
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
    subprocess.run([
        "git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com",
    ], check=True)
    subprocess.run(["git", "add", "public/data"], check=True)
    subprocess.run(["git", "commit", "-m", "data: update current train snapshots"], check=True)
    push_with_retries()


if __name__ == "__main__":
    main()
