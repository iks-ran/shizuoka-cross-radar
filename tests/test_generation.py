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
        self.assertTrue(
            all(
                segment["plannedFormations"] == []
                for service in timetable["services"]
                for segment in service["operationSegments"]
            )
        )

    def test_rejects_planned_formation_for_another_diagram(self) -> None:
        source = json.loads((ROOT / "data/fixtures/timetable-source.json").read_text(encoding="utf-8"))
        timetable = generate(source)
        segment = timetable["services"][0]["operationSegments"][0]
        segment["plannedFormations"] = [{"diagramId": "A999", "family": "U"}]

        with self.assertRaisesRegex(ValidationError, "unknown diagram"):
            validate_timetable(timetable)

    def test_train_type_is_optional_but_validated_when_present(self) -> None:
        source = json.loads((ROOT / "data/fixtures/timetable-source.json").read_text(encoding="utf-8"))
        timetable = generate(source)
        service = timetable["services"][0]
        self.assertNotIn("trainType", service)
        validate_timetable(timetable)
        service["trainType"] = {"code": "limited_express", "name": {"ja": "特急", "en": "Ltd. Exp.", "zhCN": "Ltd. Exp."}}
        validate_timetable(timetable)
        for invalid in ({"code": "express", "name": service["trainType"]["name"]}, {"code": "local", "name": {"ja": "普通"}}, None):
            service["trainType"] = invalid
            with self.assertRaisesRegex(ValidationError, "train type"):
                validate_timetable(timetable)

    def test_reclining_layout_is_valid_formation_metadata(self) -> None:
        formations = json.loads((ROOT / "public/data/formations.json").read_text(encoding="utf-8"))
        family = next(item for item in formations["formations"] if item["family"] == "F")
        self.assertEqual((family["layout"], family["carCount"], family["crossSeatCarCount"], family["verified"]), ("reclining", 3, 3, True))
        self.assertTrue(family["evidenceUrl"].startswith("https://tokaido-unyo-shizuoka.com/"))
        family["layout"] = "sofa"
        with self.assertRaisesRegex(ValidationError, "layout"):
            validate_formations(formations)

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
