import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from .runner import RUN_SLOTS, subscriber_range


class DiscoveryHelpersTest(unittest.TestCase):
    def test_subscriber_band(self):
        self.assertEqual(subscriber_range(1_000), "1k–3k")
        self.assertEqual(subscriber_range(4_999), "3k–5k")
        self.assertEqual(subscriber_range(10_000), "5k–10k")
        self.assertIsNone(subscriber_range(10_001))

    def test_cairo_slots_are_fixed(self):
        cairo = ZoneInfo("Africa/Cairo")
        self.assertIn(datetime(2026, 9, 8, 9, 0, tzinfo=cairo).strftime("%H:%M"), RUN_SLOTS)


if __name__ == "__main__":
    unittest.main()
