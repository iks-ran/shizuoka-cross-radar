from __future__ import annotations

import csv
import io
import json
import re
import time
import urllib.request
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .base import SourceError, SourceUnavailable
from .http import read_bytes


JR_CENTRAL_TIMETABLE_URL = (
    "https://traininfo.jr-central.co.jp/zairaisen/data/kobetsujikoku.json"
)
JR_CENTRAL_TIMETABLE_PAGE_URL = (
    "https://traininfo.jr-central.co.jp/zairaisen/train_information.html?line=10001"
)
CABINET_OFFICE_HOLIDAY_URL = (
    "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"
)
TOKAIDO_ATAMI_TOYOHASHI_LINE_ID = "050010"
TOKYO = ZoneInfo("Asia/Tokyo")
DIAGRAM_PREFIX_PATTERN = re.compile(r"^(A\d+)")
TIMESTAMP_PATTERN = re.compile(r"^\d{14}$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3])[0-5]\d$")
# JR Central's Japanese train-type names; anything else is kept as "other".
TRAIN_TYPE_CODES = {
    "普通": "local",
    "快速": "rapid",
    "区間快速": "rapid",
    "新快速": "rapid",
    "特別快速": "rapid",
    "特急": "limited_express",
    "ＨＬ": "home_liner",
    "ホームライナー": "home_liner",
}


def parse_holiday_csv(raw: bytes) -> set[date]:
    text: str
    for encoding in ("shift_jis", "utf-8-sig"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise SourceError("Cabinet Office holiday CSV encoding is unsupported")

    holidays: set[date] = set()
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        try:
            holidays.add(datetime.strptime(row[0].strip(), "%Y/%m/%d").date())
        except ValueError:
            continue
    if not holidays:
        raise SourceError("Cabinet Office holiday CSV is empty")
    return holidays


def is_holiday_day(value: date, holidays: set[date]) -> bool:
    return (
        value.weekday() >= 5
        or value in holidays
        or (value.month, value.day) in {(12, 30), (12, 31), (1, 1), (1, 2), (1, 3)}
    )


def operation_day_matches(day_code: int | None, value: date, holidays: set[date]) -> bool:
    if day_code in (None, 0):
        return True

    previous_holiday = is_holiday_day(value - timedelta(days=1), holidays)
    current_holiday = is_holiday_day(value, holidays)
    next_holiday = is_holiday_day(value + timedelta(days=1), holidays)
    before_holiday = not current_holiday and next_holiday

    rules = {
        1: not current_holiday,
        2: current_holiday,
        3: not current_holiday and value.weekday() == 4,
        4: value.weekday() == 5,
        5: current_holiday and value.weekday() != 5,
        10: before_holiday,
        11: not before_holiday,
        12: current_holiday and not previous_holiday,
        13: current_holiday and not next_holiday,
        14: current_holiday and next_holiday,
        15: current_holiday and not previous_holiday and not next_holiday,
        16: current_holiday and next_holiday,
        17: current_holiday and next_holiday,
        18: current_holiday and next_holiday,
        19: not before_holiday,
        20: current_holiday and previous_holiday,
    }
    return rules.get(day_code, False)


class CabinetOfficeHolidaySource:
    def __init__(
        self,
        opener: Callable[..., Any] = urllib.request.urlopen,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._opener = opener
        self._sleeper = sleeper

    def fetch(self) -> set[date]:
        request = urllib.request.Request(
            CABINET_OFFICE_HOLIDAY_URL,
            headers={
                "Accept": "text/csv,*/*;q=0.8",
                "User-Agent": "shizuoka-cross-seat-radar/0.1 (GitHub Actions read-only adapter)",
            },
            method="GET",
        )
        return parse_holiday_csv(read_bytes(
            request, "Cabinet Office holiday CSV", opener=self._opener, sleeper=self._sleeper,
        ))


def _localized_name(values: Any) -> dict[str, str] | None:
    if not isinstance(values, list):
        return None
    names = {
        item.get("lang"): item.get("name")
        for item in values
        if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"]
    }
    if not all(locale in names for locale in ("ja", "en", "zh-CN")):
        return None
    return {"ja": names["ja"], "en": names["en"], "zhCN": names["zh-CN"]}


def _train_type(values: Any) -> dict[str, Any] | None:
    name = _localized_name(values)
    if name is None:
        return None
    return {"code": TRAIN_TYPE_CODES.get(name["ja"].strip(), "other"), "name": name}


def _clock(value: Any) -> str | None:
    if not isinstance(value, str) or not TIME_PATTERN.fullmatch(value):
        return None
    return f"{value[:2]}:{value[2:]}"


def _clock_minutes(value: str | None) -> int | None:
    if value is None:
        return None
    return int(value[:2]) * 60 + int(value[3:])


def _normalize_diagram(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    match = DIAGRAM_PREFIX_PATTERN.match(value.strip())
    return match.group(1) if match else None


def _matching_operation_rows(
    train_number: str,
    operation: dict[str, Any],
    service_date: date,
    holidays: set[date],
) -> list[dict[str, Any]]:
    rows = operation.get("records")
    if not isinstance(rows, list):
        raise SourceError("Operation diagram records are missing")
    return [
        row
        for row in rows
        if isinstance(row, dict)
        and row.get("train_number") == train_number
        and operation_day_matches(row.get("day_code"), service_date, holidays)
        and _normalize_diagram(row.get("diagram_id")) is not None
    ]


def _transition_metadata(
    train_number: str,
    operation: dict[str, Any],
    service_date: date,
    holidays: set[date],
) -> dict[str, Any] | None:
    rows = operation.get("trains")
    if not isinstance(rows, list):
        raise SourceError("Operation train metadata is missing")
    candidates = [
        row
        for row in rows
        if isinstance(row, dict)
        and row.get("train_number") == train_number
        and operation_day_matches(row.get("day_code"), service_date, holidays)
        and (row.get("attach_station") or row.get("detach_station"))
    ]
    return candidates[0] if candidates else None


def _planned_formations(
    rows: list[dict[str, Any]],
    diagrams: set[str],
) -> list[dict[str, str]]:
    families_by_diagram: dict[str, set[str | None]] = {}
    for row in rows:
        diagram = _normalize_diagram(row.get("diagram_id"))
        if diagram not in diagrams:
            continue
        planned_family = row.get("planned_family")
        families_by_diagram.setdefault(diagram, set()).add(
            planned_family if isinstance(planned_family, str) else None
        )

    planned: list[dict[str, str]] = []
    for diagram in sorted(diagrams):
        candidates = families_by_diagram.get(diagram, set())
        if len(candidates) != 1:
            continue
        family = next(iter(candidates))
        if family is not None:
            planned.append({"diagramId": diagram, "family": family})
    return planned


def _operation_segments(
    train_number: str,
    stops: list[dict[str, Any]],
    station_id_by_ja: dict[str, str],
    operation: dict[str, Any],
    service_date: date,
    holidays: set[date],
) -> list[dict[str, Any]]:
    rows = _matching_operation_rows(train_number, operation, service_date, holidays)
    all_diagrams = {
        diagram
        for row in rows
        if (diagram := _normalize_diagram(row.get("diagram_id"))) is not None
    }
    base_diagrams = {
        diagram
        for row in rows
        if row.get("partner_diagram_id") is None
        and (diagram := _normalize_diagram(row.get("diagram_id"))) is not None
    }
    if not base_diagrams:
        base_diagrams = set(all_diagrams)

    def segment(from_index: int, to_index: int, diagrams: set[str]) -> dict[str, Any]:
        return {
            "fromStationId": stops[from_index]["stationId"],
            "toStationId": stops[to_index]["stationId"],
            "diagramIds": sorted(diagrams),
            "plannedFormations": _planned_formations(rows, diagrams),
        }

    metadata = _transition_metadata(train_number, operation, service_date, holidays)
    if metadata is None:
        return [segment(0, len(stops) - 1, all_diagrams)]

    stop_indexes = {stop["stationId"]: index for index, stop in enumerate(stops)}
    events: list[tuple[int, str]] = []
    for event_type, field in (("detach", "detach_station"), ("attach", "attach_station")):
        station_id = station_id_by_ja.get(metadata.get(field))
        if station_id in stop_indexes:
            events.append((stop_indexes[station_id], event_type))
    events.sort(key=lambda event: (event[0], 0 if event[1] == "detach" else 1))
    if not events:
        return [segment(0, len(stops) - 1, all_diagrams)]

    current = set(all_diagrams) if events[0][1] == "detach" else set(base_diagrams)
    segment_start = 0
    segments: list[dict[str, Any]] = []
    for event_index, event_type in events:
        if event_index > segment_start:
            segments.append(segment(segment_start, event_index - 1, current))
        current = set(base_diagrams) if event_type == "detach" else set(all_diagrams)
        segment_start = event_index
    segments.append(segment(segment_start, len(stops) - 1, current))
    return segments


def _build_stops(
    raw_stops: Iterable[Any],
    station_by_ja: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    selected: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for raw_stop in raw_stops:
        if not isinstance(raw_stop, dict) or raw_stop.get("run_line") != TOKAIDO_ATAMI_TOYOHASHI_LINE_ID:
            continue
        localized = _localized_name(raw_stop.get("station"))
        station = station_by_ja.get(localized["ja"] if localized else "")
        if station is not None:
            selected.append((raw_stop, station))
    if len(selected) < 2:
        return []

    orders = [station["order"] for _, station in selected]
    steps = [right - left for left, right in zip(orders, orders[1:])]
    if not steps or any(step != steps[0] for step in steps) or abs(steps[0]) != 1:
        raise SourceError("JR Central service does not follow contiguous corridor station order")

    result: list[dict[str, Any]] = []
    previous_minutes: int | None = None
    day_offset = 0
    for raw_stop, station in selected:
        if raw_stop.get("stopthroughkbn") == "1":
            arrival = _clock(raw_stop.get("arrivalTime1"))
            departure = _clock(raw_stop.get("departureTime1"))
        else:
            arrival = None
            departure = None
        reference_minutes = _clock_minutes(departure)
        if reference_minutes is None:
            reference_minutes = _clock_minutes(arrival)
        if (
            reference_minutes is not None
            and previous_minutes is not None
            and reference_minutes + day_offset * 1440 < previous_minutes - 720
        ):
            day_offset += 1
        if reference_minutes is not None:
            previous_minutes = reference_minutes + day_offset * 1440
        result.append(
            {
                "stationId": station["id"],
                "arrival": arrival,
                "departure": departure,
                "dayOffset": day_offset,
            }
        )
    return result


class JrCentralTimetableSource:
    def __init__(
        self,
        opener: Callable[..., Any] = urllib.request.urlopen,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._opener = opener
        self._sleeper = sleeper

    def fetch(
        self,
        service_date: date,
        corridor_stations: list[dict[str, Any]],
        operation: dict[str, Any],
        holidays: set[date],
    ) -> dict[str, Any]:
        return self.parse_checked(self.fetch_payload(), service_date, corridor_stations, operation, holidays)

    def fetch_payload(self) -> dict[str, Any]:
        request = urllib.request.Request(
            JR_CENTRAL_TIMETABLE_URL,
            headers={
                "Accept": "application/json",
                "User-Agent": "shizuoka-cross-seat-radar/0.1 (GitHub Actions read-only adapter)",
            },
            method="GET",
        )
        raw = read_bytes(request, "JR Central timetable", opener=self._opener, sleeper=self._sleeper)
        try:
            payload = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SourceError(f"Invalid JR Central timetable JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise SourceError("JR Central timetable response must be an object")
        return payload

    @classmethod
    def parse_checked(cls, payload, service_date, corridor_stations, operation, holidays):
        result = cls.parse_response(payload, service_date, corridor_stations, operation, holidays)
        if len(result["services"]) < 100:
            published_date = datetime.strptime(payload["create_time"], "%Y%m%d%H%M%S").date()
            has_date = any(
                isinstance(service, dict)
                and isinstance(service.get("train_identification_key"), str)
                and service["train_identification_key"].startswith(service_date.strftime("%Y%m%d"))
                for service in payload["train_info"]
            )
            if not has_date or service_date < published_date:
                raise SourceUnavailable(f"No complete JR Central corridor timetable for {service_date}")
            raise SourceError("JR Central corridor timetable coverage is unexpectedly small")
        mapped = sum(bool(service["operationSegments"][0]["diagramIds"]) for service in result["services"])
        if mapped / len(result["services"]) < 0.75:
            raise SourceError("Operation-diagram mapping coverage is unexpectedly low")
        return result

    @staticmethod
    def parse_response(
        payload: Any,
        service_date: date,
        corridor_stations: list[dict[str, Any]],
        operation: dict[str, Any],
        holidays: set[date],
    ) -> dict[str, Any]:
        if isinstance(payload, dict) and str(payload.get("update_flg")) == "0":
            raise SourceUnavailable("JR Central timetable is not currently published")
        if not isinstance(payload, dict) or str(payload.get("update_flg")) != "1":
            raise SourceError("JR Central timetable is unavailable")
        raw_updated_at = payload.get("create_time")
        if not isinstance(raw_updated_at, str) or not TIMESTAMP_PATTERN.fullmatch(raw_updated_at):
            raise SourceError("JR Central timetable update time is invalid")
        raw_services = payload.get("train_info")
        if not isinstance(raw_services, list):
            raise SourceError("JR Central individual-train timetable is missing")

        stations = [dict(station, order=index) for index, station in enumerate(corridor_stations)]
        station_by_ja = {station["name"]["ja"]: station for station in stations}
        station_id_by_ja = {name: station["id"] for name, station in station_by_ja.items()}
        station_order_by_id = {station["id"]: station["order"] for station in stations}
        date_prefix = service_date.strftime("%Y%m%d")
        services: list[dict[str, Any]] = []
        service_by_id: dict[str, dict[str, Any]] = {}
        for raw_service in raw_services:
            if not isinstance(raw_service, dict):
                continue
            train_key = raw_service.get("train_identification_key")
            train_number = raw_service.get("trainnumber")
            if (
                not isinstance(train_key, str)
                or not train_key.startswith(date_prefix)
                or not isinstance(train_number, str)
                or not train_number
            ):
                continue
            raw_stops = raw_service.get("timetable")
            if not isinstance(raw_stops, list):
                continue
            stops = _build_stops(raw_stops, station_by_ja)
            if len(stops) < 2:
                continue
            direction = (
                "eastbound"
                if station_order_by_id[stops[-1]["stationId"]]
                > station_order_by_id[stops[0]["stationId"]]
                else "westbound"
            )
            terminal_name = _localized_name(raw_service.get("terminalStation"))
            if terminal_name is None:
                terminal_station = next(station for station in stations if station["id"] == stops[-1]["stationId"])
                terminal_name = dict(terminal_station["name"])
            safe_train_number = re.sub(r"[^a-z0-9]+", "-", train_number.lower()).strip("-")
            service: dict[str, Any] = {
                "id": f"jrcentral-{train_key}-{safe_train_number}",
                "trainNumber": train_number,
                "destinationStationId": stops[-1]["stationId"],
                "destinationName": terminal_name,
                "direction": direction,
                "serviceDays": ["all"],
                "stops": stops,
                "operationSegments": _operation_segments(
                    train_number,
                    stops,
                    station_id_by_ja,
                    operation,
                    service_date,
                    holidays,
                ),
            }
            train_type = _train_type(raw_service.get("traintype"))
            if train_type is not None:
                service["trainType"] = train_type
            previous = service_by_id.get(service["id"])
            if previous is not None:
                if previous != service:
                    raise SourceError(f"JR Central emitted conflicting service {service['id']}")
                continue
            service_by_id[service["id"]] = service
            services.append(service)

        def departure_sort_key(service: dict[str, Any]) -> tuple[int, str]:
            departure = next(
                (
                    stop["dayOffset"] * 1440 + int(stop["departure"][:2]) * 60 + int(stop["departure"][3:])
                    for stop in service["stops"]
                    if stop["departure"] is not None
                ),
                9999,
            )
            return departure, service["id"]

        services.sort(key=departure_sort_key)
        updated_at = datetime.strptime(raw_updated_at, "%Y%m%d%H%M%S").replace(tzinfo=TOKYO)
        return {
            "schemaVersion": 1,
            "timeZone": "Asia/Tokyo",
            "serviceDate": service_date.isoformat(),
            "updatedAt": updated_at.isoformat(),
            "source": {
                "id": "jr-central",
                "label": "JR Central conventional-line train information",
                "url": JR_CENTRAL_TIMETABLE_PAGE_URL,
                "isMock": False,
            },
            "isFixture": False,
            "stations": stations,
            "services": services,
        }
