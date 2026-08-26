from __future__ import annotations

import csv
import io
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Callable

from .base import SourceError


OPERATION_BASE_URL = "https://tokaido-unyo-shizuoka.com/csv/unyo"
OPERATION_PAGE_URL = "https://tokaido-unyo-shizuoka.com/unyo/202603/"
DEFAULT_FAMILIES = ("4cars", "tns313", "ns313", "vl313", "u315", "f373")


@dataclass(frozen=True)
class OperationRecord:
    diagram_id: str
    train_number: str
    position: int | None
    day_code: int | None
    partner_diagram_id: str | None
    route_marker: str | None
    family: str


@dataclass(frozen=True)
class OperationTrainMetadata:
    train_number: str
    departure_station: str | None
    departure_time: str | None
    terminal_station: str | None
    terminal_time: str | None
    detach_station: str | None
    attach_station: str | None
    day_code: int | None


def _optional_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    try:
        return int(value, 0)
    except ValueError:
        return None


def parse_operation_csv(text: str, family: str) -> list[OperationRecord]:
    reader = csv.DictReader(io.StringIO(text))
    required = {"operation_number", "train_number", "position", "day", "koro_mark", "partner"}
    if reader.fieldnames is None or not required.issubset(reader.fieldnames):
        raise SourceError("Operation CSV header is incomplete")

    records: list[OperationRecord] = []
    current_diagram = ""
    for row in reader:
        if row["operation_number"].strip():
            current_diagram = row["operation_number"].strip()
        train_number = row["train_number"].strip()
        if not current_diagram or not train_number:
            continue
        records.append(
            OperationRecord(
                diagram_id=current_diagram,
                train_number=train_number,
                position=_optional_int(row["position"]),
                day_code=_optional_int(row["day"]),
                partner_diagram_id=row["partner"].strip() or None,
                route_marker=row["koro_mark"].strip() or None,
                family=family,
            )
        )
    return records


def parse_train_metadata_csv(text: str) -> list[OperationTrainMetadata]:
    reader = csv.DictReader(io.StringIO(text))
    required = {
        "train_number",
        "depature_station",
        "depsta_time",
        "terminal_station",
        "termsta_time",
        "detach_station",
        "attach_station",
        "day",
    }
    if reader.fieldnames is None or not required.issubset(reader.fieldnames):
        raise SourceError("Operation train metadata CSV header is incomplete")

    records: list[OperationTrainMetadata] = []
    for row in reader:
        train_number = row["train_number"].strip()
        if not train_number:
            continue
        records.append(
            OperationTrainMetadata(
                train_number=train_number,
                departure_station=row["depature_station"].strip() or None,
                departure_time=row["depsta_time"].strip() or None,
                terminal_station=row["terminal_station"].strip() or None,
                terminal_time=row["termsta_time"].strip() or None,
                detach_station=row["detach_station"].strip() or None,
                attach_station=row["attach_station"].strip() or None,
                day_code=_optional_int(row["day"]),
            )
        )
    return records


class OperationDiagramSource:
    """Opt-in reader for the versioned static operation CSV assets."""

    def __init__(
        self,
        revision: str = "202603",
        opener: Callable[..., Any] = urllib.request.urlopen,
    ) -> None:
        if not revision.isdigit() or len(revision) != 6:
            raise ValueError("Operation revision must be YYYYMM")
        self.revision = revision
        self._opener = opener

    def _read(self, url: str) -> str:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "text/csv,*/*;q=0.8",
                "User-Agent": "shizuoka-cross-seat-radar/0.1 (GitHub Actions read-only adapter)",
            },
            method="GET",
        )
        try:
            with self._opener(request, timeout=20) as response:
                return response.read().decode("utf-8-sig")
        except (OSError, urllib.error.URLError, UnicodeDecodeError) as exc:
            raise SourceError(f"Unable to read operation CSV {url}: {exc}") from exc

    def fetch(self, families: tuple[str, ...] = DEFAULT_FAMILIES) -> dict[str, Any]:
        records: list[OperationRecord] = []
        for family in families:
            url = f"{OPERATION_BASE_URL}/{self.revision}/{family}-{self.revision}.csv"
            records.extend(parse_operation_csv(self._read(url), family))

        metadata_url = (
            f"{OPERATION_BASE_URL}/{self.revision}/"
            f"train-number-station-time-{self.revision}.csv"
        )
        trains = parse_train_metadata_csv(self._read(metadata_url))

        return {
            "schemaVersion": 1,
            "revision": self.revision,
            "sourceUrl": OPERATION_PAGE_URL,
            "records": [asdict(record) for record in records],
            "trains": [asdict(train) for train in trains],
        }
