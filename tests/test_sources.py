from __future__ import annotations

import json
import unittest
from datetime import date
from pathlib import Path

from scripts.data_sources.base import normalize_assignment
from scripts.data_sources.operation_diagram import parse_operation_csv
from scripts.data_sources.yulog import YulogFormationSource


ROOT = Path(__file__).resolve().parents[1]


class AssignmentTests(unittest.TestCase):
    def test_uses_rightmost_changed_assignment(self) -> None:
        self.assertEqual(normalize_assignment("W5/W8→K8/L4"), (["K8", "L4"], "parsed"))

    def test_accepts_plus_separator(self) -> None:
        self.assertEqual(normalize_assignment("K8 + U1"), (["K8", "U1"], "parsed"))

    def test_preserves_malformed_as_unknown(self) -> None:
        self.assertEqual(normalize_assignment("K8/?"), ([], "unknown"))


class YulogTests(unittest.TestCase):
    def test_normalizes_matching_tokyo_date(self) -> None:
        payload = json.loads((ROOT / "data/fixtures/yulog-response.sample.json").read_text(encoding="utf-8"))
        result = YulogFormationSource.parse_response(payload, date(2026, 8, 26))
        self.assertEqual(result["serviceDate"], "2026-08-26")
        self.assertEqual(result["updatedAt"], "2026-08-26T11:20:04+09:00")
        assignments = {item["diagramId"]: item for item in result["assignments"]}
        self.assertEqual(assignments["A84"]["currentUnits"], ["K8", "L4"])
        self.assertEqual(assignments["A999"]["currentUnits"], ["ZZ1"])
        self.assertFalse(result["source"]["isMock"])

    def test_rejects_missing_date(self) -> None:
        payload = {"time": "2026/8/26_11:20:4"}
        with self.assertRaisesRegex(RuntimeError, "No Yulog assignment map"):
            YulogFormationSource.parse_response(payload, date(2026, 8, 26))


class OperationCsvTests(unittest.TestCase):
    def test_propagates_diagram_id_and_parses_partner(self) -> None:
        sample = (ROOT / "data/fixtures/operation.sample.csv").read_text(encoding="utf-8")
        records = parse_operation_csv(sample, "tns313")
        self.assertEqual(len(records), 3)
        self.assertEqual(records[1].diagram_id, "A21")
        self.assertEqual(records[1].train_number, "738M")
        self.assertEqual(records[0].partner_diagram_id, "A28")
        self.assertEqual(records[2].day_code, 2)


if __name__ == "__main__":
    unittest.main()

