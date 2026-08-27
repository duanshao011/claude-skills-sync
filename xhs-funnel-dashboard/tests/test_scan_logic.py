import os
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from build_dashboard import scan_data_dir  # noqa: E402
from loaders import load_bilibili  # noqa: E402


class ScanLogicTest(unittest.TestCase):
    def test_platform_directory_takes_priority_and_keeps_all_bilibili_star_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            xhs = root / "01-小红书"
            bili = root / "03-B站"
            xhs.mkdir()
            bili.mkdir()
            xhs_star = xhs / "星河小红书.csv"
            bili_june = bili / "0825星河6月份数据.csv"
            bili_august = bili / "0825星河8月份数据.csv"
            for path in (xhs_star, bili_june, bili_august):
                path.write_text("placeholder", encoding="utf-8")

            result = scan_data_dir(str(root))

            self.assertEqual(result["star"], [str(xhs_star)])
            self.assertEqual(result["bili"], [str(bili_june), str(bili_august)])

    def test_bilibili_later_file_overrides_same_content_and_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "01.csv"
            second = root / "02.csv"
            columns = {
                "内容ID": ["BV1"], "日期": [20260801], "达人昵称": ["达人"],
                "阅读/播放UV": [100], "进店UV": [10], "商品加购UV": [2],
                "成交UV": [1], "商家GMV": [50],
            }
            pd.DataFrame(columns).to_csv(first, index=False, encoding="utf-8-sig")
            columns["进店UV"] = [20]
            pd.DataFrame(columns).to_csv(second, index=False, encoding="utf-8-sig")

            result = load_bilibili([str(first), str(second)])

            self.assertEqual(len(result), 1)
            self.assertEqual(result.iloc[0]["visit_uv"], 20)


if __name__ == "__main__":
    unittest.main()
