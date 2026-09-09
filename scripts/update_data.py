from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .data_sources import (
    CabinetOfficeHolidaySource,
    FixtureFormationSource,
    JrCentralTimetableSource,
    OperationDiagramSource,
    TokaidoShizuokaFormationSource,
)
from .generate_fixture_timetable import generate as generate_fixture_timetable
from .validation import validate_latest, validate_timetable
from .data_sources.base import SourceError
from .history import publish_history, saved_pair


TOKYO = ZoneInfo("Asia/Tokyo")


def write_json_atomically(
    payload: dict[str, Any],
    output: Path,
    validator: Callable[[Any], None],
) -> None:
    validator(payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent, delete=False) as handle:
            temporary_name = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, output)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def write_latest_atomically(payload: dict[str, Any], output: Path) -> None:
    write_json_atomically(payload, output, validate_latest)


def write_timetable_atomically(payload: dict[str, Any], output: Path) -> None:
    write_json_atomically(payload, output, validate_timetable)


def main() -> None:
    parser = argparse.ArgumentParser(description="Update paired static train snapshots")
    parser.add_argument(
        "--source",
        choices=("fixture", "tokaido-shizuoka", "yulog"),
        default="fixture",
        help="Formation source; yulog is a rollout alias for tokaido-shizuoka",
    )
    parser.add_argument("--fixture", type=Path, default=Path("data/fixtures/latest-source.json"))
    parser.add_argument(
        "--corridor",
        type=Path,
        default=Path("data/corridor.json"),
        help="Static corridor station metadata",
    )
    parser.add_argument(
        "--fixture-timetable",
        type=Path,
        default=Path("data/fixtures/timetable-source.json"),
    )
    parser.add_argument("--output", type=Path, default=Path("public/data/latest.json"))
    parser.add_argument("--timetable-output", type=Path, default=Path("public/data/timetable.json"))
    parser.add_argument("--service-date", help="ISO date override, mainly for source verification")
    parser.add_argument("--operation-revision", default="202603", help="Operation source revision in YYYYMM")
    parser.add_argument("--seed-history", action="store_true", help="Archive the saved real pair without network requests")
    args = parser.parse_args()

    now = datetime.now(TOKYO)
    if args.seed_history:
        publish_history(args.output.parent, saved_pair(args.output.parent, args.timetable_output, args.output), now, write_json_atomically)
        return

    target_date = (
        date.fromisoformat(args.service_date)
        if args.service_date
        else datetime.now(TOKYO).date()
    )
    corridor = json.loads(args.corridor.read_text(encoding="utf-8"))

    source = "tokaido-shizuoka" if args.source == "yulog" else args.source
    if args.source == "yulog":
        print(
            "Warning: --source yulog is deprecated; using tokaido-shizuoka without a direct Yulog request.",
            file=sys.stderr,
        )

    if source == "fixture":
        latest = FixtureFormationSource(args.fixture).fetch(args.service_date)
        fixture_timetable = json.loads(args.fixture_timetable.read_text(encoding="utf-8"))
        timetable = generate_fixture_timetable(fixture_timetable)
    else:
        formation_source = TokaidoShizuokaFormationSource()
        timetable_source = JrCentralTimetableSource()
        formation_payload = formation_source.fetch_payload()
        timetable_payload = timetable_source.fetch_payload()
        operation = OperationDiagramSource(args.operation_revision).fetch()
        holidays = CabinetOfficeHolidaySource().fetch()
        pairs = []
        for offset in range(30):
            candidate = target_date - timedelta(days=offset)
            try:
                candidate_latest = formation_source.parse_response(formation_payload, candidate)
                candidate_timetable = timetable_source.parse_checked(
                    timetable_payload, candidate, corridor["stations"], operation, holidays,
                )
            except SourceError as exc:
                print(f"Unavailable {candidate}: {exc}", file=sys.stderr)
                continue
            validate_latest(candidate_latest)
            validate_timetable(candidate_timetable)
            pairs.append((candidate_timetable, candidate_latest))
        if not pairs:
            raise SourceError("No matching valid source dates; preserving published snapshots")
        seed = saved_pair(args.output.parent, args.timetable_output, args.output) if args.output.exists() and args.timetable_output.exists() else []
        publish_history(
            args.output.parent, seed + pairs, datetime.now(TOKYO), write_json_atomically,
            observed_dates={pair[0]["serviceDate"] for pair in pairs} if not args.service_date else (),
        )
        timetable, latest = max(pairs, key=lambda pair: pair[0]["serviceDate"])
        # A delayed source must not replace a newer last-good current pair.
        if seed and seed[0][0]["serviceDate"] > timetable["serviceDate"]:
            return

    # Validate both snapshots before replacing either last-good file.
    validate_latest(latest)
    validate_timetable(timetable)
    write_timetable_atomically(timetable, args.timetable_output)
    write_latest_atomically(latest, args.output)
    print(f"Updated {args.timetable_output} and {args.output} from {source}")


if __name__ == "__main__":
    main()
