"""Skip deployments after refreshes that did not change published data."""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Callable


def deployment_required(event: str, before: str | None, runner: Callable = subprocess.run) -> bool:
    if event != "workflow_run":
        return True
    if not isinstance(before, str) or not re.fullmatch(r"[0-9a-f]{40}", before):
        raise ValueError("Missing valid triggering update revision")
    result = runner(["git", "diff", "--quiet", before, "HEAD", "--", "public/data"], check=False)
    if result.returncode not in (0, 1):
        raise subprocess.CalledProcessError(result.returncode, result.args)
    return result.returncode == 1


def main() -> None:
    event = os.environ["GITHUB_EVENT_NAME"]
    payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    required = deployment_required(event, payload.get("workflow_run", {}).get("head_sha"))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        handle.write(f"required={str(required).lower()}\n")
    print("Deployment required" if required else "Published data unchanged; skipping deployment")


if __name__ == "__main__":
    main()
