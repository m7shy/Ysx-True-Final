"""
Cookie-file rotation manager for yt-dlp.

Mirrors main.py's ProxyManager, but rotates over a *pool* of Netscape-format
cookies.txt files (one per logged-in Google/YouTube account) instead of proxy
URLs. An authenticated session is the strongest trust signal YouTube checks
against its "Sign in to confirm you're not a bot" gate, so rotating across
several accounts lets the scraper run far longer before any single account
gets rate-limited or flagged — the whole point of the multi-cookie upgrade.

Sources (first hit wins):
  • YTDLP_COOKIES_DIR   — a directory of *.txt cookie files (default: cookies/)
  • YTDLP_COOKIES_FILE  — a single legacy cookie file, auto-adopted into the
                          pool as <dir>/legacy.txt on first run so the existing
                          single-cookie setup keeps working with zero changes.

With neither configured the pool is empty and current() returns None, so the
caller omits `cookiefile` entirely and runs the unauthenticated (bot-check-
prone) path — identical to the pre-rotation behaviour when the env var was
unset.

Kept standalone/importable (no dependency on main.py) so both main.py and
transcript_extractor.py can share the same single COOKIE_MANAGER instance
instead of each reading the cookie config independently.
"""

from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

DEFAULT_COOKIES_DIR = "cookies"
# Marker dropped in the cookies dir once the legacy YTDLP_COOKIES_FILE has been
# adopted, so a user who deliberately deletes every uploaded cookie through the
# UI doesn't get the legacy file silently re-copied back on the next process.
_ADOPTED_MARKER = ".adopted"


def _log(msg: str) -> None:
    """Console-safe print (this module has no access to main.safe_print)."""
    try:
        print(msg)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        print(msg.encode(enc, "ignore").decode(enc, "ignore"))


class CookieManager:
    """Round-robin cookie-file rotation with per-file cooldowns.

    Two distinct bench reasons, deliberately treated differently:

      • throttle (HTTP 429 / "too many requests") — usually IP-level, not
        account-level. Benched with the same short, escalating cooldown as a
        throttled proxy (60s doubling to 900s), then reused.
      • bot-check ("Sign in to confirm you're not a bot" / session invalid) —
        the *account* is burned or logged out; retrying it soon is pointless.
        Benched for a long, flat cooldown (1h) and logged distinctly so the
        operator can tell "rate-limited, will retry" apart from "cookie dead,
        re-export it."

    When every cookie is benched, current() still returns the one whose bench
    expires soonest rather than None — a throttled/flagged authenticated
    session is still a stronger trust signal than no cookie at all. None is
    returned only when the pool is genuinely empty.
    """

    _BASE_COOLDOWN = 60.0      # seconds a cookie sits out after its first 429
    _MAX_COOLDOWN  = 900.0
    _BOT_CHECK_COOLDOWN = 3600.0  # flat 1h bench for a bot-checked/burned account

    def __init__(self) -> None:
        self.cookies: list[Path] = self._load()
        self._idx = 0
        self._benched_until: dict[str, float] = {}
        self._strikes: dict[str, int] = {}
        if self.cookies:
            names = ", ".join(c.name for c in self.cookies)
            _log(f"Cookie manager: {len(self.cookies)} cookie file(s) loaded, rotating — {names}")
        else:
            _log("Cookie manager: no cookie files configured — unauthenticated path")

    @staticmethod
    def _cookies_dir() -> Path:
        return Path(os.getenv("YTDLP_COOKIES_DIR", DEFAULT_COOKIES_DIR).strip() or DEFAULT_COOKIES_DIR)

    @classmethod
    def _load(cls) -> list[Path]:
        cookies_dir = cls._cookies_dir()
        files = cls._glob(cookies_dir)
        if files:
            return files

        # Pool is empty — consider auto-adopting the legacy single-file cookie.
        legacy = os.getenv("YTDLP_COOKIES_FILE", "").strip()
        if not legacy:
            return []
        legacy_path = Path(legacy)
        if not legacy_path.is_file():
            return []
        # Marker present means the pool was deliberately emptied through the UI —
        # honour that instead of silently re-copying the legacy file back.
        if (cookies_dir / _ADOPTED_MARKER).exists():
            return []
        try:
            cookies_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy_path, cookies_dir / "legacy.txt")
            (cookies_dir / _ADOPTED_MARKER).touch()
            _log(f"Cookie manager: adopted legacy {legacy_path.name} into {cookies_dir}/legacy.txt")
            return cls._glob(cookies_dir)
        except OSError as exc:
            # Couldn't write the pool dir — use the legacy file directly as a
            # one-entry pool, matching pre-rotation behaviour.
            _log(f"Cookie manager: failed to adopt legacy cookie file ({exc}) — using it directly")
            return [legacy_path]

    @staticmethod
    def _glob(cookies_dir: Path) -> list[Path]:
        if not cookies_dir.is_dir():
            return []
        return sorted(p for p in cookies_dir.glob("*.txt") if p.is_file())

    def current(self) -> str | None:
        """Return the cookie file path to use for the next request (None = none)."""
        if not self.cookies:
            return None
        now = time.monotonic()
        for _ in range(len(self.cookies)):
            cookie = self.cookies[self._idx % len(self.cookies)]
            if self._benched_until.get(str(cookie), 0.0) <= now:
                return str(cookie)
            self._idx += 1
        # Every cookie is benched — reuse the one that frees up soonest; an
        # authenticated session (even throttled) beats no cookie for bot-check.
        soonest = min(self.cookies, key=lambda c: self._benched_until.get(str(c), 0.0))
        return str(soonest)

    def report_success(self, cookie: str | None) -> None:
        if cookie:
            self._strikes[cookie] = 0

    def report_throttle(self, cookie: str | None) -> None:
        """Bench a throttled cookie (short escalating cooldown) and rotate on."""
        if cookie:
            strikes = self._strikes.get(cookie, 0) + 1
            self._strikes[cookie] = strikes
            cooldown = min(self._BASE_COOLDOWN * (2 ** (strikes - 1)), self._MAX_COOLDOWN)
            self._benched_until[cookie] = time.monotonic() + cooldown
            _log(f"    [cookie] 429 on {Path(cookie).name} — benched {cooldown:.0f}s, rotating")
        self._idx += 1

    def report_bot_check(self, cookie: str | None) -> None:
        """Bench a bot-checked/burned cookie for a long flat cooldown and rotate."""
        if cookie:
            self._benched_until[cookie] = time.monotonic() + self._BOT_CHECK_COOLDOWN
            _log(
                f"    [cookie] bot-check on {Path(cookie).name} — account likely burned, "
                f"disabling {self._BOT_CHECK_COOLDOWN / 60:.0f}min (re-export if it persists)"
            )
        self._idx += 1


COOKIE_MANAGER = CookieManager()
