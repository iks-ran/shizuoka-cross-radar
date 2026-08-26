from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .data_sources import FixtureFormationSource, YulogFormationSource
from .validation import validate_latest


def write_latest_atomically(payload: dict[str, Any], output: Path) -> None:
    validate_latest(payload)
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Update the current-day formation snapshot")
    parser.add_argument("--source", choices=("fixture", "yulog"), default="fixture")
    parser.add_argument("--fixture", type=Path, default=Path("data/fixtures/latest-source.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/latest.json"))
    parser.add_argument("--service-date", help="ISO date override, mainly for source verification")
    args = parser.parse_args()

    source = FixtureFormationSource(args.fixture) if args.source == "fixture" else YulogFormationSource()
    payload = source.fetch(args.service_date)
    write_latest_atomically(payload, args.output)
    print(f"Updated {args.output} from {args.source}")


if __name__ == "__main__":
    main()

