from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.generate_fixture_timetable import generate
from scripts.update_data import write_latest_atomically, write_timetable_atomically
from scripts.validation import ValidationError, validate_formations, validate_latest, validate_timetable


ROOT = Path(__file__).resolve().parents[1]


class FixtureGenerationTests(unittest.TestCase):
    def test_generated_timetable_covers_the_corridor(self) -> None:
        source = json.loads((ROOT / "data/fixtures/timetable-source.json").read_text(encoding="utf-8"))
        timetable = generate(source)
        validate_timetable(timetable)
        self.assertEqual(len(timetable["stations"]), 43)
        directions = {service["direction"] for service in timetable["services"]}
        self.assertEqual(directions, {"eastbound", "westbound"})
        covered = {stop["stationId"] for service in timetable["services"] for stop in service["stops"]}
        self.assertEqual(covered, {station["id"] for station in timetable["stations"]})

    def test_checked_in_data_is_valid(self) -> None:
        validate_timetable(json.loads((ROOT / "public/data/timetable.json").read_text(encoding="utf-8")))
        validate_formations(json.loads((ROOT / "public/data/formations.json").read_text(encoding="utf-8")))
        validate_latest(json.loads((ROOT / "public/data/latest.json").read_text(encoding="utf-8")))


class AtomicWriteTests(unittest.TestCase):
    def test_invalid_update_preserves_last_good_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "latest.json"
            target.write_text('{"last":"good"}\n', encoding="utf-8")
            invalid = {"schemaVersion": 1}
            with self.assertRaises(ValidationError):
                write_latest_atomically(invalid, target)
            self.assertEqual(target.read_text(encoding="utf-8"), '{"last":"good"}\n')

    def test_invalid_timetable_update_preserves_last_good_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "timetable.json"
            target.write_text('{"last":"good"}\n', encoding="utf-8")
            with self.assertRaises(ValidationError):
                write_timetable_atomically({"schemaVersion": 1}, target)
            self.assertEqual(target.read_text(encoding="utf-8"), '{"last":"good"}\n')


if __name__ == "__main__":
    unittest.main()
