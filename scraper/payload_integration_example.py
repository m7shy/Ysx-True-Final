"""
Example: Integrating payload_extractor into main.py's run_gauntlet().

This shows the minimal code changes needed to add content-flag validation.
Copy these functions into main.py to enable payload-based filtering.
"""

from __future__ import annotations

import logging
from curl_cffi import requests
from payload_extractor import extract_from_html, validate_schema

skip_log = logging.getLogger("skip")


# ── Fetch watch page HTML using existing proxy/impersonate infrastructure ────

def fetch_watch_page(
    video_id: str,
    proxy: str | None = None,
    timeout: int = 30,
    impersonate: str = "chrome120",
) -> str | None:
    """Fetch raw HTML of a YouTube watch page.

    Uses the same curl_cffi impersonation and proxy routing as the rest
    of the scraper. Returns None on any network error (timeout, 429, etc.).
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    proxies = {"http": proxy, "https": proxy} if proxy else None
    try:
        resp = requests.get(
            url,
            timeout=timeout,
            proxies=proxies,
            impersonate=impersonate,
        )
        if resp.status_code == 200:
            return resp.text
    except requests.exceptions.RequestException:
        pass
    return None


# ── Thin wrapper that integrates with existing proxy/backoff manager ────

def get_payload_metadata(
    video_id: str,
    proxy_manager=None,  # Existing PROXY_MANAGER from main.py
    backoff_fn=None,  # Existing _backoff() function
    max_retries: int = 3,
) -> dict | None:
    """Fetch watch page and extract payload metadata with backoff/rotation.

    Integrates seamlessly with main.py's proxy rotation and exponential backoff.
    Returns a dict suitable for checks, or None on any failure.
    """
    if not video_id:
        return None

    for attempt in range(max_retries + 1):
        # Use existing proxy manager if provided
        proxy = proxy_manager.current() if proxy_manager else None
        try:
            html = fetch_watch_page(video_id, proxy=proxy)
            if not html:
                continue

            # Extract and validate
            metadata = extract_from_html(html)
            if not metadata or not validate_schema(metadata):
                continue

            # Success — report to proxy manager
            if proxy_manager:
                proxy_manager.report_success(proxy)

            return metadata.to_dict()

        except Exception:
            pass

        # Backoff on failure (if callable)
        if attempt < max_retries and backoff_fn:
            backoff_fn(attempt, f"payload extraction for {video_id}")

    return None


# ── Add these checks to run_gauntlet() ────
# Paste into run_gauntlet() AFTER long-form/avg-views checks, BEFORE final lead emission:

def example_gauntlet_checks(
    video_ids: list[str],
    skip_log=skip_log,
) -> tuple[int, int]:
    """Example: filter videos by payload-derived content flags.

    Returns (long_form_count, avg_views) like existing get_video_details(),
    but skips videos that fail content-flag checks.
    """
    longform_views: list[int] = []

    for vid in video_ids:
        # Check: fetch payload and validate content flags
        meta = get_payload_metadata(vid)
        if not meta:
            # Could not fetch payload — skip conservatively
            skip_log.info(f"SKIP {vid}: payload extraction failed")
            continue

        # Check: age-restricted content
        if meta.get("is_age_restricted"):
            skip_log.info(f"SKIP {vid}: age-restricted")
            continue

        # Check: private/removed videos
        if meta.get("is_private"):
            skip_log.info(f"SKIP {vid}: video is private")
            continue

        # Check: unlisted videos (optional — remove if you want unlisted content)
        if meta.get("is_unlisted"):
            skip_log.info(f"SKIP {vid}: unlisted")
            continue

        # Check: live/premiere content (optional)
        if meta.get("is_live") or meta.get("is_premiere"):
            skip_log.info(f"SKIP {vid}: live/premiere not supported")
            continue

        # Check: shorts (optional)
        if meta.get("short_form"):
            skip_log.info(f"SKIP {vid}: short-form video")
            continue

        # All checks passed — video qualifies
        view_count = meta.get("view_count")
        if view_count and view_count > 0:
            longform_views.append(view_count)

    longform_count = len(longform_views)
    avg_views = int(sum(longform_views) / longform_count) if longform_count else 0
    return longform_count, avg_views


# ── Integration points in run_gauntlet() ────

INTEGRATION_STEPS = """
Step 1: Add import at the top of main.py
────────────────────────────────────────────
from payload_extractor import extract_from_html, validate_schema

Step 2: Copy get_payload_metadata() into main.py

Step 3: In run_gauntlet(), after the long-form/avg-views check:
───────────────────────────────────────────
        try:
            longform_count, avg_views = get_video_details(video_ids)
        except HttpError as exc:
            skip_log.info(f"SKIP {cid} ({name}): video details error — {exc}")
            continue

        # NEW: Payload-based content flag validation
        for vid in video_ids:
            meta = get_payload_metadata(vid)
            if not meta:
                skip_log.info(f"SKIP {vid}: payload unavailable")
                longform_count = 0
                break
            if meta.get("is_age_restricted"):
                skip_log.info(f"SKIP {vid}: age-restricted content")
                longform_count = 0
                break

        total_videos   = len(video_ids)
        longform_ratio = (longform_count / total_videos) if total_videos else 0.0
        if longform_ratio < MIN_LONGFORM_RATIO:
            # ... rest of existing code

Step 4: (Optional) Wire into proxy manager for consistency
─────────────────────────────────────────────────────────
        # At the start of run_gauntlet():
        def get_payload_with_proxy(vid):
            return get_payload_metadata(
                vid,
                proxy_manager=PROXY_MANAGER,
                backoff_fn=_backoff,
            )

        # Then use get_payload_with_proxy(vid) instead of get_payload_metadata(vid)
"""


# ── Minimal integration (just checks) ────

MINIMAL_PATTERN = """
# Minimal: paste this loop after get_video_details() call:

for vid in video_ids:
    meta = get_payload_metadata(vid)
    if meta and meta.get("is_age_restricted"):
        skip_log.info(f"SKIP {vid}: age-restricted")
        longform_count = 0
        break
"""


if __name__ == "__main__":
    print(INTEGRATION_STEPS)
    print("\n" + "=" * 70 + "\n")
    print("MINIMAL INTEGRATION PATTERN:")
    print(MINIMAL_PATTERN)
