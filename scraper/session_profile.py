"""
session_profile.py — per-niche workspace isolation for the YT lead scraper.

Each B2B outreach niche ("B2B Coaching", "Tech Educators", …) gets its own
subdirectory under profiles/ holding *its own* copies of the mutable state the
pipeline writes: leads, blacklist/tracking DB, skip log, webhook dead-letter
queue, keyword memory, and the daemon checkpoint. Nothing here touches the
network layer — proxies, pacing, and impersonation stay global and shared. This
is purely about keeping one niche's outputs from cross-contaminating another's.

Layout for a niche named "B2B Coaching":

    profiles/
      b2b-coaching/
        leads.csv
        qualified.csv
        blacklist.csv
        insufficient_content.csv
        skipped.log
        webhook_queue.db
        tracking.db
        daemon_state.json
        keywords.txt
        used_keywords.txt
        lookalike_targets.txt
        pending_email_verification.csv

`SessionProfile` only computes and creates these paths. The actual "serialize
the active profile, flush memory, hot-load the next" switch lives in
main.use_profile(), which rebinds main's module-level path globals to a
profile's paths and resets the in-memory caches / tracking-DB connection. Keeping
the rebind in main.py means main.py stays the sole owner of its own globals.
"""

from __future__ import annotations

import re
from pathlib import Path

PROFILES_ROOT = Path("profiles")

# The state/output files a niche owns. Attribute name → filename inside the
# profile directory. Kept as a single mapping so main.use_profile() and the
# orchestrator agree on the layout without duplicating string literals.
PROFILE_FILES = {
    "leads":          "leads.csv",
    "qualified":      "qualified.csv",
    "blacklist":      "blacklist.csv",
    "insufficient":   "insufficient_content.csv",
    "skip_log":       "skipped.log",
    "webhook_db":     "webhook_queue.db",
    "tracking_db":    "tracking.db",
    "daemon_state":   "daemon_state.json",
    "keywords":       "keywords.txt",
    "used_keywords":  "used_keywords.txt",
    "lookalike":      "lookalike_targets.txt",
    "pending_verification": "pending_email_verification.csv",
}


def slugify(niche: str) -> str:
    """Turn a human niche label into a filesystem-safe directory slug.

    "B2B Coaching" → "b2b-coaching", "Tech / SaaS Educators" → "tech-saas-educators".
    Collapses any run of non-alphanumeric characters to a single hyphen and
    lowercases, so distinct labels that differ only in punctuation/spacing map to
    the same profile (intended: "B2B Coaching" and "b2b  coaching" are one niche).
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (niche or "").strip().lower()).strip("-")
    return slug or "default"


class SessionProfile:
    """A single niche's isolated workspace.

    Computes the per-niche directory and the paths of every file the pipeline
    writes there. Creating the object ensures the directory exists; it does not
    touch any of the files. Path lookups are available both as attributes
    (`profile.leads`) and as a dict (`profile.paths()`).
    """

    def __init__(self, niche: str, root: Path | str = PROFILES_ROOT) -> None:
        self.niche = niche
        self.slug = slugify(niche)
        self.root = Path(root)
        self.dir = self.root / self.slug
        self.dir.mkdir(parents=True, exist_ok=True)
        for attr, filename in PROFILE_FILES.items():
            setattr(self, attr, self.dir / filename)

    def paths(self) -> dict[str, Path]:
        """Return {logical_name: Path} for every file this profile owns."""
        return {attr: getattr(self, attr) for attr in PROFILE_FILES}

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"SessionProfile(niche={self.niche!r}, dir={self.dir})"
