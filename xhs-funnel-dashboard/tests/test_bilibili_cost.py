import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from build_dashboard import compute_bilibili  # noqa: E402
from loaders import load_bilibili_ads  # noqa: E402


class BilibiliCostTest(unittest.TestCase):
    def setUp(self):
        self.star = pd.DataFrame([
            {"note_id": "BV1A", "date": 20260820, "creator": "甲", "url": "",
             "play_uv": 100, "visit_uv": 10, "cart_uv": 2, "deal_uv": 1, "gmv": 200},
            {"note_id": "BV1A", "date": 20260821, "creator": "甲", "url": "",
             "play_uv": 200, "visit_uv": 20, "cart_uv": 3, "deal_uv": 1, "gmv": 300},
            {"note_id": "BV1A", "date": 20260822, "creator": "甲", "url": "",
             "play_uv": 300, "visit_uv": 30, "cart_uv": 5, "deal_uv": 2, "gmv": 500},
            {"note_id": "BV1B", "date": 20260820, "creator": "乙", "url": "",
             "play_uv": 50, "visit_uv": 5, "cart_uv": 1, "deal_uv": 0, "gmv": 0},
            {"note_id": "BV1B", "date": 20260822, "creator": "乙", "url": "",
             "play_uv": 100, "visit_uv": 10, "cart_uv": 2, "deal_uv": 1, "gmv": 100},
        ])
        self.ads = pd.DataFrame([
            {"note_id": "BV1A", "date": 20260820, "spend": 30.0, "impression": 300, "click": 30, "title": "A"},
            {"note_id": "BV1A", "date": 20260822, "spend": 60.0, "impression": 600, "click": 60, "title": "A"},
            {"note_id": "BV1A", "date": 20260823, "spend": 90.0, "impression": 900, "click": 90, "title": "A"},
            {"note_id": "BV1B", "date": 20260822, "spend": 15.0, "impression": 150, "click": 15, "title": "B"},
            {"note_id": "BV9X", "date": 20260820, "spend": 99.0, "impression": 99, "click": 9, "title": "未匹配"},
        ])

    def test_cost_uses_common_dates_and_matching_bvids(self):
        result = compute_bilibili(self.star, self.ads)
        meta = result["cost_meta"]
        summary = result["cost_all"]["summary"]

        self.assertEqual(meta["effective_start"], 20260820)
        self.assertEqual(meta["effective_end"], 20260822)
        self.assertAlmostEqual(meta["excluded_after_cutoff_spend"], 90.0)
        self.assertAlmostEqual(meta["unmatched_spend"], 99.0)
        self.assertEqual(meta["matched_note_count"], 2)

        self.assertAlmostEqual(summary["spend"], 105.0)
        self.assertEqual(summary["play_uv"], 700.0)
        self.assertEqual(summary["visit_uv"], 70.0)
        self.assertEqual(summary["cart_uv"], 12.0)
        self.assertEqual(summary["deal_uv"], 5.0)
        self.assertAlmostEqual(summary["roi"], 1100.0 / 105.0)

        daily = result["cost_all"]["daily"]
        self.assertEqual([row[0] for row in daily], [20260820, 20260821, 20260822])
        self.assertEqual([row[1] for row in daily], [30.0, 0.0, 75.0])
        self.assertEqual([row[7] for row in daily], [1, 0, 2])
        self.assertAlmostEqual(daily[-1][6], 105.0 / 70.0)

    def test_single_video_daily_indexes_match_frontend_contract(self):
        result = compute_bilibili(self.star, self.ads)
        entry = result["cost"]["BV1A"]
        self.assertEqual(len(entry["daily"]), 3)
        last = entry["daily"][-1]
        self.assertEqual(last[:7], [20260822, 60.0, 30.0, 5.0, 2.0, 500.0, 300.0])
        self.assertAlmostEqual(entry["summary"]["uv_cost"], 90.0 / 600.0)
        self.assertAlmostEqual(entry["summary"]["visit_uv_cost"], 90.0 / 60.0)
        self.assertEqual(entry["summary"]["days"], 2)
        self.assertEqual(last[8:], [0.0, 60.0])

    def test_bihuo_creator_matches_unique_star_content_and_stacks_with_trilan(self):
        fire = pd.DataFrame([
            {"creator": " 甲 ", "date": 20260820, "bihuo_spend": 70.0, "bihuo_orders": 1},
            {"creator": "乙", "date": 20260822, "bihuo_spend": 20.0, "bihuo_orders": 1},
        ])
        result = compute_bilibili(self.star, self.ads, fire)
        summary = result["cost_all"]["summary"]
        self.assertAlmostEqual(summary["spend"], 195.0)
        self.assertAlmostEqual(summary["bihuo_spend"], 90.0)
        self.assertAlmostEqual(summary["trilan_spend"], 105.0)
        self.assertEqual(result["cost_meta"]["bihuo_note_count"], 2)
        self.assertEqual(result["cost_meta"]["both_note_count"], 2)
        self.assertEqual(result["cost_meta"]["unmatched_bihuo_spend"], 0)
        first = result["cost"]["BV1A"]["daily"][0]
        self.assertEqual(first[8:], [70.0, 30.0])

    def test_ambiguous_bihuo_creator_is_not_allocated(self):
        star = pd.concat([
            self.star,
            pd.DataFrame([{"note_id": "BV1C", "date": 20260822, "creator": "甲", "url": "",
                           "play_uv": 1, "visit_uv": 1, "cart_uv": 0, "deal_uv": 0, "gmv": 0}]),
        ], ignore_index=True)
        fire = pd.DataFrame([{"creator": "甲", "date": 20260820, "bihuo_spend": 70.0, "bihuo_orders": 1}])
        result = compute_bilibili(star, None, fire)
        self.assertIsNone(result["cost_all"])
        self.assertEqual(result["cost_meta"]["ambiguous_bihuo_spend"], 70.0)
        self.assertEqual(result["cost_meta"]["ambiguous_bihuo_creators"], ["甲"])

    def test_loader_rejects_weekly_range_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weekly.csv"
            pd.DataFrame([{"日期": "2026-08-17~2026-08-23", "bvid": "BV1A", "总花费": 10}]).to_csv(
                path, index=False, encoding="utf-8-sig"
            )
            with self.assertRaisesRegex(ValueError, "必须使用逐日明细报表"):
                load_bilibili_ads(str(path))

    def test_loader_rejects_unparseable_or_negative_spend(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            pd.DataFrame([{"日期": "2026-08-17", "bvid": "BV1A", "总花费": -1}]).to_csv(
                path, index=False, encoding="utf-8-sig"
            )
            with self.assertRaisesRegex(ValueError, "总花费为负数"):
                load_bilibili_ads(str(path))


if __name__ == "__main__":
    unittest.main()
