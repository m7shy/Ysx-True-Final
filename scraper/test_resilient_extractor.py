"""Tests for the self-healing fallback extraction layer."""

import logging
from pathlib import Path

import pytest

import resilient_extractor as rex

FIXTURE = Path(__file__).parent / "test_fixtures" / "watch_page_dQw4w9WgXcQ.html"


@pytest.fixture(scope="module")
def watch_html() -> str:
    return FIXTURE.read_text(encoding="utf-8", errors="ignore")


# ── parse_compact_number ──────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("1,234", 1234),
    ("1.23K subscribers", 1230),
    ("4.5M", 4_500_000),
    ("2B", 2_000_000_000),
    ("987 subscribers", 987),
    ("no digits here", None),
    ("", None),
])
def test_parse_compact_number(text, expected):
    assert rex.parse_compact_number(text) == expected


# ── FallbackChain mechanics ───────────────────────────────────────────────────

def test_chain_primary_success_is_silent(caplog):
    chain = rex.FallbackChain("f", [("primary", lambda s: 42)])
    with caplog.at_level(logging.WARNING, logger="fallback"):
        assert chain.run("src") == 42
    assert not caplog.records


def test_chain_fallback_fires_targeted_warning(caplog):
    chain = rex.FallbackChain("f", [
        ("primary", lambda s: None),                       # empty result
        ("boom", lambda s: 1 / 0),                         # fault is trapped
        ("rescue", lambda s: 7),
    ])
    with caplog.at_level(logging.WARNING, logger="fallback"):
        assert chain.run("src") == 7
    assert any("'rescue'" in r.message and "'f'" in r.message
               for r in caplog.records)


def test_chain_upstream_primary_logs_even_on_first_step(caplog):
    chain = rex.FallbackChain("f", [("step0", lambda s: 5)])
    with caplog.at_level(logging.WARNING, logger="fallback"):
        assert chain.run("src", upstream_primary="yt-dlp field") == 5
    assert any("yt-dlp field" in r.message for r in caplog.records)


def test_chain_all_fail_raises_clean_error():
    chain = rex.FallbackChain("f", [
        ("a", lambda s: None),
        ("b", lambda s: []),
    ])
    with pytest.raises(rex.ExtractionRecoveryError, match="field 'f'"):
        chain.run("src")


def test_zero_is_a_valid_value_not_a_miss():
    chain = rex.FallbackChain("f", [("primary", lambda s: 0)])
    assert chain.run("src") == 0


# ── Recovery against the real fixture watch page ─────────────────────────────

def test_view_count_from_fixture(watch_html):
    views = rex.recover_view_count(watch_html)
    assert isinstance(views, int) and views > 1_000_000


def test_duration_from_fixture(watch_html):
    assert 60 < rex.recover_duration_secs(watch_html) < 600


def test_upload_date_from_fixture(watch_html):
    assert rex.recover_upload_date(watch_html).startswith("2009")


# ── Recovery when the primary JSON structure is gone (simulated drift) ───────

def test_views_meta_tag_fallback(caplog):
    html = '<html><meta itemprop="interactionCount" content="123456"></html>'
    with caplog.at_level(logging.WARNING, logger="fallback"):
        assert rex.recover_view_count(html) == 123456
    assert any("meta-itemprop-interactionCount" in r.message
               for r in caplog.records)


def test_duration_meta_tag_fallback():
    html = '<meta itemprop="duration" content="PT1H2M3S">'
    assert rex.recover_duration_secs(html) == 3723


def test_subscriber_simpletext():
    html = '"subscriberCountText":{"simpleText":"9.87K subscribers"}'
    assert rex.recover_subscriber_count(html) == 9870


def test_subscriber_viewmodel_content_fallback(caplog):
    html = '{"content":"1.2K subscribers"}'
    with caplog.at_level(logging.WARNING, logger="fallback"):
        assert rex.recover_subscriber_count(html) == 1200
    assert any("json-viewmodel-content" in r.message for r in caplog.records)


def test_subscriber_raw_index_last_resort():
    html = "totally new layout … 4.5K subscribers … nothing structured"
    assert rex.recover_subscriber_count(html) == 4500


def test_subscriber_unrecoverable_raises():
    with pytest.raises(rex.ExtractionRecoveryError):
        rex.recover_subscriber_count("<html>no counts anywhere</html>")


# ── guarded() wrapper ─────────────────────────────────────────────────────────

def test_guarded_returns_primary_without_fetch():
    assert rex.guarded(
        "f", primary=lambda: 11,
        recover=lambda h: 99,
        html_getter=lambda: (_ for _ in ()).throw(AssertionError("must not fetch")),
    ) == 11


def test_guarded_falls_back_on_primary_fault():
    def bad_primary():
        raise KeyError("structure changed")
    assert rex.guarded(
        "f", primary=bad_primary,
        recover=lambda h: 99,
        html_getter=lambda: "<html>",
    ) == 99


def test_guarded_raises_when_no_html():
    with pytest.raises(rex.ExtractionRecoveryError):
        rex.guarded("f", primary=lambda: None,
                    recover=lambda h: 1, html_getter=lambda: None)
