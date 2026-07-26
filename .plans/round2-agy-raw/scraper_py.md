# Security and Correctness Code Review: Scraper Subsystem

### Multi-tenant Data Contamination via Unbound `PENDING_VERIFICATION_FILE`
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: scraper/main.py:2214
WHAT: `use_profile()` fails to include and rebind `PENDING_VERIFICATION_FILE` to `profile.pending_verification`. When email verification times out during ZeroBounce validation, candidate rows are written to a shared root CSV file instead of the isolated tenant profile directory.
SCENARIO: 
1. A multi-tenant scrape is executed for tenant `crm-tenantA` using `python main.py --niche crm-tenantA`.
2. `use_profile()` initializes paths for `OUTPUT_FILE`, `TRACKING_DB_FILE`, etc., under `profiles/crm-tenantA/`, but leaves `PENDING_VERIFICATION_FILE` pointing to the global root path `Path("pending_email_verification.csv")`.
3. An extracted channel lead for `crm-tenantA` triggers a ZeroBounce API timeout during `verify_email()`.
4. `cache_pending_verification()` executes and appends `crm-tenantA`'s lead data (including URL, email address, and video transcript snippet) into `./pending_email_verification.csv`.
5. When a subsequent run for `crm-tenantB` encounters a timeout or reads the un-isolated root CSV file, tenant lead data and transcripts are exposed across tenant boundaries.
FIX: In `scraper/main.py`, update `use_profile()` to declare `global PENDING_VERIFICATION_FILE` and rebind it: `PENDING_VERIFICATION_FILE = profile.pending_verification`.

### Missing Profile Isolation in `process_lookalike.py` Causes Multi-Tenant Data Leakage
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: scraper/process_lookalike.py:38
WHAT: `process_lookalike.py` hardcodes input/output file locations to root workspace files (`lookalike_targets.txt`, `leads.csv`, `tracking.db`, `skipped.log`) and does not accept a `--niche` parameter or invoke `main.use_profile()`, bypassing multi-tenant profile isolation entirely.
SCENARIO:
1. An operator or automated task executes lookalike lead discovery for a specific tenant profile (e.g., `crm-tenant123`).
2. `process_lookalike.py` is invoked. Because it lacks CLI argument parsing for `--niche` and never calls `m.use_profile()`, it reads `lookalike_targets.txt` from the project root workspace directory.
3. Discovered lookalike channels are processed and written directly into root `tracking.db` and root `leads.csv` instead of `profiles/crm-tenant123/`.
4. This mutates global tracking state and leaks tenant lead rows into the shared root directory rather than isolating them within the tenant profile directory.
FIX: Add `--niche` argument parsing to `process_lookalike.py`, instantiate `SessionProfile(niche)`, call `m.use_profile(profile)`, and read seed targets from `profile.lookalike`.

### Unhandled Exception on Gemini Empty or Safety-Blocked Response in `orchestrator.py`
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: scraper/orchestrator.py:547
WHAT: `generate_keywords()` accesses `response.text` directly without verifying candidate presence or catching `ValueError`/`AttributeError`. When Vertex AI Gemini blocks a prompt due to safety or recitation filters, accessing `response.text` raises an unhandled `ValueError` in the `google-genai` SDK, crashing the orchestrator process.
SCENARIO:
1. `orchestrator.py` executes a daily cycle and calls `client.models.generate_content(...)` to generate niche keywords.
2. Vertex AI Gemini returns a `GenerateContentResponse` where response candidates are blocked by safety filters (`finish_reason = SAFETY`) or carry no text payload.
3. Line 547 executes `response.text.strip()`. The `google-genai` SDK raises `ValueError: The response.text quick accessor only works when the response has at least one candidate with text content.`
4. The exception escapes unhandled outside the retry loop, causing `orchestrator.py` to crash and halting the background daemon.
FIX: Wrap text extraction in `try...except (ValueError, AttributeError):` or check `if getattr(response, "text", None):` before calling `.splitlines()`, returning `[]` on missing or blocked text candidates so the failure is caught gracefully.

### Unclosed SQLite Database Connections in `_connect_webhook_db()` Cause Handle & File Lock Exhaustion
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: scraper/main.py:1855
WHAT: `_connect_webhook_db()` opens a new SQLite connection on every invocation (`init_webhook_db()`, `_enqueue_webhook()`, `flush_webhook_queue()`). Using `with _connect_webhook_db() as conn:` only manages transaction boundaries—it does not close the connection object upon exiting, leaking open file handles.
SCENARIO:
1. The scraper processes large batches of channels over extended runs.
2. Webhook delivery attempts experience transient network errors, invoking `_enqueue_webhook()` repeatedly, or `flush_webhook_queue()` processes queued payloads.
3. Every `with _connect_webhook_db() as conn:` block creates a new SQLite connection to `webhook_queue.db` that remains unclosed until garbage collection runs.
4. Accumulated unclosed file handles on Windows cause `sqlite3.OperationalError: database is locked` or `PermissionError` when switching profile directories or performing database cleanup.
FIX: Explicitly close the SQLite connection in a `finally` block or maintain a managed connection handle (similar to `_TRACKING_CONN`) that is closed upon profile switching or shutdown.

### Regex Delimiter Breakdown in `release_blacklist.py` Log Parser for Channel Titles with Parentheses
SEVERITY: LOW
CONFIDENCE: HIGH
FILE: scraper/release_blacklist.py:61
WHAT: `_LOG_LINE_RE` uses `SKIP (\S+) \(.*?\): (.+)$` to parse `skipped.log`. Because `\(.*?\)` matches non-greedily against the first closing parenthesis, channel titles containing nested parentheses fail to match the trailing `: ` delimiter, causing log-based skip reason extraction to fail.
SCENARIO:
1. A channel titled `Jane Doe (Business Coach)` was blacklisted during a prior run for `450 subs` before structured database reasons were implemented.
2. The subscriber band criteria is widened to allow channels with >=400 subscribers.
3. `release_blacklist.py` is run to evaluate and release eligible channels.
4. `_last_skip_messages()` reads line `SKIP UC123 (Jane Doe (Business Coach)): 450 subs — outside 1,000–50,000`.
5. `_LOG_LINE_RE.search()` matches `(` after `UC123` and non-greedily stops at `)` after `Business`. The remaining string ` Coach)): ...` fails to match `: `.
6. The regex returns `None`, the skip reason is categorized as `no_reason_found`, and the channel remains stuck in the blacklist.
FIX: Update `_LOG_LINE_RE` to match up to the final `): ` sequence preceding the message payload: `re.compile(r"SKIP (\S+) \((.*)\):\s+(.+)$")`.

---

## CHECKED AND SOUND

The following files and components were thoroughly inspected and verified as correct:

1. **`scraper/criteria.py`**:
   - `load()` properly merges dataclass defaults, profile `settings.json`, and `YSX_SCRAPER_*` environment variables with strict numerical bounds clamping via `_clamp()`.
   - Dataclass field aliases (`minSubs` -> `min_subs`, etc.) map Node/Prisma JSON schemas accurately.

2. **`scraper/payload_extractor.py`**:
   - `_extract_json_object()` handles arbitrary JSON nesting depth, quote escaping, and string state tracking correctly without catastrophic backtracking.
   - Metadata extraction methods (`_extract_duration_ms`, `_extract_view_count`, `_is_age_restricted`, `_is_private`, `_is_monetized`) include fallback checks matching `yt-dlp` internal extraction logic.

3. **`scraper/resilient_extractor.py`**:
   - `FallbackChain` cascade handles primary extractor failures gracefully, logging warnings without crashing the execution thread.
   - `parse_compact_number()` accurately handles compact number suffixes (`K`, `M`, `B`) and locale comma separators.

4. **`scraper/main.py` (Gauntlet & Pacing & Tracking DB)**:
   - `run_gauntlet()` handles zero-cost Tier-1 filters before executing flat yt-dlp metadata calls, preventing unnecessary socket overhead.
   - `is_seen()` query accurately accounts for expired `recheck_after` windows (`recheck_after <= datetime('now')`) to allow scheduled re-crawling of temporary rejections.
MODEL_USED=gemini-3.1-pro-high VIA=file
