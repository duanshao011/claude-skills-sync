# -*- coding: utf-8 -*-
"""临时：测试 insights。跑完即删。"""
import sys, json
sys.stdout.reconfigure(encoding="utf-8")
from loaders import load_pugongying, load_star, load_chili
from metrics import compute
from insights import compute_insights

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
pgy = load_pugongying(DESK + r"\小红星蒲公英数据\0630蒲公英数据示例.xlsx")
star_agg, daily, smeta = load_star(DESK + r"\小红星蒲公英数据\5月份星河数据.csv")
chili_agg, cmeta = load_chili(DESK + r"\薯条投放\6月份薯条消耗明细.xlsx")
master, waterlines, summary = compute(pgy, star_agg, chili_agg)

ins = compute_insights(master)
print("成功集笔记数:", ins.get("success_count"), "| ROI阈值:", ins.get("roi_threshold"), "| note:", ins.get("note"))
print("\n=== 可执行结论 ===")
for c in ins["conclusions"]:
    print(f"  [{c['dim']}] {c['text']} → {c['action']}")
print("\n=== 各维度分布(前3) ===")
for d in ins["dimensions"]:
    top = d["items"][:3]
    print(f"  {d['name']}:")
    for it in top:
        print(f"    {it['value']}: 成功{it['success_share']} 全体{it['overall_share']} lift={it['lift']}")
print("\n=== 高ROI且稳定的达人 ===")
for s in ins["stable_creators"]:
    print(f"  {s['creator']}: {s['note_count']}篇 ROI中位={s['roi_median']} 波动cv={s['cv']}")
