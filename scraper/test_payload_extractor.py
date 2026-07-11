"""
Test suite for payload_extractor module.

Validates regex patterns, extraction logic, schema conformance, and edge cases.
Includes a regression test against a real, saved YouTube watch-page fetch
(test_fixtures/) so future changes are checked against actual production HTML,
not just hand-written synthetic payloads that can silently encode the same
wrong assumptions the code makes.
"""

import json
from pathlib import Path

from payload_extractor import (
    extract_payload,
    extract_metadata,
    extract_from_html,
    validate_schema,
    VideoMetadata,
)

_FIXTURES_DIR = Path(__file__).parent / "test_fixtures"


def test_extract_payload_valid():
    """Test extraction of valid ytInitialPlayerResponse from raw HTML."""
    html = '''
    <html>
    <script>
    var ytInitialPlayerResponse = {"videoDetails": {"videoId": "dQw4w9WgXcQ", "title": "Test Video", "lengthSeconds": "212"}};
    </script>
    </html>
    '''
    payload = extract_payload(html)
    assert payload is not None
    assert payload.get("videoDetails", {}).get("videoId") == "dQw4w9WgXcQ"
    print("[PASS] test_extract_payload_valid")


def test_extract_payload_nested_braces():
    """Test extraction with nested JSON objects."""
    html = '''
    var ytInitialPlayerResponse = {"videoDetails": {"videoId": "test123", "metadata": {"nested": "value"}}};
    '''
    payload = extract_payload(html)
    assert payload is not None
    assert payload["videoDetails"]["videoId"] == "test123"
    print("[PASS]test_extract_payload_nested_braces")


def test_extract_payload_missing():
    """Test graceful handling of missing payload."""
    html = '<html><body>No payload here</body></html>'
    payload = extract_payload(html)
    assert payload is None
    print("[PASS]test_extract_payload_missing")


def test_extract_payload_invalid_json():
    """Test handling of malformed JSON."""
    html = 'var ytInitialPlayerResponse = {invalid json};'
    payload = extract_payload(html)
    assert payload is None
    print("[PASS]test_extract_payload_invalid_json")


def test_extract_payload_no_var_prefix():
    """yt-dlp's own extractor pattern has no 'var' requirement — some page
    variants assign ytInitialPlayerResponse without a leading declaration
    keyword. The extractor must match those too.
    """
    html = 'ytInitialPlayerResponse = {"videoDetails": {"videoId": "test123"}};'
    payload = extract_payload(html)
    assert payload is not None
    assert payload["videoDetails"]["videoId"] == "test123"
    print("[PASS]test_extract_payload_no_var_prefix")


def test_extract_payload_null_then_real_object():
    """Unavailable/error-state pages can emit a leading
    'ytInitialPlayerResponse = null;' before the real object appears later in
    the page. Extraction must fall through to the next match instead of
    aborting on the first non-object occurrence.
    """
    html = '''
    var ytInitialPlayerResponse = null;
    <script>
    var ytInitialPlayerResponse = {"videoDetails": {"videoId": "realvidid1"}};
    </script>
    '''
    payload = extract_payload(html)
    assert payload is not None
    assert payload["videoDetails"]["videoId"] == "realvidid1"
    print("[PASS]test_extract_payload_null_then_real_object")


def test_extract_payload_brace_inside_string_value():
    """A description/title containing literal '};' inside a JSON string must
    not be mistaken for the end of the object (a known real-world YouTube
    edge case — see ytdl-org/youtube-dl#27093 and #27216).
    """
    html = (
        'var ytInitialPlayerResponse = '
        '{"videoDetails": {"videoId": "test123", '
        '"shortDescription": "weird content }; here"}};'
    )
    payload = extract_payload(html)
    assert payload is not None
    assert payload["videoDetails"]["videoId"] == "test123"
    assert payload["videoDetails"]["shortDescription"] == "weird content }; here"
    print("[PASS]test_extract_payload_brace_inside_string_value")


def test_extract_metadata_full():
    """Test full metadata extraction with all fields, using the real payload
    shape verified against a live YouTube watch-page fetch (category,
    publishDate, isUnlisted, isFamilySafe all live under
    microformat.playerMicroformatRenderer, not microformat directly; ad
    signals live under top-level adPlacements/adBreakHeartbeatParams, not
    streamingData).
    """
    payload = {
        "videoDetails": {
            "videoId": "dQw4w9WgXcQ",
            "title": "Never Gonna Give You Up",
            "lengthSeconds": "212",
            "viewCount": "1000000",
            "channelId": "UCuAXFkgsw1L7xaCfnd5J5KQ",
            "author": "Rick Astley",
            "keywords": ["rickroll", "prank"],
            "isLiveContent": False,
            "isPrivate": False,
            "isUpcoming": False,
        },
        "microformat": {
            "playerMicroformatRenderer": {
                "category": "Music",
                "publishDate": "2009-10-25",
                "isUnlisted": False,
                "isFamilySafe": True,
            },
        },
        "contentRating": {},
        "playabilityStatus": {
            "status": "OK",
        },
        "streamingData": {
            "formats": [{"itag": 18}],
        },
        "adPlacements": [{"adPlacementRenderer": {"config": {}}}],
    }
    metadata = extract_metadata(payload)
    assert metadata.video_id == "dQw4w9WgXcQ"
    assert metadata.title == "Never Gonna Give You Up"
    assert metadata.duration_ms == 212000
    assert metadata.view_count == 1000000
    assert metadata.channel_id == "UCuAXFkgsw1L7xaCfnd5J5KQ"
    assert metadata.channel_name == "Rick Astley"
    assert metadata.keywords == ["rickroll", "prank"]
    assert metadata.is_live is False
    assert metadata.is_unlisted is False
    assert metadata.is_premiere is False
    assert metadata.is_age_restricted is False
    assert metadata.is_private is False
    assert metadata.is_monetized is True
    assert metadata.category == "Music"
    assert metadata.upload_date == "2009-10-25"
    assert metadata.content_rating == ""
    assert metadata.is_restricted_mode_safe is True
    print("[PASS]test_extract_metadata_full")


def test_extract_metadata_age_restricted():
    """Test detection of age-restricted videos using the actual phrase list
    yt-dlp's extractor matches against (YoutubeIE._is_agegated) — a bare
    'age' substring match, the prior implementation, false-positives on
    ordinary words like 'average' or 'storage'.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Restricted",
            "lengthSeconds": "100",
        },
        "playabilityStatus": {
            "reason": "This video may be inappropriate for some users.",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_age_restricted is True
    print("[PASS]test_extract_metadata_age_restricted")


def test_extract_metadata_age_restricted_no_false_positive_on_average():
    """Regression test: the word 'average' contains the substring 'age' and
    must NOT trigger a false-positive age-restriction flag.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Storage tips",
            "lengthSeconds": "100",
        },
        "playabilityStatus": {
            "status": "OK",
            "reason": "This video has an average storage usage rating",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_age_restricted is False
    print("[PASS]test_extract_metadata_age_restricted_no_false_positive_on_average")


def test_extract_metadata_age_restricted_desktop_legacy_reason():
    """desktopLegacyAgeGateReason presence alone (yt-dlp's primary signal)
    must be honored even with no matching reason phrase.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Restricted",
            "lengthSeconds": "100",
        },
        "playabilityStatus": {
            "status": "OK",
            "desktopLegacyAgeGateReason": 1,
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_age_restricted is True
    print("[PASS]test_extract_metadata_age_restricted_desktop_legacy_reason")


def test_extract_metadata_private():
    """Test detection of private videos via the direct videoDetails.isPrivate
    boolean — the field yt-dlp itself reads, and the primary signal (not the
    playabilityStatus.status fallback, which is for removed/unplayable videos
    where videoDetails may be thin or absent).
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Private",
            "lengthSeconds": "100",
            "isPrivate": True,
        },
        "playabilityStatus": {
            "status": "OK",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_private is True
    print("[PASS]test_extract_metadata_private")


def test_extract_metadata_private_fallback_unplayable():
    """Test the playabilityStatus.status fallback for removed videos where
    videoDetails.isPrivate is absent entirely.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Removed",
            "lengthSeconds": "100",
        },
        "playabilityStatus": {
            "status": "UNPLAYABLE",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_private is True
    print("[PASS]test_extract_metadata_private_fallback_unplayable")


def test_extract_metadata_unlisted():
    """Test detection of unlisted videos — isUnlisted lives under
    microformat.playerMicroformatRenderer, not videoDetails (verified against
    a live watch-page fetch; videoDetails carries no such key at all).
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Unlisted",
            "lengthSeconds": "100",
        },
        "microformat": {
            "playerMicroformatRenderer": {
                "isUnlisted": True,
            },
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_unlisted is True
    print("[PASS]test_extract_metadata_unlisted")


def test_extract_metadata_live():
    """Test detection of live/streaming content."""
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Live Stream",
            "lengthSeconds": "3600",
            "isLiveContent": True,
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_live is True
    print("[PASS]test_extract_metadata_live")


def test_extract_metadata_premiere():
    """Test detection of YouTube Premieres."""
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Premiere",
            "lengthSeconds": "100",
            "isUpcoming": True,
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_premiere is True
    print("[PASS]test_extract_metadata_premiere")


def test_extract_metadata_short_form():
    """Test detection of Shorts (< 60 seconds)."""
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Short",
            "lengthSeconds": "30",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.short_form is True
    print("[PASS]test_extract_metadata_short_form")


def test_extract_metadata_live_zero_duration_not_short_form():
    """Regression test: a live stream reports lengthSeconds='0' while it is
    still running (duration is unknown until it ends). That must not be
    conflated with short-form content — is_live and short_form being both
    True on the same video is a logical inconsistency validate_schema
    rejects, so a currently-running livestream must never trip it.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Live Stream In Progress",
            "lengthSeconds": "0",
            "isLiveContent": True,
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.is_live is True
    assert metadata.short_form is False
    print("[PASS]test_extract_metadata_live_zero_duration_not_short_form")


def test_extract_metadata_not_monetized():
    """Test detection of non-monetized videos — absence of adPlacements and
    adBreakHeartbeatParams (the real signal; streamingData.formats is present
    on virtually every playable video and is not a monetization indicator).
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "No Ads",
            "lengthSeconds": "100",
        },
        "playabilityStatus": {"status": "OK"},
        "streamingData": {"formats": [{"itag": 18}]},
    }
    metadata = extract_metadata(payload)
    assert metadata.is_monetized is False
    print("[PASS]test_extract_metadata_not_monetized")


def test_extract_metadata_monetized_via_ad_break_heartbeat():
    """adBreakHeartbeatParams alone (mid-roll ad scheduling) is also a valid
    monetization signal, independent of adPlacements.
    """
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Mid-roll Ads",
            "lengthSeconds": "600",
        },
        "adBreakHeartbeatParams": "some_opaque_param_string",
    }
    metadata = extract_metadata(payload)
    assert metadata.is_monetized is True
    print("[PASS]test_extract_metadata_monetized_via_ad_break_heartbeat")


def test_extract_metadata_hidden_view_count():
    """Test handling of videos with hidden view counts."""
    payload = {
        "videoDetails": {
            "videoId": "test123",
            "title": "Hidden Views",
            "lengthSeconds": "100",
        },
    }
    metadata = extract_metadata(payload)
    assert metadata.view_count is None
    print("[PASS]test_extract_metadata_hidden_view_count")


def test_validate_schema_valid():
    """Test schema validation for valid metadata."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="Valid Video",
        duration_ms=200000,
        channel_id="UC123",
    )
    assert validate_schema(metadata) is True
    print("[PASS]test_validate_schema_valid")


def test_validate_schema_invalid_video_id():
    """Test schema validation rejects invalid video IDs."""
    metadata = VideoMetadata(
        video_id="short",  # Not 11 chars
        title="Invalid",
        duration_ms=200000,
        channel_id="UC123",
    )
    assert validate_schema(metadata) is False
    print("[PASS]test_validate_schema_invalid_video_id")


def test_validate_schema_missing_title():
    """Test schema validation rejects videos without titles."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="",
        duration_ms=200000,
        channel_id="UC123",
    )
    assert validate_schema(metadata) is False
    print("[PASS]test_validate_schema_missing_title")


def test_validate_schema_negative_duration():
    """Test schema validation rejects negative durations."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="Invalid",
        duration_ms=-1000,
        channel_id="UC123",
    )
    assert validate_schema(metadata) is False
    print("[PASS]test_validate_schema_negative_duration")


def test_validate_schema_private_and_monetized():
    """Test schema validation rejects logically inconsistent states."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="Invalid",
        duration_ms=200000,
        channel_id="UC123",
        is_private=True,
        is_monetized=True,
    )
    assert validate_schema(metadata) is False
    print("[PASS]test_validate_schema_private_and_monetized")


def test_validate_schema_live_and_short():
    """Test schema validation rejects live + short combination."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="Invalid",
        duration_ms=30000,
        channel_id="UC123",
        is_live=True,
        short_form=True,
    )
    assert validate_schema(metadata) is False
    print("[PASS]test_validate_schema_live_and_short")


def test_extract_from_html_end_to_end():
    """Test end-to-end extraction from HTML."""
    html = '''
    <html>
    <script>
    var ytInitialPlayerResponse = {
        "videoDetails": {
            "videoId": "dQw4w9WgXcQ",
            "title": "Test Video",
            "lengthSeconds": "180",
            "channelId": "UC123",
            "author": "Test Channel"
        },
        "playabilityStatus": {"status": "OK"},
        "streamingData": {"formats": [{"itag": 18}]}
    };
    </script>
    </html>
    '''
    metadata = extract_from_html(html)
    assert metadata is not None
    assert metadata.video_id == "dQw4w9WgXcQ"
    assert metadata.title == "Test Video"
    assert validate_schema(metadata) is True
    print("[PASS]test_extract_from_html_end_to_end")


def test_extract_from_html_missing_payload():
    """Test end-to-end extraction with missing payload."""
    html = '<html><body>No payload</body></html>'
    metadata = extract_from_html(html)
    assert metadata is None
    print("[PASS]test_extract_from_html_missing_payload")


def test_extract_from_html_missing_video_id():
    """Test end-to-end extraction with missing video ID."""
    html = '''
    <script>
    var ytInitialPlayerResponse = {"videoDetails": {"title": "No ID"}};
    </script>
    '''
    metadata = extract_from_html(html)
    assert metadata is None
    print("[PASS]test_extract_from_html_missing_video_id")


def test_metadata_to_dict():
    """Test serialization to dictionary."""
    metadata = VideoMetadata(
        video_id="dQw4w9WgXcQ",
        title="Test",
        duration_ms=200000,
        channel_id="UC123",
        is_age_restricted=True,
    )
    d = metadata.to_dict()
    assert d["video_id"] == "dQw4w9WgXcQ"
    assert d["is_age_restricted"] is True
    assert "raw_data" not in d  # raw_data is excluded from to_dict
    print("[PASS]test_metadata_to_dict")


def test_extract_from_html_real_fixture():
    """Regression test against a real, saved YouTube watch-page fetch.

    This is the test that actually caught the schema-path bugs in the first
    version of this module (category/upload_date/is_unlisted/is_monetized were
    all reading paths that don't exist in production HTML, so every synthetic
    unit test above passed while the module silently returned empty/wrong
    values against real pages). Skips gracefully if the fixture is absent.
    """
    fixture = _FIXTURES_DIR / "watch_page_dQw4w9WgXcQ.html"
    if not fixture.exists():
        print("[SKIP]test_extract_from_html_real_fixture (fixture not present)")
        return
    html = fixture.read_text(encoding="utf-8")
    metadata = extract_from_html(html)
    assert metadata is not None
    assert metadata.video_id == "dQw4w9WgXcQ"
    assert "Rick Astley" in metadata.title
    assert metadata.duration_ms > 0
    assert metadata.channel_id
    assert metadata.category == "Music"          # was "" before the path fix
    assert metadata.upload_date.startswith("2009")  # was "" before the path fix
    assert metadata.is_monetized is True           # was always True regardless before the fix
    assert metadata.is_private is False
    assert metadata.is_unlisted is False
    assert metadata.is_age_restricted is False
    assert validate_schema(metadata) is True
    print("[PASS]test_extract_from_html_real_fixture")


def run_all_tests():
    """Run the full test suite."""
    print("\n" + "=" * 60)
    print("PAYLOAD EXTRACTOR TEST SUITE")
    print("=" * 60 + "\n")

    test_extract_payload_valid()
    test_extract_payload_nested_braces()
    test_extract_payload_missing()
    test_extract_payload_invalid_json()
    test_extract_payload_no_var_prefix()
    test_extract_payload_null_then_real_object()
    test_extract_payload_brace_inside_string_value()
    test_extract_metadata_full()
    test_extract_metadata_age_restricted()
    test_extract_metadata_age_restricted_no_false_positive_on_average()
    test_extract_metadata_age_restricted_desktop_legacy_reason()
    test_extract_metadata_private()
    test_extract_metadata_private_fallback_unplayable()
    test_extract_metadata_unlisted()
    test_extract_metadata_live()
    test_extract_metadata_premiere()
    test_extract_metadata_short_form()
    test_extract_metadata_live_zero_duration_not_short_form()
    test_extract_metadata_not_monetized()
    test_extract_metadata_monetized_via_ad_break_heartbeat()
    test_extract_metadata_hidden_view_count()
    test_validate_schema_valid()
    test_validate_schema_invalid_video_id()
    test_validate_schema_missing_title()
    test_validate_schema_negative_duration()
    test_validate_schema_private_and_monetized()
    test_validate_schema_live_and_short()
    test_extract_from_html_end_to_end()
    test_extract_from_html_missing_payload()
    test_extract_from_html_missing_video_id()
    test_extract_from_html_real_fixture()
    test_metadata_to_dict()

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED [OK]")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    run_all_tests()
