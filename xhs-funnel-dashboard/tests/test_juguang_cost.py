import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from loaders import load_juguang  # noqa: E402
from metrics import build_cost_data, build_master  # noqa: E402


class JuguangLoaderTest(unittest.TestCase):
    def test_summary_row_is_excluded_and_later_file_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_path = Path(tmp) / "old.csv"
            new_path = Path(tmp) / "new.csv"
            pd.DataFrame([
                {"时间": "2026-08-01", "笔记ID": "a" * 24, "消费": 10, "展现量": 100, "点击量": 10},
                {"时间": "2026-08-02", "笔记ID": "a" * 24, "消费": 20, "展现量": 200, "点击量": 20},
            ]).to_csv(old_path, index=False, encoding="utf-8-sig")
            pd.DataFrame([
                {"时间": "合计2条记录", "笔记ID": "-", "消费": 30, "展现量": 0, "点击量": 0},
                {"时间": "2026-08-02", "笔记ID": "a" * 24, "消费": 25, "展现量": 250, "点击量": 25},
                {"时间": "2026-08-03", "笔记ID": "b" * 24, "消费": 5, "展现量": 50, "点击量": 5},
            ]).to_csv(new_path, index=False, encoding="utf-8-sig")

            aggregate, daily, meta = load_juguang([old_path, new_path])
            self.assertEqual(len(daily), 3)
            self.assertAlmostEqual(daily["juguang_spend"].sum(), 40)
            self.assertAlmostEqual(aggregate.loc["a" * 24, "juguang_spend"], 35)
            self.assertEqual(meta["summary_rows"], 1)
            self.assertAlmostEqual(meta["summary_diff"], 0)


class DualChannelCostTest(unittest.TestCase):
    def test_channels_sum_days_union_and_star_alignment(self):
        star_agg = pd.DataFrame([
            {"note_id": "A", "read_uv": 600, "visit_uv": 60, "cart_uv": 6, "deal_uv": 3, "gmv": 600},
            {"note_id": "B", "read_uv": 300, "visit_uv": 30, "cart_uv": 3, "deal_uv": 1, "gmv": 100},
        ]).set_index("note_id")
        chili_agg = pd.DataFrame([
            {"note_id": "A", "spend": 30, "chili_days": 1},
        ]).set_index("note_id")
        juguang_agg = pd.DataFrame([
            {"note_id": "A", "juguang_spend": 20, "juguang_days": 1},
            {"note_id": "B", "juguang_spend": 15, "juguang_days": 1},
        ]).set_index("note_id")
        chili_daily = pd.DataFrame([
            {"note_id": "A", "launch_date": 20260820, "spend": 30},
        ])
        juguang_daily = pd.DataFrame([
            {"note_id": "A", "date": 20260820, "juguang_spend": 20},
            {"note_id": "B", "date": 20260822, "juguang_spend": 10},
            {"note_id": "B", "date": 20260823, "juguang_spend": 5},
        ])
        star_daily = pd.DataFrame([
            {"note_id": "A", "date": 20260820, "read_uv": 100, "visit_uv": 10, "cart_uv": 1, "deal_uv": 1, "gmv": 200},
            {"note_id": "A", "date": 20260821, "read_uv": 200, "visit_uv": 20, "cart_uv": 2, "deal_uv": 1, "gmv": 300},
            {"note_id": "A", "date": 20260822, "read_uv": 300, "visit_uv": 30, "cart_uv": 3, "deal_uv": 1, "gmv": 100},
            {"note_id": "B", "date": 20260820, "read_uv": 200, "visit_uv": 20, "cart_uv": 2, "deal_uv": 0, "gmv": 0},
            {"note_id": "B", "date": 20260822, "read_uv": 100, "visit_uv": 10, "cart_uv": 1, "deal_uv": 1, "gmv": 100},
        ])

        master = build_master(None, star_agg, chili_agg, juguang_agg, None)
        master, cost, cost_all, meta = build_cost_data(chili_daily, juguang_daily, star_daily, master)
        self.assertAlmostEqual(master.loc["A", "spend"], 50)
        self.assertEqual(master.loc["A", "paid_days"], 1)
        self.assertAlmostEqual(cost_all["summary"]["spend"], 60)
        self.assertAlmostEqual(cost_all["summary"]["chili_spend"], 30)
        self.assertAlmostEqual(cost_all["summary"]["juguang_spend"], 30)
        self.assertEqual(cost_all["summary"]["visit_uv"], 70)
        self.assertAlmostEqual(meta["waiting_juguang_spend"], 5)
        self.assertEqual(meta["matched_note_count"], 2)
        self.assertEqual(cost["A"]["daily"][0][8:], [30.0, 20.0])
        self.assertEqual(cost["B"]["daily"][0][0], 20260822)

    def test_missing_channel_uses_available_spend_without_faking_channel_data(self):
        star_agg = pd.DataFrame([
            {"note_id": "A", "read_uv": 100, "visit_uv": 10, "cart_uv": 1, "deal_uv": 1, "gmv": 100},
        ]).set_index("note_id")
        chili_agg = pd.DataFrame([{"note_id": "A", "spend": 30, "chili_days": 1}]).set_index("note_id")
        chili_daily = pd.DataFrame([{"note_id": "A", "launch_date": 20260820, "spend": 30}])
        star_daily = pd.DataFrame([
            {"note_id": "A", "date": 20260820, "read_uv": 100, "visit_uv": 10, "cart_uv": 1, "deal_uv": 1, "gmv": 100},
        ])
        master = build_master(None, star_agg, chili_agg, None, None)
        master, _, cost_all, meta = build_cost_data(chili_daily, None, star_daily, master)
        self.assertAlmostEqual(master.loc["A", "spend"], 30)
        self.assertAlmostEqual(master.loc["A", "juguang_spend"], 0)
        self.assertAlmostEqual(cost_all["summary"]["spend"], 30)
        self.assertAlmostEqual(meta["full_juguang_spend"], 0)
        self.assertFalse(bool(master.loc["A", "in_juguang"]))


if __name__ == "__main__":
    unittest.main()
