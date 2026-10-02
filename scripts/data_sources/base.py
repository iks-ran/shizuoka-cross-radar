from __future__ import annotations

import re
from typing import Any, Protocol


UNIT_PATTERN = re.compile(r"^[A-Z]{1,4}\d{1,3}$")
DIAGRAM_PATTERN = re.compile(r"^A\d{1,3}$")


class SourceError(RuntimeError):
    """Raised when a source cannot return a trustworthy snapshot."""


class SourceUnavailable(SourceError):
    """A valid source response has no published data for the requested date."""


class FormationSource(Protocol):
    def fetch(self, service_date: str | None = None) -> dict[str, Any]: ...


def normalize_assignment(raw: str) -> tuple[list[str], str]:
    """Return current units and a parse status, preserving malformed raw input."""
    if not isinstance(raw, str) or not raw.strip():
        return [], "unknown"

    current = raw.strip().split("→")[-1].replace(" ", "")
    units = re.split(r"[+/]", current)
    if not units or any(not UNIT_PATTERN.fullmatch(unit) for unit in units):
        return [], "unknown"
    return units, "parsed"


def build_latest_snapshot(
    *,
    service_date: str,
    updated_at: str,
    source_id: str,
    source_label: str,
    source_url: str | None,
    is_mock: bool,
    assignments: dict[str, str],
) -> dict[str, Any]:
    normalized = []
    for diagram_id, raw in sorted(assignments.items()):
        if not DIAGRAM_PATTERN.fullmatch(diagram_id):
            continue
        units, parse_status = normalize_assignment(raw)
        normalized.append(
            {
                "diagramId": diagram_id,
                "rawFormation": raw,
                "currentUnits": units,
                "parseStatus": parse_status,
            }
        )

    return {
        "schemaVersion": 1,
        "timeZone": "Asia/Tokyo",
        "serviceDate": service_date,
        "updatedAt": updated_at,
        "source": {
            "id": source_id,
            "label": source_label,
            "url": source_url,
            "isMock": is_mock,
        },
        "assignments": normalized,
    }
