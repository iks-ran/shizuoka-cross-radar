from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .base import SourceError, build_latest_snapshot


class FixtureFormationSource:
    def __init__(self, fixture_path: Path) -> None:
        self.fixture_path = fixture_path

    def fetch(self, service_date: str | None = None) -> dict[str, Any]:
        del service_date
        try:
            payload = json.loads(self.fixture_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SourceError(f"Unable to read fixture source: {exc}") from exc

        try:
            return build_latest_snapshot(
                service_date=payload["serviceDate"],
                updated_at=payload["updatedAt"],
                source_id="fixture",
                source_label="Bundled demonstration data",
                source_url=None,
                is_mock=True,
                assignments=payload["assignments"],
            )
        except (KeyError, TypeError) as exc:
            raise SourceError(f"Invalid fixture source: {exc}") from exc

