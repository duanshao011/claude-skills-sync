# -*- coding: utf-8 -*-
"""临时：测试 metrics.compute。跑完即删。"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import pandas as pd
pd.set_option("display.width", 200)
from loaders import load_pugongying, load_star, load_chili
from metrics import compute

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
pgy = load_pugongying(DESK + r"\小红星蒲公英数据\0630蒲公英数据示例.xlsx")
star_agg, daily, smeta = load_star(DESK + r"\小红星蒲公英数据\5月份星河数据.csv")
chili_agg, cmeta = load_chili(DESK + r"\薯条投放\6月份薯条消耗明细.xlsx")

master, waterlines, summary = compute(pgy, star_agg, chili_agg)

print("=== summary ===")
for k, v in summary.items():
    print(f"  {k}: {v}")

print("\n=== 四象限计数 ===", master["quadrant"].value_counts().to_dict())

print("\n=== ROI 健康检查 ===")
import numpy as np
roi = master["roi"]
print("  有ROI笔记:", roi.notna().sum(), "| inf/nan异常:", np.isinf(roi.fillna(0)).sum())
print("  ROI范围:", round(roi.min(),3), "~", round(roi.max(),3), "| 中位:", round(roi.median(),3))

print("\n=== 水位线(部分) ===")
for f in ["roi", "visit_rate", "deal_rate", "visit_cost"]:
    if f in waterlines:
        w = waterlines[f]
        print(f"  {w['label']}: P25={round(w['p25'],3)} P50={round(w['p50'],3)} P75={round(w['p75'],3)} dir={w['direction']}")

print("\n=== 重点追投象限 TOP5（未投薯条但转化好的种子）===")
seed = master[master["quadrant"] == "重点追投"].sort_values("conv_score", ascending=False)
cols = ["creator", "title", "spend", "gmv", "roi", "visit_uv", "deal_uv", "conv_score"]
cols = [c for c in cols if c in seed.columns]
print(seed[cols].head(5).to_string())

print("\n=== 止损象限 TOP5（投了钱但转化差）===")
stop = master[master["quadrant"] == "止损"].sort_values("spend", ascending=False)
print(stop[cols].head(5).to_string())
