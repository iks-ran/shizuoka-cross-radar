from __future__ import annotations

import json
import unittest
from datetime import date
from pathlib import Path

from scripts.data_sources.base import normalize_assignment
from scripts.data_sources.jr_central import (
    JrCentralTimetableSource,
    operation_day_matches,
    parse_holiday_csv,
)
from scripts.data_sources.operation_diagram import parse_operation_csv, parse_train_metadata_csv
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

    def test_parses_attach_and_detach_metadata(self) -> None:
        sample = (
            "train_number,depature_station,depsta_time,terminal_station,termsta_time,"
            "detach_station,detach_sta_arr_time,detach_sta_dep_time,attach_station,"
            "attach_sta_arr_time,attach_sta_dep_time,continuous_train_num,day,option\n"
            "427M,熱海,600,浜松,800,静岡,700,701,,,,,,\n"
        )
        records = parse_train_metadata_csv(sample)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].detach_station, "静岡")
        self.assertIsNone(records[0].attach_station)


class JrCentralTests(unittest.TestCase):
    def test_parses_official_holidays_and_operation_days(self) -> None:
        holidays = parse_holiday_csv("国民の祝日・休日月日,名称\n2026/9/22,休日\n".encode("shift_jis"))
        self.assertIn(date(2026, 9, 22), holidays)
        self.assertTrue(operation_day_matches(1, date(2026, 8, 26), holidays))
        self.assertFalse(operation_day_matches(2, date(2026, 8, 26), holidays))
        self.assertTrue(operation_day_matches(5, date(2026, 9, 22), holidays))

    def test_builds_real_service_and_detach_segments(self) -> None:
        corridor = [
            {"id": "hamamatsu", "name": {"ja": "浜松", "en": "Hamamatsu", "zhCN": "滨松"}},
            {"id": "shizuoka", "name": {"ja": "静岡", "en": "Shizuoka", "zhCN": "静冈"}},
            {"id": "atami", "name": {"ja": "熱海", "en": "Atami", "zhCN": "热海"}},
        ]

        def localized(ja: str, en: str, zh_cn: str) -> list[dict[str, str]]:
            return [
                {"lang": "ja", "name": ja},
                {"lang": "en", "name": en},
                {"lang": "zh-CN", "name": zh_cn},
            ]

        payload = {
            "update_flg": "1",
            "create_time": "20260826112004",
            "train_info": [
                {
                    "train_identification_key": "2026082610104271203360",
                    "trainnumber": "427M",
                    "terminalStation": localized("浜松", "Hamamatsu", "滨松"),
                    "timetable": [
                        {
                            "station": localized("熱海", "Atami", "热海"),
                            "run_line": "050010",
                            "stopthroughkbn": "1",
                            "arrivalTime1": "",
                            "departureTime1": "0600",
                        },
                        {
                            "station": localized("静岡", "Shizuoka", "静冈"),
                            "run_line": "050010",
                            "stopthroughkbn": "1",
                            "arrivalTime1": "0700",
                            "departureTime1": "0701",
                        },
                        {
                            "station": localized("浜松", "Hamamatsu", "滨松"),
                            "run_line": "050010",
                            "stopthroughkbn": "1",
                            "arrivalTime1": "0800",
                            "departureTime1": "",
                        },
                    ],
                }
            ],
        }
        operation = {
            "records": [
                {"diagram_id": "A55", "train_number": "427M", "partner_diagram_id": "A58", "day_code": None},
                {"diagram_id": "A58", "train_number": "427M", "partner_diagram_id": "A55", "day_code": None},
                {"diagram_id": "A58", "train_number": "427M", "partner_diagram_id": None, "day_code": None},
            ],
            "trains": [
                {
                    "train_number": "427M",
                    "detach_station": "静岡",
                    "attach_station": None,
                    "day_code": None,
                }
            ],
        }
        result = JrCentralTimetableSource.parse_response(
            payload,
            date(2026, 8, 26),
            corridor,
            operation,
            set(),
        )
        self.assertFalse(result["isFixture"])
        self.assertEqual(result["serviceDate"], "2026-08-26")
        service = result["services"][0]
        self.assertEqual(service["destinationName"]["en"], "Hamamatsu")
        self.assertEqual(
            service["operationSegments"],
            [
                {"fromStationId": "atami", "toStationId": "atami", "diagramIds": ["A55", "A58"]},
                {"fromStationId": "shizuoka", "toStationId": "hamamatsu", "diagramIds": ["A58"]},
            ],
        )


if __name__ == "__main__":
    unittest.main()
