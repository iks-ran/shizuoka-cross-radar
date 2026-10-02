import copy
import json
import os
import tempfile
import unittest
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import patch
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.history import publish_history, validate_archive, validate_bundle
from scripts.update_data import write_json_atomically
from scripts.validation import ValidationError
from scripts.data_sources.base import SourceError, SourceUnavailable
from scripts.update_data import main
from scripts.backfill_history import recover_pairs


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 9, 10, 4, 32, tzinfo=ZoneInfo("Asia/Tokyo"))
        self.timetable = json.loads(Path("public/data/timetable.json").read_text())
        self.latest = json.loads(Path("public/data/latest.json").read_text())

    def pair(self, day):
        timetable, latest = copy.deepcopy(self.timetable), copy.deepcopy(self.latest)
        timetable["serviceDate"] = latest["serviceDate"] = day
        return timetable, latest

    def publish(self, pairs, **kwargs):
        publish_history(self.root, pairs, self.now, write_json_atomically, **kwargs)
        return json.loads((self.root / "history-index.json").read_text())

    def test_first_observation_is_recorded_only_for_observed_today_and_preserved(self):
        index = self.publish([self.pair("2026-09-09"), self.pair("2026-09-10")])
        self.assertTrue(all(e["firstObservedAt"] is None for e in index["dates"]))
        index = self.publish([self.pair("2026-09-10")], observed_dates={"2026-09-10"})
        first = index["dates"][0]["firstObservedAt"]
        self.assertEqual(first, self.now.isoformat())
        self.now += timedelta(minutes=30)
        index = self.publish([self.pair("2026-09-10")], observed_dates={"2026-09-10"})
        self.assertEqual(index["dates"][0]["firstObservedAt"], first)

    def test_retention_and_future_exclusion(self):
        self.publish([self.pair("2026-08-12")])
        self.now += timedelta(days=1)
        index = self.publish([self.pair("2026-09-10"), self.pair("2026-09-12")])
        self.assertEqual([e["serviceDate"] for e in index["dates"]], ["2026-09-10"])
        self.assertFalse(list((self.root / "history").glob("2026-08-12-*.json")))
        validate_archive(self.root)

    def test_invalid_pair_preserves_every_published_byte(self):
        self.publish([self.pair("2026-09-09")])
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        bad = self.pair("2026-09-10")
        bad[1]["serviceDate"] = "2026-09-09"
        with self.assertRaises(ValidationError):
            self.publish([self.pair("2026-09-10"), bad])
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_failed_index_publication_keeps_old_bundle_accessible(self):
        index = self.publish([self.pair("2026-09-09")])
        original = (self.root / "history-index.json").read_bytes()
        changed = self.pair("2026-09-09")
        changed[1]["updatedAt"] = "2026-09-10T00:00:00+09:00"
        def fail_index(payload, output, validator):
            if output.name == "history-index.json":
                raise OSError("simulated publication failure")
            write_json_atomically(payload, output, validator)
        with self.assertRaises(OSError):
            publish_history(self.root, [changed], self.now, fail_index)
        self.assertEqual(original, (self.root / "history-index.json").read_bytes())
        self.assertTrue((self.root / index["dates"][0]["path"]).exists())
        validate_archive(self.root)

    def test_rejects_cross_date_index_and_missing_bundle(self):
        index = self.publish([self.pair("2026-09-09")])
        bundle_path = self.root / index["dates"][0]["path"]
        bundle = json.loads(bundle_path.read_text())
        bundle["latest"]["serviceDate"] = "2026-09-10"
        with self.assertRaises(ValidationError):
            validate_bundle(bundle)
        bundle_path.unlink()
        with self.assertRaises(FileNotFoundError):
            validate_archive(self.root)

    def run_update(self, available=True, allow_unavailable=False, source_error=None, timetable_error=None):
        pair = self.pair("2026-09-09")
        def formation_for_date(payload, day):
            if source_error is not None:
                raise source_error
            if available and day.isoformat() == "2026-09-09":
                return pair[1]
            raise SourceUnavailable("Date not published")
        with ExitStack() as stack:
            argv = ["update", "--source", "tokaido-shizuoka", "--service-date", "2026-09-10",
                "--output", str(self.root / "latest.json"), "--timetable-output", str(self.root / "timetable.json")]
            if allow_unavailable:
                argv.append("--allow-unavailable")
            stack.enter_context(patch("sys.argv", argv))
            formation_fetch = stack.enter_context(patch("scripts.update_data.TokaidoShizuokaFormationSource.fetch_payload", return_value={}))
            timetable_fetch = stack.enter_context(patch("scripts.update_data.JrCentralTimetableSource.fetch_payload", return_value={}))
            stack.enter_context(patch("scripts.update_data.TokaidoShizuokaFormationSource.parse_response", side_effect=formation_for_date))
            stack.enter_context(patch("scripts.update_data.JrCentralTimetableSource.parse_checked", return_value=pair[0], side_effect=timetable_error))
            stack.enter_context(patch("scripts.update_data.OperationDiagramSource.fetch", return_value={}))
            stack.enter_context(patch("scripts.update_data.CabinetOfficeHolidaySource.fetch", return_value=set()))
            clock = stack.enter_context(patch("scripts.update_data.datetime"))
            clock.now.return_value = self.now
            stack.enter_context(redirect_stderr(StringIO()))
            output = stack.enter_context(redirect_stdout(StringIO()))
            main()
            formation_fetch.assert_called_once()
            timetable_fetch.assert_called_once()
            return output.getvalue()

    def test_updater_publishes_yesterday_when_today_is_missing_with_one_read_per_feed(self):
        self.run_update()
        index = json.loads((self.root / "history-index.json").read_text())
        self.assertEqual(index["dates"][0]["serviceDate"], "2026-09-09")
        self.assertIsNone(index["dates"][0]["firstObservedAt"])
        self.assertEqual(json.loads((self.root / "timetable.json").read_text())["serviceDate"], "2026-09-09")
        validate_archive(self.root)

    def test_updater_without_matching_dates_preserves_all_snapshots(self):
        self.run_update()
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        with self.assertRaises(SourceError):
            self.run_update(available=False)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_scheduled_unpublished_dates_succeed_without_changing_any_snapshot(self):
        self.run_update()
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        summary = self.root / "summary.md"
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            output = self.run_update(available=False, allow_unavailable=True)
        self.assertIn("No update available for 2026-09-10", output)
        self.assertIn("Preserving validated snapshots for 2026-09-09", summary.read_text())
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})
        validate_archive(self.root)

    def test_scheduled_no_update_requires_a_real_valid_saved_pair(self):
        with self.assertRaisesRegex(SourceError, "No validated real snapshot pair"):
            self.run_update(available=False, allow_unavailable=True)
        self.run_update()
        latest_path = self.root / "latest.json"
        invalid = json.loads(latest_path.read_text())
        invalid["schemaVersion"] = 999
        latest_path.write_text(json.dumps(invalid))
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        with self.assertRaises(ValidationError):
            self.run_update(available=False, allow_unavailable=True)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_scheduled_network_and_malformed_source_errors_still_fail_and_preserve_snapshots(self):
        self.run_update()
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        for error in ("Unable to read assignments after 3 attempts: timeout", "Malformed assignment map"):
            with self.subTest(error=error):
                with self.assertRaisesRegex(SourceError, error):
                    self.run_update(allow_unavailable=True, source_error=SourceError(error))
                self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})
        with self.assertRaisesRegex(SourceError, "mapping coverage"):
            self.run_update(allow_unavailable=True, timetable_error=SourceError("Low mapping coverage"))
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_scheduled_unpublished_timetable_preserves_the_saved_pair(self):
        self.run_update()
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        self.run_update(allow_unavailable=True, timetable_error=SourceUnavailable("Timetable not yet published"))
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_unpublished_response_with_real_parsers_preserves_saved_snapshots(self):
        self.run_update()
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        formations = {
            "time": "2026/09/10_04:32:00",
            "0": {"year": "26", "date": "9-9", "train": {"A84": "K8/L4"}},
            "1": {"year": "26", "date": "9-10", "train": {}},
        }
        timetable = {"update_flg": "1", "create_time": "20260910043200", "train_info": []}
        with ExitStack() as stack:
            stack.enter_context(patch("sys.argv", ["update", "--source", "tokaido-shizuoka", "--allow-unavailable",
                "--service-date", "2026-09-10", "--output", str(self.root / "latest.json"),
                "--timetable-output", str(self.root / "timetable.json")]))
            stack.enter_context(patch("scripts.update_data.TokaidoShizuokaFormationSource.fetch_payload", return_value=formations))
            stack.enter_context(patch("scripts.update_data.JrCentralTimetableSource.fetch_payload", return_value=timetable))
            stack.enter_context(patch("scripts.update_data.OperationDiagramSource.fetch", return_value={"records": [], "trains": []}))
            stack.enter_context(patch("scripts.update_data.CabinetOfficeHolidaySource.fetch", return_value=set()))
            stack.enter_context(redirect_stderr(StringIO()))
            output = stack.enter_context(redirect_stdout(StringIO()))
            main()
        self.assertIn("No update available", output.getvalue())
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def git_reader(self, records, shallow=False):
        def read(repo, *args):
            if args == ("rev-parse", "--is-shallow-repository"):
                return "true" if shallow else "false"
            if args[0] == "rev-parse":
                return "verified-revision"
            if args[0] == "log":
                return "\n".join(records)
            commit, path = args[1].split(":", 1)
            return json.dumps(records[commit][0 if path.endswith("timetable.json") else 1])
        return read

    def test_backfill_recovers_latest_valid_pair_for_each_missing_day(self):
        newer = self.pair("2026-09-08")
        older = self.pair("2026-09-08")
        newer[1]["updatedAt"] = "2026-09-08T23:00:00+09:00"
        records = {"new": newer, "old": older, "other": self.pair("2026-09-07")}
        pairs = recover_pairs(self.root, "origin/main", self.now.date(), set(), self.git_reader(records))
        self.assertEqual([p[0]["serviceDate"] for p in pairs], ["2026-09-08", "2026-09-07"])
        self.assertEqual(pairs[0][1]["updatedAt"], "2026-09-08T23:00:00+09:00")

    def test_backfill_skips_mismatched_and_fixture_pairs_without_losing_valid_older_pair(self):
        mismatch = self.pair("2026-09-08")
        mismatch[0]["serviceDate"] = "2026-09-07"
        fixture = self.pair("2026-09-08")
        fixture[1]["source"]["isMock"] = True
        records = {"mismatch": mismatch, "fixture": fixture, "valid": self.pair("2026-09-08")}
        pairs = recover_pairs(self.root, "HEAD", self.now.date(), set(), self.git_reader(records))
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0][0]["serviceDate"], "2026-09-08")

    def test_backfill_preserves_existing_dates_and_observations_and_excludes_outside_window(self):
        records = {"existing": self.pair("2026-09-09"), "old": self.pair("2026-08-11"), "future": self.pair("2026-09-11")}
        pairs = recover_pairs(self.root, "HEAD", self.now.date(), {"2026-09-09"}, self.git_reader(records))
        self.assertEqual(pairs, [])
        before = self.publish([self.pair("2026-09-10")], observed_dates={"2026-09-10"})
        after = self.publish(pairs)
        self.assertEqual(before, after)

    def test_backfill_requires_full_history(self):
        with self.assertRaisesRegex(RuntimeError, "full Git history"):
            recover_pairs(self.root, "HEAD", self.now.date(), set(), self.git_reader({}, shallow=True))
