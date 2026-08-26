from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .validation import validate_timetable


def _clock(total_minutes: int) -> tuple[str, int]:
    return f"{(total_minutes // 60) % 24:02d}:{total_minutes % 60:02d}", total_minutes // 1440


def _create_service(
    stations: list[dict[str, Any]],
    segment_minutes: list[int],
    start_index: int,
    end_index: int,
    start_minutes: int,
    diagram_id: str,
    sequence: int,
) -> dict[str, Any]:
    step = 1 if end_index > start_index else -1
    direction = "eastbound" if step == 1 else "westbound"
    indices = list(range(start_index, end_index + step, step))
    cursor = start_minutes
    stops: list[dict[str, Any]] = []

    for position, station_index in enumerate(indices):
        arrival: str | None = None
        departure: str | None = None
        if position == 0:
            departure, day_offset = _clock(cursor)
        else:
            previous_index = indices[position - 1]
            segment_index = min(previous_index, station_index)
            cursor += segment_minutes[segment_index]
            arrival, day_offset = _clock(cursor)
            if position < len(indices) - 1:
                cursor += 1
                departure, _ = _clock(cursor)

        stops.append(
            {
                "stationId": stations[station_index]["id"],
                "arrival": arrival,
                "departure": departure,
                "dayOffset": day_offset,
            }
        )

    prefix = "E" if direction == "eastbound" else "W"
    clock, _ = _clock(start_minutes)
    service_id = f"demo-{prefix.lower()}-{clock.replace(':', '')}-{sequence:02d}"
    return {
        "id": service_id,
        "trainNumber": f"DEMO-{prefix}{clock.replace(':', '')}-{sequence:02d}",
        "destinationStationId": stations[end_index]["id"],
        "destinationName": dict(stations[end_index]["name"]),
        "direction": direction,
        "serviceDays": ["all"],
        "stops": stops,
        "operationSegments": [
            {
                "fromStationId": stations[start_index]["id"],
                "toStationId": stations[end_index]["id"],
                "diagramIds": [diagram_id],
                "plannedFormations": [],
            }
        ],
    }


def generate(source: dict[str, Any]) -> dict[str, Any]:
    stations = [dict(station, order=index) for index, station in enumerate(source["stations"])]
    segment_minutes = source["segmentMinutes"]
    if len(segment_minutes) != len(stations) - 1:
        raise ValueError("segmentMinutes must have one entry per station gap")

    services: list[dict[str, Any]] = []
    sequence = 1
    for direction, start_index, end_index in (
        ("eastbound", 0, len(stations) - 1),
        ("westbound", len(stations) - 1, 0),
    ):
        del direction
        for start, diagram in zip(source["serviceStarts"], source["diagramCycle"], strict=True):
            services.append(
                _create_service(stations, segment_minutes, start_index, end_index, start, diagram, sequence)
            )
            sequence += 1

    station_indexes = {station["id"]: index for index, station in enumerate(stations)}
    for short_turn in source["shortTurns"]:
        for start, diagram in zip(short_turn["starts"], short_turn["diagrams"], strict=True):
            services.append(
                _create_service(
                    stations,
                    segment_minutes,
                    station_indexes[short_turn["from"]],
                    station_indexes[short_turn["to"]],
                    start,
                    diagram,
                    sequence,
                )
            )
            sequence += 1

    services.sort(key=lambda item: (item["stops"][0]["dayOffset"], item["stops"][0]["departure"], item["id"]))
    result = {
        "schemaVersion": 1,
        "timeZone": "Asia/Tokyo",
        "serviceDate": None,
        "updatedAt": None,
        "source": {
            "id": "fixture",
            "label": "Fixture timetable",
            "url": None,
            "isMock": True,
        },
        "isFixture": True,
        "stations": stations,
        "services": services,
    }
    validate_timetable(result)
    return result


def write_atomically(data: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent, delete=False) as handle:
            temporary_name = handle.name
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, output)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate fixture timetable JSON")
    parser.add_argument("--source", type=Path, default=Path("data/fixtures/timetable-source.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/timetable.json"))
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    write_atomically(generate(source), args.output)
    print(f"Generated {args.output}")


if __name__ == "__main__":
    main()
