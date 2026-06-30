# -*- coding: utf-8 -*-
"""临时：测试三个 loader 输出。跑完即删。"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import pandas as pd
from loaders import load_pugongying, load_star, load_chili

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
PGY = DESK + r"\小红星蒲公英数据\0630蒲公英数据示例.xlsx"
STAR = DESK + r"\小红星蒲公英数据\5月份星河数据.csv"
CHILI = DESK + r"\薯条投放\6月份薯条消耗明细.xlsx"

pgy = load_pugongying(PGY)
print("【蒲公英】", pgy.shape, "| index唯一:", pgy.index.is_unique)
print("  列:", list(pgy.columns))
print("  率字段范围(应0~1.5): play_5s", round(pgy["play_5s"].dropna().min(),3), "~", round(pgy["play_5s"].dropna().max(),3),
      "| 互动率", round(pgy["interact_rate"].dropna().min(),3), "~", round(pgy["interact_rate"].dropna().max(),3),
      "| 正文CTR", round(pgy["body_cta_ctr"].dropna().min(),3), "~", round(pgy["body_cta_ctr"].dropna().max(),3))
print("  总金额合计:", round(pgy["total_amount"].sum(),1))

agg, daily, smeta = load_star(STAR)
print("\n【星河】聚合", agg.shape, "| meta:", smeta)
print("  总进店:", int(agg["visit_uv"].sum()), "总成交:", int(agg["deal_uv"].sum()), "总GMV:", round(agg["gmv"].sum(),1))
print("  日维度:", None if daily is None else daily.shape, "| 列:", None if daily is None else list(daily.columns))

cagg, cmeta = load_chili(CHILI)
print("\n【薯条】聚合", cagg.shape, "| meta:", cmeta)
print("  列:", list(cagg.columns))
print("  总消耗:", round(cagg["spend"].sum(),1), "| 投放笔记数:", len(cagg))

# 连通
print("\n【连通】")
p, s, c = set(pgy.index), set(agg.index), set(cagg.index)
print("  星河∩蒲公英:", len(s & p), "/", len(s), "| 薯条∩蒲公英:", len(c & p), "/", len(c), "| 星河∩薯条:", len(s & c))
print("  当期主体(星河∪薯条):", len(s | c))
