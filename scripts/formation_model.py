"""Per-diagram formation frequencies learned from the validated daily archive.

The browser uses these counts only to label unknown segments with an estimate;
they never replace a current or planned formation.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from .validation import DIAGRAM_PATTERN, ValidationError

MODEL_FILENAME = "formation-model.json"
METHOD = "diagram-frequency"
MINIMUM_OBSERVED_DAYS = 3
FAMILY_PATTERN = re.compile(r"^([A-Z]+)")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def _families(units: list[str]) -> tuple[str, ...]:
    # Unit numbers rotate daily; the family decides the seating layout.
    return tuple(sorted(FAMILY_PATTERN.match(unit).group(1) for unit in units))


def build_formation_model(root: Path) -> dict[str, Any]:
    """Count each diagram's parsed formation families across archived dates."""
    index_path = root / "history-index.json"
    entries = json.loads(index_path.read_text())["dates"] if index_path.exists() else []
    counts: dict[str, Counter[tuple[str, ...]]] = {}
    dates = []
    for entry in entries:
        bundle = json.loads((root / entry["path"]).read_text())
        dates.append(entry["serviceDate"])
        for assignment in bundle["latest"]["assignments"]:
            if assignment["parseStatus"] != "parsed":
                continue
            counts.setdefault(assignment["diagramId"], Counter())[_families(assignment["currentUnits"])] += 1
    diagrams = []
    for diagram_id in sorted(counts, key=lambda value: int(value[1:])):
        outcomes = sorted(counts[diagram_id].items(), key=lambda item: (-item[1], item[0]))
        diagrams.append({
            "diagramId": diagram_id,
            "observedDays": sum(days for _, days in outcomes),
            "outcomes": [{"families": list(families), "days": days} for families, days in outcomes],
        })
    return {
        "schemaVersion": 1,
        "timeZone": "Asia/Tokyo",
        "method": METHOD,
        "minimumObservedDays": MINIMUM_OBSERVED_DAYS,
        "trainingDates": sorted(dates),
        "diagrams": diagrams,
    }


def validate_formation_model(model: Any) -> None:
    _require(isinstance(model, dict), f"{MODEL_FILENAME} must be an object")
    _require(model.get("schemaVersion") == 1, f"{MODEL_FILENAME} schemaVersion must be 1")
    _require(model.get("timeZone") == "Asia/Tokyo", f"{MODEL_FILENAME} timezone must be Asia/Tokyo")
    _require(model.get("method") == METHOD, f"{MODEL_FILENAME} method is unsupported")
    minimum = model.get("minimumObservedDays")
    _require(isinstance(minimum, int) and not isinstance(minimum, bool) and minimum >= 1, "invalid minimumObservedDays")
    training_dates = model.get("trainingDates")
    _require(isinstance(training_dates, list), "trainingDates must be a list")
    try:
        parsed = [date.fromisoformat(day) for day in training_dates]
    except (TypeError, ValueError) as exc:
        raise ValidationError("trainingDates must be ISO dates") from exc
    _require(parsed == sorted(set(parsed)), "trainingDates must be sorted and unique")
    diagrams = model.get("diagrams")
    _require(isinstance(diagrams, list), "model diagrams must be a list")
    seen: set[str] = set()
    for diagram in diagrams:
        _require(isinstance(diagram, dict), "model diagram must be an object")
        diagram_id = diagram.get("diagramId")
        _require(isinstance(diagram_id, str) and DIAGRAM_PATTERN.fullmatch(diagram_id) is not None, "invalid model diagram id")
        _require(diagram_id not in seen, f"duplicate model diagram {diagram_id}")
        seen.add(diagram_id)
        observed = diagram.get("observedDays")
        _require(isinstance(observed, int) and 1 <= observed <= len(training_dates), "invalid observedDays")
        outcomes = diagram.get("outcomes")
        _require(isinstance(outcomes, list) and outcomes, "model outcomes are required")
        total = 0
        for outcome in outcomes:
            families = outcome.get("families") if isinstance(outcome, dict) else None
            _require(
                isinstance(families, list) and families
                and all(isinstance(family, str) and re.fullmatch(r"[A-Z]+", family) for family in families),
                "invalid model outcome families",
            )
            days = outcome.get("days")
            _require(isinstance(days, int) and not isinstance(days, bool) and days >= 1, "invalid model outcome days")
            total += days
        _require(total == observed, "model outcome days must sum to observedDays")


def validate_model_matches_archive(root: Path) -> None:
    """The published model must be exactly what the published archive produces."""
    path = root / MODEL_FILENAME
    if not (root / "history-index.json").exists():
        return
    _require(path.exists(), f"{MODEL_FILENAME} is missing; run python3 -m scripts.formation_model")
    model = json.loads(path.read_text())
    validate_formation_model(model)
    _require(
        model == build_formation_model(root),
        f"{MODEL_FILENAME} does not match the archive; run python3 -m scripts.formation_model",
    )


def publish_formation_model(root: Path, writer) -> dict[str, Any]:
    model = build_formation_model(root)
    writer(model, root / MODEL_FILENAME, validate_formation_model)
    return model


def main() -> None:
    from .history import validate_archive
    from .update_data import write_json_atomically

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    validate_archive(args.data_dir)
    model = publish_formation_model(args.data_dir, write_json_atomically)
    print(
        f"Wrote {MODEL_FILENAME} from {len(model['trainingDates'])} archived dates "
        f"covering {len(model['diagrams'])} diagrams."
    )


if __name__ == "__main__":
    main()
