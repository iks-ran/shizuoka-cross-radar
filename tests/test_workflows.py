from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.commit_data import main as commit_data, push_with_retries
from scripts.deployment_changes import deployment_required, main as deployment_changes


class CommitTests(unittest.TestCase):
    def test_transient_push_failure_retries_the_same_commit(self):
        runner = Mock(side_effect=[subprocess.CalledProcessError(1, ["git", "push"]), None])
        sleeper = Mock()
        with redirect_stdout(StringIO()):
            push_with_retries(runner, sleeper)
        self.assertEqual([call.args[0] for call in runner.call_args_list], [["git", "push"]] * 2)
        sleeper.assert_called_once_with(5)

    def test_exhausted_push_retries_remain_a_failure(self):
        runner = Mock(side_effect=subprocess.CalledProcessError(1, ["git", "push"]))
        sleeper = Mock()
        with redirect_stdout(StringIO()), self.assertRaises(subprocess.CalledProcessError):
            push_with_retries(runner, sleeper)
        self.assertEqual(runner.call_count, 3)
        self.assertEqual([call.args[0] for call in sleeper.call_args_list], [5, 15])

    def test_push_timeout_is_retried(self):
        runner = Mock(side_effect=[subprocess.TimeoutExpired(["git", "push"], 60), None])
        with redirect_stdout(StringIO()):
            push_with_retries(runner, Mock())
        self.assertEqual(runner.call_count, 2)

    def test_no_generated_changes_do_not_commit_or_push(self):
        with patch("scripts.commit_data.subprocess.run", return_value=Mock(stdout="")) as runner:
            with patch("scripts.commit_data.push_with_retries") as push:
                with redirect_stdout(StringIO()):
                    commit_data()
            runner.assert_called_once_with(["git", "status", "--porcelain", "--", "public/data"], check=True, capture_output=True, text=True)
            push.assert_not_called()


class DeploymentTests(unittest.TestCase):
    def test_push_and_manual_events_always_build(self):
        runner = Mock()
        for event in ("push", "workflow_dispatch"):
            self.assertTrue(deployment_required(event, None, runner))
        runner.assert_not_called()

    def test_completed_update_only_deploys_changed_published_data(self):
        before = "a" * 40
        for result, expected in ((0, False), (1, True)):
            runner = Mock(return_value=Mock(returncode=result))
            self.assertEqual(deployment_required("workflow_run", before, runner), expected)
            runner.assert_called_once_with(["git", "diff", "--quiet", before, "HEAD", "--", "public/data"], check=False)

    def test_missing_trigger_revision_or_git_failure_cannot_be_reported_as_unchanged(self):
        runner = Mock(return_value=Mock(returncode=128, args=["git", "diff"]))
        with self.assertRaises(ValueError):
            deployment_required("workflow_run", None, runner)
        runner.assert_not_called()
        with self.assertRaises(subprocess.CalledProcessError):
            deployment_required("workflow_run", "a" * 40, runner)

    def test_no_change_output_skips_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = Path(directory) / "event.json"
            output = Path(directory) / "output"
            payload.write_text(json.dumps({"workflow_run": {"head_sha": "a" * 40}}))
            with patch.dict(os.environ, {
                "GITHUB_EVENT_NAME": "workflow_run", "GITHUB_EVENT_PATH": str(payload), "GITHUB_OUTPUT": str(output),
            }):
                with patch("scripts.deployment_changes.deployment_required", return_value=False):
                    with redirect_stdout(StringIO()):
                        deployment_changes()
            self.assertEqual(output.read_text(), "required=false\n")


if __name__ == "__main__":
    unittest.main()
