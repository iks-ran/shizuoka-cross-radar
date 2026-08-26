from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable


ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]*$")
UNIT_PATTERN = re.compile(r"^[A-Z]{1,4}\d{1,3}$")
DIAGRAM_PATTERN = re.compile(r"^A\d{1,3}$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class ValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def validate_latest(data: Any) -> None:
    _require(isinstance(data, dict), "latest.json must be an object")
    _require(data.get("schemaVersion") == 1, "latest.json schemaVersion must be 1")
    _require(data.get("timeZone") == "Asia/Tokyo", "latest.json timezone must be Asia/Tokyo")
    try:
        date.fromisoformat(data["serviceDate"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError("latest.json serviceDate is invalid") from exc
    try:
        updated = datetime.fromisoformat(data["updatedAt"])
        _require(updated.tzinfo is not None, "latest.json updatedAt must include an offset")
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError("latest.json updatedAt is invalid") from exc

    source = data.get("source")
    _require(isinstance(source, dict), "latest.json source must be an object")
    _require(isinstance(source.get("id"), str) and source["id"], "latest.json source id is required")
    _require(isinstance(source.get("label"), str) and source["label"], "latest.json source label is required")
    _require(isinstance(source.get("isMock"), bool), "latest.json source isMock must be boolean")
    _require(source.get("url") is None or isinstance(source.get("url"), str), "latest.json source URL is invalid")

    assignments = data.get("assignments")
    _require(isinstance(assignments, list), "latest.json assignments must be a list")
    seen: set[str] = set()
    for assignment in assignments:
        _require(isinstance(assignment, dict), "latest.json assignment must be an object")
        diagram_id = assignment.get("diagramId")
        _require(isinstance(diagram_id, str) and DIAGRAM_PATTERN.fullmatch(diagram_id) is not None, "invalid diagram id")
        _require(diagram_id not in seen, f"duplicate diagram id {diagram_id}")
        seen.add(diagram_id)
        _require(isinstance(assignment.get("rawFormation"), str), "rawFormation must be a string")
        units = assignment.get("currentUnits")
        _require(isinstance(units, list), "currentUnits must be a list")
        _require(all(isinstance(unit, str) and UNIT_PATTERN.fullmatch(unit) for unit in units), "invalid formation unit")
        _require(assignment.get("parseStatus") in {"parsed", "unknown"}, "invalid parseStatus")
        _require(bool(units) == (assignment.get("parseStatus") == "parsed"), "parseStatus does not match currentUnits")


def validate_formations(data: Any) -> None:
    _require(isinstance(data, dict), "formations.json must be an object")
    _require(data.get("schemaVersion") == 1, "formations.json schemaVersion must be 1")
    _require(data.get("timeZone") == "Asia/Tokyo", "formations.json timezone must be Asia/Tokyo")
    definitions = data.get("formations")
    _require(isinstance(definitions, list) and definitions, "formations.json definitions are required")
    seen: set[str] = set()
    for definition in definitions:
        _require(isinstance(definition, dict), "formation definition must be an object")
        family = definition.get("family")
        _require(isinstance(family, str) and re.fullmatch(r"[A-Z]+", family) is not None, "invalid formation family")
        _require(family not in seen, f"duplicate formation family {family}")
        seen.add(family)
        _require(definition.get("layout") in {"convertible", "box_fixed", "longitudinal", "unknown"}, "invalid layout")
        _require(isinstance(definition.get("verified"), bool), "verified must be boolean")
        for key in ("carCount", "crossSeatCarCount"):
            value = definition.get(key)
            _require(value is None or isinstance(value, int) and value >= 0, f"invalid {key}")


def validate_timetable(data: Any) -> None:
    _require(isinstance(data, dict), "timetable.json must be an object")
    _require(data.get("schemaVersion") == 1, "timetable.json schemaVersion must be 1")
    _require(data.get("timeZone") == "Asia/Tokyo", "timetable.json timezone must be Asia/Tokyo")
    is_fixture = data.get("isFixture")
    _require(isinstance(is_fixture, bool), "timetable.json isFixture must be boolean")
    service_date = data.get("serviceDate")
    updated_at = data.get("updatedAt")
    if is_fixture:
        _require(service_date is None, "fixture timetable serviceDate must be null")
        _require(updated_at is None, "fixture timetable updatedAt must be null")
    else:
        try:
            date.fromisoformat(service_date)
        except (TypeError, ValueError) as exc:
            raise ValidationError("live timetable serviceDate is invalid") from exc
        try:
            updated = datetime.fromisoformat(updated_at)
            _require(updated.tzinfo is not None, "live timetable updatedAt must include an offset")
        except (TypeError, ValueError) as exc:
            raise ValidationError("live timetable updatedAt is invalid") from exc

    source = data.get("source")
    _require(isinstance(source, dict), "timetable source must be an object")
    _require(isinstance(source.get("id"), str) and source["id"], "timetable source id is required")
    _require(isinstance(source.get("label"), str) and source["label"], "timetable source label is required")
    _require(source.get("url") is None or isinstance(source.get("url"), str), "timetable source URL is invalid")
    _require(source.get("isMock") is is_fixture, "timetable source mock status is inconsistent")
    stations = data.get("stations")
    _require(isinstance(stations, list) and len(stations) >= 2, "timetable stations are required")
    station_ids: list[str] = []
    for index, station in enumerate(stations):
        _require(isinstance(station, dict), "station must be an object")
        station_id = station.get("id")
        _require(isinstance(station_id, str) and ID_PATTERN.fullmatch(station_id) is not None, "invalid station id")
        _require(station_id not in station_ids, f"duplicate station id {station_id}")
        station_ids.append(station_id)
        _require(station.get("order") == index, "station order must be contiguous")
        names = station.get("name")
        _require(isinstance(names, dict) and all(isinstance(names.get(locale), str) and names[locale] for locale in ("ja", "en", "zhCN")), "station names are incomplete")

    services = data.get("services")
    _require(isinstance(services, list) and services, "timetable services are required")
    service_ids: set[str] = set()
    for service in services:
        _require(isinstance(service, dict), "service must be an object")
        service_id = service.get("id")
        _require(isinstance(service_id, str) and service_id not in service_ids, "invalid or duplicate service id")
        service_ids.add(service_id)
        _require(service.get("direction") in {"eastbound", "westbound"}, "invalid service direction")
        _require(service.get("destinationStationId") in station_ids, "invalid destination station")
        destination_name = service.get("destinationName")
        _require(
            isinstance(destination_name, dict)
            and all(
                isinstance(destination_name.get(locale), str) and destination_name[locale]
                for locale in ("ja", "en", "zhCN")
            ),
            "service destination name is incomplete",
        )
        stops = service.get("stops")
        _require(isinstance(stops, list) and len(stops) >= 2, "service needs at least two stops")
        previous_order: int | None = None
        for stop in stops:
            _require(stop.get("stationId") in station_ids, "service stop references unknown station")
            for field in ("arrival", "departure"):
                value = stop.get(field)
                _require(value is None or isinstance(value, str) and TIME_PATTERN.fullmatch(value), f"invalid stop {field}")
            _require(isinstance(stop.get("dayOffset"), int) and stop["dayOffset"] >= 0, "invalid dayOffset")
            order = station_ids.index(stop["stationId"])
            if previous_order is not None:
                expected = 1 if service["direction"] == "eastbound" else -1
                _require(order - previous_order == expected, "service stops must follow station order")
            previous_order = order
        segments = service.get("operationSegments")
        _require(isinstance(segments, list) and segments, "service operation segments are required")
        for segment in segments:
            _require(segment.get("fromStationId") in station_ids and segment.get("toStationId") in station_ids, "invalid operation segment range")
            diagram_ids = segment.get("diagramIds")
            _require(isinstance(diagram_ids, list), "operation segment diagramIds must be a list")
            _require(all(isinstance(item, str) and DIAGRAM_PATTERN.fullmatch(item) for item in diagram_ids), "invalid segment diagram id")


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Unable to read {path}: {exc}") from exc


def validate_file(path: Path, validator: Callable[[Any], None]) -> None:
    validator(_load(path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate generated static data")
    parser.add_argument("--timetable", type=Path, default=Path("public/data/timetable.json"))
    parser.add_argument("--formations", type=Path, default=Path("public/data/formations.json"))
    parser.add_argument("--latest", type=Path, default=Path("public/data/latest.json"))
    args = parser.parse_args()
    validate_file(args.timetable, validate_timetable)
    validate_file(args.formations, validate_formations)
    validate_file(args.latest, validate_latest)
    print("Static data validation passed")


if __name__ == "__main__":
    main()
