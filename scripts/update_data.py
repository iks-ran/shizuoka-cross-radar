from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .data_sources import (
    CabinetOfficeHolidaySource,
    FixtureFormationSource,
    JrCentralTimetableSource,
    OperationDiagramSource,
    YulogFormationSource,
)
from .generate_fixture_timetable import generate as generate_fixture_timetable
from .validation import validate_latest, validate_timetable


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
    parser.add_argument("--source", choices=("fixture", "yulog"), default="fixture")
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
    args = parser.parse_args()

    target_date = (
        date.fromisoformat(args.service_date)
        if args.service_date
        else datetime.now(TOKYO).date()
    )
    corridor = json.loads(args.corridor.read_text(encoding="utf-8"))

    if args.source == "fixture":
        latest = FixtureFormationSource(args.fixture).fetch(args.service_date)
        fixture_timetable = json.loads(args.fixture_timetable.read_text(encoding="utf-8"))
        timetable = generate_fixture_timetable(fixture_timetable)
    else:
        latest = YulogFormationSource().fetch(target_date.isoformat())
        operation = OperationDiagramSource(args.operation_revision).fetch()
        holidays = CabinetOfficeHolidaySource().fetch()
        timetable = JrCentralTimetableSource().fetch(
            target_date,
            corridor["stations"],
            operation,
            holidays,
        )

    # Validate both snapshots before replacing either last-good file.
    validate_latest(latest)
    validate_timetable(timetable)
    write_timetable_atomically(timetable, args.timetable_output)
    write_latest_atomically(latest, args.output)
    print(f"Updated {args.timetable_output} and {args.output} from {args.source}")


if __name__ == "__main__":
    main()
