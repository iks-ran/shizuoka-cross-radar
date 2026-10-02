from __future__ import annotations

import json
import time
import urllib.request
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .base import SourceError, SourceUnavailable, build_latest_snapshot
from .http import read_bytes


CURRENT_ASSIGNMENTS_URL = (
    "https://tokaido-unyo-shizuoka.com/json/unyo/unyo-data-current.json"
)
OPERATION_PAGE_URL = "https://tokaido-unyo-shizuoka.com/unyo/"
TOKYO = ZoneInfo("Asia/Tokyo")


class TokaidoShizuokaFormationSource:
    """Read the dated current-assignment JSON used by the operation page.

    This adapter is opt-in. The source page says that its current assignments
    are populated with Yulog-provided data, so that inherited provenance must
    remain documented even though this adapter does not call Yulog directly.
    """

    def __init__(
        self,
        opener: Callable[..., Any] = urllib.request.urlopen,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._opener = opener
        self._sleeper = sleeper

    def fetch(self, service_date: str | None = None) -> dict[str, Any]:
        target_date = (
            date.fromisoformat(service_date)
            if service_date
            else datetime.now(TOKYO).date()
        )
        return self.parse_response(self.fetch_payload(), target_date)

    def fetch_payload(self) -> dict[str, Any]:
        request = urllib.request.Request(
            CURRENT_ASSIGNMENTS_URL,
            headers={
                "Accept": "application/json",
                "User-Agent": "shizuoka-cross-seat-radar/0.1 (GitHub Actions read-only adapter)",
            },
            method="GET",
        )

        raw = read_bytes(request, "Tokaido Shizuoka assignments", opener=self._opener, sleeper=self._sleeper)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SourceError(f"Invalid Tokaido Shizuoka assignment JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise SourceError("Tokaido Shizuoka assignment response must be an object")
        return payload

    @staticmethod
    def parse_response(payload: Any, target_date: date) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SourceError("Tokaido Shizuoka assignment response must be an object")

        raw_time = payload.get("time")
        if not isinstance(raw_time, str):
            raise SourceError("Tokaido Shizuoka response has no update time")
        try:
            observed = datetime.strptime(raw_time, "%Y/%m/%d_%H:%M:%S").replace(tzinfo=TOKYO)
        except ValueError as exc:
            raise SourceError("Tokaido Shizuoka update time is invalid") from exc

        matching_day: dict[str, Any] | None = None
        for key, candidate in payload.items():
            if key == "time":
                continue
            if not isinstance(candidate, dict):
                raise SourceError("Tokaido Shizuoka dated assignment record must be an object")
            try:
                year = 2000 + int(candidate["year"])
                month, day = (int(part) for part in candidate["date"].split("-", 1))
                candidate_date = date(year, month, day)
            except (KeyError, TypeError, ValueError) as exc:
                raise SourceError("Tokaido Shizuoka assignment service date is invalid") from exc
            if candidate_date == target_date:
                matching_day = candidate
                break

        if matching_day is None:
            raise SourceUnavailable(
                f"No Tokaido Shizuoka assignment map for {target_date.isoformat()}"
            )
        assignments = matching_day.get("train")
        if not isinstance(assignments, dict):
            raise SourceError("Tokaido Shizuoka assignment map must be an object")
        if not assignments:
            raise SourceUnavailable("Tokaido Shizuoka current-day assignment map is empty")
        if any(
            not isinstance(key, str) or not isinstance(value, str)
            for key, value in assignments.items()
        ):
            raise SourceError("Tokaido Shizuoka assignment map contains non-string values")

        return build_latest_snapshot(
            service_date=target_date.isoformat(),
            updated_at=observed.isoformat(),
            source_id="tokaido-shizuoka",
            source_label="Tokaido Line Shizuoka Area Operation Information",
            source_url=OPERATION_PAGE_URL,
            is_mock=False,
            assignments=assignments,
        )
