"""Recover actual daily pairs from the repository's collected snapshot history."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .history import publish_history, validate_archive, validate_bundle
from .update_data import write_json_atomically
from .validation import ValidationError


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True,
        text=True, timeout=60,
    ).stdout.strip()


def recover_pairs(repo, ref, today, existing_dates, reader=git):
    if reader(repo, "rev-parse", "--is-shallow-repository") == "true":
        raise RuntimeError("Backfill requires full Git history; fetch the history or use checkout fetch-depth: 0")
    revision = reader(repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    cutoff = (today - timedelta(days=29)).isoformat()
    commits = reader(
        repo, "log", "--first-parent", "--format=%H", f"--since={cutoff}T00:00:00+09:00",
        revision, "--", "public/data/timetable.json", "public/data/latest.json",
    ).splitlines()
    found = set(existing_dates)
    pairs = []
    for commit in commits:
        try:
            latest = json.loads(reader(repo, "show", f"{commit}:public/data/latest.json"))
            day = latest["serviceDate"]
            if not cutoff <= day <= today.isoformat() or day in found:
                continue
            timetable = json.loads(reader(repo, "show", f"{commit}:public/data/timetable.json"))
            validate_bundle({"schemaVersion": 1, "timeZone": "Asia/Tokyo", "timetable": timetable, "latest": latest})
        except (subprocess.CalledProcessError, ValidationError, ValueError, TypeError, KeyError):
            # A commit may predate the schema or contain an incomplete/fixture pair.
            continue
        pairs.append((timetable, latest))
        found.add(day)
    return pairs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--ref", default="HEAD", help="Fetched Git revision to recover, e.g. origin/main")
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    now = datetime.now(ZoneInfo("Asia/Tokyo"))
    validate_archive(args.data_dir)
    index_path = args.data_dir / "history-index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"dates": []}
    existing = {entry["serviceDate"] for entry in index["dates"]}
    pairs = recover_pairs(args.repo, args.ref, now.date(), existing)
    publish_history(args.data_dir, pairs, now, write_json_atomically)
    print(f"Recovered {len(pairs)} historical dates from {args.ref}; existing archived dates preserved.")
    if pairs:
        print("Recovered dates: " + ", ".join(sorted(pair[0]["serviceDate"] for pair in pairs)))


if __name__ == "__main__":
    main()
