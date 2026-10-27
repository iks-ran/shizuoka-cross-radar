"""Validated, immutable daily bundles; the index is the publication boundary."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from .formation_model import publish_formation_model
from .validation import ValidationError, validate_latest, validate_timetable


def validate_bundle(bundle):
    if bundle.get("schemaVersion") != 1 or bundle.get("timeZone") != "Asia/Tokyo":
        raise ValidationError("Unsupported history bundle")
    validate_timetable(bundle.get("timetable"))
    validate_latest(bundle.get("latest"))
    if (bundle["timetable"]["serviceDate"] != bundle["latest"]["serviceDate"]
            or bundle["timetable"]["isFixture"] or bundle["latest"]["source"]["isMock"]):
        raise ValidationError("History requires a matching real snapshot pair")


def validate_index(index):
    if index.get("schemaVersion") != 1 or index.get("timeZone") != "Asia/Tokyo" or not isinstance(index.get("dates"), list):
        raise ValidationError("Unsupported history index")
    seen = set()
    for entry in index["dates"]:
        day = date.fromisoformat(entry["serviceDate"])
        if day in seen or not re.fullmatch(r"history/" + day.isoformat() + r"-[a-f0-9]{16}\.json", entry["path"]):
            raise ValidationError("Invalid history entry")
        seen.add(day)
        observed = entry.get("firstObservedAt")
        if observed is not None:
            from zoneinfo import ZoneInfo
            stamp = datetime.fromisoformat(observed)
            if stamp.tzinfo is None or stamp.astimezone(ZoneInfo("Asia/Tokyo")).date() != day:
                raise ValidationError("Invalid first observation date")


def validate_archive(root):
    index_path = root / "history-index.json"
    if not index_path.exists():
        return
    index = json.loads(index_path.read_text())
    validate_index(index)
    for entry in index["dates"]:
        bundle = json.loads((root / entry["path"]).read_text())
        validate_bundle(bundle)
        if bundle["timetable"]["serviceDate"] != entry["serviceDate"]:
            raise ValidationError("History index date mismatch")


def publish_history(root, pairs, now, writer, observed_dates=()):
    """Stage all validation before writing; publish references only after bundles exist."""
    validate_archive(root)
    path = root / "history-index.json"
    previous = json.loads(path.read_text()) if path.exists() else {"dates": []}
    today = now.date()
    cutoff = today - timedelta(days=29)
    entries = {e["serviceDate"]: e for e in previous["dates"] if cutoff.isoformat() <= e["serviceDate"] <= today.isoformat()}
    bundles = []
    for timetable, latest in pairs:
        bundle = {"schemaVersion": 1, "timeZone": "Asia/Tokyo", "timetable": timetable, "latest": latest}
        validate_bundle(bundle)
        day = timetable["serviceDate"]
        if not cutoff.isoformat() <= day <= today.isoformat():
            continue
        digest = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).hexdigest()[:16]
        filename = f"history/{day}-{digest}.json"
        old = entries.get(day, {})
        first = old.get("firstObservedAt")
        if first is None and day in observed_dates and day == today.isoformat():
            first = now.isoformat()
        entries[day] = {"serviceDate": day, "path": filename, "firstObservedAt": first}
        bundles.append((bundle, root / filename))
    index = {"schemaVersion": 1, "timeZone": "Asia/Tokyo", "dates": sorted(entries.values(), key=lambda e: e["serviceDate"], reverse=True)}
    validate_index(index)
    for bundle, output in bundles:
        writer(bundle, output, validate_bundle)
    writer(index, path, validate_index)
    # Only delete files previously owned by this archive, after publication succeeds.
    referenced = {e["path"] for e in index["dates"]}
    for entry in previous["dates"]:
        if entry["path"] not in referenced:
            (root / entry["path"]).unlink(missing_ok=True)
    # The prediction model is derived from exactly the published archive.
    publish_formation_model(root, writer)


def saved_pair(root, timetable_path=None, latest_path=None):
    timetable = json.loads((timetable_path or root / "timetable.json").read_text())
    latest = json.loads((latest_path or root / "latest.json").read_text())
    if timetable["isFixture"] or latest["source"]["isMock"] or timetable["serviceDate"] != latest["serviceDate"]:
        return []
    return [(timetable, latest)]
