from __future__ import annotations

import json
import unittest
import urllib.request
import urllib.error
from datetime import date
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.data_sources.base import SourceError, SourceUnavailable, normalize_assignment
from scripts.data_sources.http import read_bytes
from scripts.data_sources.jr_central import (
    CabinetOfficeHolidaySource,
    JrCentralTimetableSource,
    operation_day_matches,
    parse_holiday_csv,
)
from scripts.data_sources.operation_diagram import OperationDiagramSource, parse_operation_csv, parse_train_metadata_csv
from scripts.data_sources.tokaido_shizuoka import (
    CURRENT_ASSIGNMENTS_URL,
    TokaidoShizuokaFormationSource,
)


ROOT = Path(__file__).resolve().parents[1]


class AssignmentTests(unittest.TestCase):
    def test_uses_rightmost_changed_assignment(self) -> None:
        self.assertEqual(normalize_assignment("W5/W8→K8/L4"), (["K8", "L4"], "parsed"))

    def test_accepts_plus_separator(self) -> None:
        self.assertEqual(normalize_assignment("K8 + U1"), (["K8", "U1"], "parsed"))

    def test_preserves_malformed_as_unknown(self) -> None:
        self.assertEqual(normalize_assignment("K8/?"), ([], "unknown"))


class TokaidoShizuokaTests(unittest.TestCase):
    def test_normalizes_matching_tokyo_date(self) -> None:
        payload = json.loads(
            (ROOT / "data/fixtures/tokaido-shizuoka-current.sample.json").read_text(
                encoding="utf-8"
            )
        )
        result = TokaidoShizuokaFormationSource.parse_response(payload, date(2026, 8, 26))
        self.assertEqual(result["serviceDate"], "2026-08-26")
        self.assertEqual(result["updatedAt"], "2026-08-26T11:20:04+09:00")
        assignments = {item["diagramId"]: item for item in result["assignments"]}
        self.assertEqual(assignments["A84"]["currentUnits"], ["K8", "L4"])
        self.assertEqual(assignments["A999"]["currentUnits"], ["ZZ1"])
        self.assertEqual(result["source"]["id"], "tokaido-shizuoka")
        self.assertFalse(result["source"]["isMock"])

    def test_rejects_missing_date(self) -> None:
        payload = {"time": "2026/08/26_11:20:04"}
        with self.assertRaisesRegex(SourceUnavailable, "No Tokaido Shizuoka assignment map"):
            TokaidoShizuokaFormationSource.parse_response(payload, date(2026, 8, 26))

    def test_empty_assignments_are_unavailable_but_malformed_data_is_an_error(self) -> None:
        payload = {"time": "2026/08/26_11:20:04", "today": {"year": "26", "date": "8-26", "train": {}}}
        with self.assertRaises(SourceUnavailable):
            TokaidoShizuokaFormationSource.parse_response(payload, date(2026, 8, 26))
        for bad in (None, [], {"A1": 123}):
            payload["today"]["train"] = bad
            with self.assertRaises(SourceError) as caught:
                TokaidoShizuokaFormationSource.parse_response(payload, date(2026, 8, 26))
            self.assertNotIsInstance(caught.exception, SourceUnavailable)
        with self.assertRaises(SourceError) as caught:
            TokaidoShizuokaFormationSource.parse_response({}, date(2026, 8, 26))
        self.assertNotIsInstance(caught.exception, SourceUnavailable)

    def test_invalid_dated_record_is_not_treated_as_unpublished(self) -> None:
        for bad in (None, {"year": "26", "date": "invalid", "train": {}}):
            with self.assertRaises(SourceError) as caught:
                TokaidoShizuokaFormationSource.parse_response(
                    {"time": "2026/08/26_11:20:04", "0": bad}, date(2026, 8, 26),
                )
            self.assertNotIsInstance(caught.exception, SourceUnavailable)

    def test_malformed_json_is_a_failure_without_retrying_or_treating_it_as_unpublished(self) -> None:
        opener = Mock(return_value=BytesIO(b"not JSON"))
        with self.assertRaisesRegex(SourceError, "Invalid.*JSON") as caught:
            TokaidoShizuokaFormationSource(opener=opener).fetch_payload()
        self.assertNotIsInstance(caught.exception, SourceUnavailable)
        opener.assert_called_once()

    def test_fetches_only_the_tokaido_shizuoka_json_endpoint(self) -> None:
        payload = (
            ROOT / "data/fixtures/tokaido-shizuoka-current.sample.json"
        ).read_bytes()
        requested_urls: list[str] = []

        def opener(request: urllib.request.Request, timeout: int) -> BytesIO:
            requested_urls.append(request.full_url)
            self.assertEqual(timeout, 30)
            return BytesIO(payload)

        result = TokaidoShizuokaFormationSource(opener=opener).fetch("2026-08-26")

        self.assertEqual(requested_urls, [CURRENT_ASSIGNMENTS_URL])
        self.assertEqual(result["source"]["id"], "tokaido-shizuoka")


class RequestRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.request = urllib.request.Request(CURRENT_ASSIGNMENTS_URL, method="GET")
        self.sleep = Mock()

    def test_recovers_after_timeouts_with_bounded_backoff(self) -> None:
        opener = Mock(side_effect=[TimeoutError("slow"), urllib.error.URLError("timeout"), BytesIO(b"saved response")])
        self.assertEqual(read_bytes(self.request, "test source", opener=opener, sleeper=self.sleep), b"saved response")
        self.assertEqual(opener.call_count, 3)
        self.assertEqual([call.args[0] for call in self.sleep.call_args_list], [5, 15])
        self.assertTrue(all(call.kwargs["timeout"] == 30 for call in opener.call_args_list))

    def test_exhausted_retries_remain_a_failure(self) -> None:
        opener = Mock(side_effect=TimeoutError("offline"))
        with self.assertRaisesRegex(SourceError, "after 3 attempts") as caught:
            read_bytes(self.request, "test source", opener=opener, sleeper=self.sleep)
        self.assertNotIsInstance(caught.exception, SourceUnavailable)
        self.assertEqual(opener.call_count, 3)

    def test_permanent_http_error_is_not_retried(self) -> None:
        opener = Mock(side_effect=urllib.error.HTTPError(self.request.full_url, 404, "not found", {}, None))
        with self.assertRaisesRegex(SourceError, "404"):
            read_bytes(self.request, "test source", opener=opener, sleeper=self.sleep)
        opener.assert_called_once()
        self.sleep.assert_not_called()

    def test_rate_limit_wait_is_respected_and_bounded(self) -> None:
        error = urllib.error.HTTPError(self.request.full_url, 429, "busy", {"Retry-After": "120"}, None)
        opener = Mock(side_effect=[error, BytesIO(b"ok")])
        self.assertEqual(read_bytes(self.request, "test source", opener=opener, sleeper=self.sleep), b"ok")
        self.sleep.assert_called_once_with(60)

    def test_operation_and_holiday_sources_retry_transient_errors(self) -> None:
        operation_opener = Mock(side_effect=[TimeoutError("slow"), BytesIO(b"operation CSV")])
        operation = OperationDiagramSource(opener=operation_opener, sleeper=self.sleep)
        self.assertEqual(operation._read("https://tokaido-unyo-shizuoka.com/csv/unyo/sample.csv"), "operation CSV")
        holiday_opener = Mock(side_effect=[TimeoutError("slow"), BytesIO(b"date,name\n2026/9/22,holiday\n")])
        self.assertEqual(CabinetOfficeHolidaySource(opener=holiday_opener, sleeper=self.sleep).fetch(), {date(2026, 9, 22)})
        self.assertEqual(operation_opener.call_count, 2)
        self.assertEqual(holiday_opener.call_count, 2)


class OperationCsvTests(unittest.TestCase):
    def test_propagates_diagram_id_and_parses_partner(self) -> None:
        sample = (ROOT / "data/fixtures/operation.sample.csv").read_text(encoding="utf-8")
        records = parse_operation_csv(sample, "tns313")
        self.assertEqual(len(records), 3)
        self.assertEqual(records[1].diagram_id, "A21")
        self.assertEqual(records[1].train_number, "738M")
        self.assertEqual(records[0].partner_diagram_id, "A28")
        self.assertEqual(records[2].day_code, 2)
        self.assertIsNone(records[0].planned_family)

    def test_marks_only_unique_operation_families_as_planned(self) -> None:
        sample = (ROOT / "data/fixtures/operation.sample.csv").read_text(encoding="utf-8")
        unique = parse_operation_csv(sample, "u315")
        mixed = parse_operation_csv(sample, "tns313")

        self.assertTrue(all(record.planned_family == "U" for record in unique))
        self.assertTrue(all(record.planned_family is None for record in mixed))

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
    def test_missing_and_historical_dates_are_unavailable_but_partial_today_is_a_failure(self) -> None:
        payload = {"create_time": "20260826112004", "train_info": []}
        with patch.object(JrCentralTimetableSource, "parse_response", return_value={"services": []}):
            with self.assertRaises(SourceUnavailable):
                JrCentralTimetableSource.parse_checked(payload, date(2026, 8, 26), [], {}, set())
        payload["train_info"] = [{"train_identification_key": "202608260001"}]
        with patch.object(JrCentralTimetableSource, "parse_response", return_value={"services": [{}]}):
            with self.assertRaises(SourceError) as caught:
                JrCentralTimetableSource.parse_checked(payload, date(2026, 8, 26), [], {}, set())
            self.assertNotIsInstance(caught.exception, SourceUnavailable)
        payload["train_info"] = [{"train_identification_key": "202608250001"}]
        with patch.object(JrCentralTimetableSource, "parse_response", return_value={"services": [{}]}):
            with self.assertRaises(SourceUnavailable):
                JrCentralTimetableSource.parse_checked(payload, date(2026, 8, 25), [], {}, set())

    def test_unpublished_flag_is_distinct_from_invalid_json_and_mapping_coverage(self) -> None:
        with self.assertRaises(SourceUnavailable):
            JrCentralTimetableSource.parse_response({"update_flg": "0"}, date(2026, 8, 26), [], {}, set())
        with self.assertRaises(SourceError) as caught:
            JrCentralTimetableSource.parse_response({}, date(2026, 8, 26), [], {}, set())
        self.assertNotIsInstance(caught.exception, SourceUnavailable)
        services = [{"operationSegments": [{"diagramIds": []}]} for _ in range(100)]
        with patch.object(JrCentralTimetableSource, "parse_response", return_value={"services": services}):
            with self.assertRaisesRegex(SourceError, "mapping coverage") as caught:
                JrCentralTimetableSource.parse_checked({}, date(2026, 8, 26), [], {}, set())
            self.assertNotIsInstance(caught.exception, SourceUnavailable)

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
                {
                    "diagram_id": "A55",
                    "train_number": "427M",
                    "partner_diagram_id": "A58",
                    "day_code": None,
                    "planned_family": "U",
                },
                {
                    "diagram_id": "A58",
                    "train_number": "427M",
                    "partner_diagram_id": "A55",
                    "day_code": None,
                    "planned_family": "U",
                },
                {
                    "diagram_id": "A58",
                    "train_number": "427M",
                    "partner_diagram_id": None,
                    "day_code": None,
                    "planned_family": "U",
                },
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
                {
                    "fromStationId": "atami",
                    "toStationId": "atami",
                    "diagramIds": ["A55", "A58"],
                    "plannedFormations": [
                        {"diagramId": "A55", "family": "U"},
                        {"diagramId": "A58", "family": "U"},
                    ],
                },
                {
                    "fromStationId": "shizuoka",
                    "toStationId": "hamamatsu",
                    "diagramIds": ["A58"],
                    "plannedFormations": [{"diagramId": "A58", "family": "U"}],
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
