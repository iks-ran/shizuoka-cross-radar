import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.formation_model import (
    MODEL_FILENAME,
    build_formation_model,
    validate_formation_model,
    validate_model_matches_archive,
)
from scripts.history import publish_history
from scripts.update_data import write_json_atomically
from scripts.validation import ValidationError


def assignment(diagram_id, units, raw=None):
    return {
        "diagramId": diagram_id,
        "rawFormation": raw or "+".join(units),
        "currentUnits": units,
        "parseStatus": "parsed" if units else "unknown",
    }


class FormationModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 10, 27, 12, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
        self.timetable = json.loads(Path("public/data/timetable.json").read_text())
        self.latest = json.loads(Path("public/data/latest.json").read_text())

    def pair(self, day, assignments):
        timetable, latest = copy.deepcopy(self.timetable), copy.deepcopy(self.latest)
        timetable["serviceDate"] = latest["serviceDate"] = day
        latest["assignments"] = assignments
        return timetable, latest

    def publish(self, pairs):
        publish_history(self.root, pairs, self.now, write_json_atomically)
        return json.loads((self.root / MODEL_FILENAME).read_text())

    def test_counts_family_outcomes_per_diagram_across_archived_dates(self):
        model = self.publish([
            self.pair("2026-10-25", [assignment("A21", ["T5"]), assignment("A143", ["V2"])]),
            self.pair("2026-10-26", [assignment("A21", ["S3"]), assignment("A143", ["V9"]), assignment("A7", ["U1"])]),
            self.pair("2026-10-27", [assignment("A21", ["T8"]), assignment("A143", [], "V?")]),
        ])
        self.assertEqual(model["trainingDates"], ["2026-10-25", "2026-10-26", "2026-10-27"])
        self.assertEqual(model["minimumObservedDays"], 3)
        self.assertEqual(model["diagrams"], [
            {"diagramId": "A7", "observedDays": 1, "outcomes": [{"families": ["U"], "days": 1}]},
            {"diagramId": "A21", "observedDays": 3, "outcomes": [
                {"families": ["T"], "days": 2}, {"families": ["S"], "days": 1},
            ]},
            # The unparsed report on October 27 is not evidence of any family.
            {"diagramId": "A143", "observedDays": 2, "outcomes": [{"families": ["V"], "days": 2}]},
        ])
        validate_model_matches_archive(self.root)

    def test_coupled_units_are_one_order_independent_outcome(self):
        model = self.publish([
            self.pair("2026-10-26", [assignment("A30", ["W4", "K3"])]),
            self.pair("2026-10-27", [assignment("A30", ["K8", "W1"])]),
        ])
        self.assertEqual(model["diagrams"][0]["outcomes"], [{"families": ["K", "W"], "days": 2}])

    def test_model_follows_the_rolling_archive_window(self):
        self.publish([self.pair("2026-09-01", [assignment("A21", ["S3"])])])
        model = self.publish([self.pair("2026-10-27", [assignment("A21", ["T5"])])])
        # September 1 is outside the 30-day window, so its observation is not retained.
        self.assertEqual(model["trainingDates"], ["2026-10-27"])
        self.assertEqual(model["diagrams"][0]["outcomes"], [{"families": ["T"], "days": 1}])

    def test_stale_or_missing_model_fails_archive_consistency(self):
        self.publish([self.pair("2026-10-27", [assignment("A21", ["T5"])])])
        path = self.root / MODEL_FILENAME
        model = json.loads(path.read_text())
        model["diagrams"][0]["outcomes"][0]["families"] = ["S"]
        path.write_text(json.dumps(model))
        with self.assertRaisesRegex(ValidationError, "does not match the archive"):
            validate_model_matches_archive(self.root)
        path.unlink()
        with self.assertRaisesRegex(ValidationError, "missing"):
            validate_model_matches_archive(self.root)

    def test_empty_archive_builds_an_empty_valid_model(self):
        model = build_formation_model(self.root)
        validate_formation_model(model)
        self.assertEqual((model["trainingDates"], model["diagrams"]), ([], []))

    def test_validation_rejects_inconsistent_models(self):
        valid = {
            "schemaVersion": 1, "timeZone": "Asia/Tokyo", "method": "diagram-frequency",
            "minimumObservedDays": 3, "trainingDates": ["2026-10-26", "2026-10-27"],
            "diagrams": [{"diagramId": "A21", "observedDays": 2, "outcomes": [{"families": ["T"], "days": 2}]}],
        }
        validate_formation_model(valid)
        mutations = [
            lambda m: m["diagrams"][0].update(observedDays=3),
            lambda m: m["diagrams"][0]["outcomes"][0].update(days=1),
            lambda m: m["diagrams"][0].update(diagramId="B21"),
            lambda m: m["diagrams"][0]["outcomes"][0].update(families=["t"]),
            lambda m: m["diagrams"].append(copy.deepcopy(m["diagrams"][0])),
            lambda m: m.update(trainingDates=["2026-10-27", "2026-10-26"]),
            lambda m: m.update(method="neural"),
            lambda m: m.update(minimumObservedDays=0),
        ]
        for mutate in mutations:
            model = copy.deepcopy(valid)
            mutate(model)
            with self.assertRaises(ValidationError):
                validate_formation_model(model)

    def test_checked_in_model_matches_checked_in_archive(self):
        validate_model_matches_archive(Path("public/data"))


if __name__ == "__main__":
    unittest.main()
