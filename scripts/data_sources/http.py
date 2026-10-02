"""Bounded retries for read-only requests to the existing data sources."""
from __future__ import annotations

import time
import urllib.error
import urllib.request
from typing import Any, Callable

from .base import SourceError


def read_bytes(
    request: urllib.request.Request,
    label: str,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
    sleeper: Callable[[float], None] = time.sleep,
    timeout: int = 30,
) -> bytes:
    for attempt in range(3):
        try:
            with opener(request, timeout=timeout) as response:
                return response.read()
        except (OSError, urllib.error.URLError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code not in {
                408, 429, 500, 502, 503, 504,
            }:
                raise SourceError(f"Unable to read {label}: {exc}") from exc
            if attempt == 2:
                raise SourceError(f"Unable to read {label} after 3 attempts: {exc}") from exc
            delay = (5.0, 15.0)[attempt]
            if isinstance(exc, urllib.error.HTTPError) and exc.headers is not None:
                try:
                    delay = max(delay, min(60.0, float(exc.headers.get("Retry-After", "0"))))
                except ValueError:
                    pass
            sleeper(delay)
    raise AssertionError("Unreachable retry state")
