# -*- coding: utf-8 -*-
"""业务分析：加载四表 → 输出多维度诊断数据（供报告使用）"""
import sys, os, json
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loaders import load_pugongying, load_star, load_chili, load_lingxi

D = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件"

pgy = pd.concat([
    load_pugongying(os.path.join(D, "0724蒲公英123456月份数据_勿删.xlsx")),
    load_pugongying(os.path.join(D, "0722蒲公英7月份笔记.xlsx")),
])
pgy = pgy[~pgy.index.duplicated(keep="last")]

star, star_daily, star_meta = load_star([
    os.path.join(D, "0716旧版星河1234月份_勿删.xlsx"),
    os.path.join(D, "0727星河4567月份.csv"),
])

chili, chili_daily, chili_meta = load_chili([
    os.path.join(D, "0706薯条明细23456月份_勿删.xlsx"),
    os.path.join(D, "0727薯条订单明细7月份.xlsx"),
])

lx = load_lingxi(os.path.join(D, "0724灵犀种草贡献笔记TOP榜单.xlsx"))

print("=" * 70)
print("表规模")
print("=" * 70)
print(f"蒲公英笔记数: {len(pgy)}")
print(f"星河笔记数:   {len(star)}")
print(f"薯条笔记数:   {len(chili)}")
print(f"灵犀笔记数:   {len(lx)}")
print()
print("蒲公英列:", list(pgy.columns))
print()
print("星河列:", list(star.columns))
print()
print("薯条列:", list(chili.columns))
print()
print("灵犀列:", list(lx.columns))
print()

print("=" * 70)
print("覆盖交集")
print("=" * 70)
s_pgy, s_star, s_chili, s_lx = set(pgy.index), set(star.index), set(chili.index), set(lx.index)
print(f"蒲公英 ∩ 星河:  {len(s_pgy & s_star)}")
print(f"蒲公英 ∩ 薯条:  {len(s_pgy & s_chili)}")
print(f"星河 ∩ 薯条:    {len(s_star & s_chili)}")
print(f"四表全齐:       {len(s_pgy & s_star & s_chili & s_lx)}")
print(f"并集:           {len(s_pgy | s_star | s_chili | s_lx)}")
print()

print("=" * 70)
print("整体大盘")
print("=" * 70)
print(f"薯条总实付:   {chili['spend'].sum():,.0f}")
print(f"星河总GMV:    {star['gmv'].sum():,.0f}")
inter = list(s_star & s_chili)
print(f"交集笔记数:   {len(inter)}")
print(f"交集GMV:      {star.loc[inter,'gmv'].sum():,.0f}")
print(f"交集实付:     {chili.loc[inter,'spend'].sum():,.0f}")
print(f"交集ROI:      {star.loc[inter,'gmv'].sum()/chili.loc[inter,'spend'].sum():.2f}")
print()
print(f"星河总阅读UV: {star['read_uv'].sum():,.0f}")
print(f"星河总进店UV: {star['visit_uv'].sum():,.0f}")
print(f"星河总加购UV: {star['cart_uv'].sum():,.0f}")
print(f"星河总成交UV: {star['deal_uv'].sum():,.0f}")
print()
print(f"进店率(进店/阅读): {star['visit_uv'].sum()/star['read_uv'].sum()*100:.2f}%")
print(f"加购率(加购/进店): {star['cart_uv'].sum()/star['visit_uv'].sum()*100:.2f}%")
print(f"成交率(成交/进店): {star['deal_uv'].sum()/star['visit_uv'].sum()*100:.2f}%")
print(f"加购→成交:        {star['deal_uv'].sum()/star['cart_uv'].sum()*100:.2f}%")
print()

print("=" * 70)
print("蒲公英前端数据分布")
print("=" * 70)
for c in ["read_uv", "avg_view_time", "body_cta_ctr", "interact_rate", "total_amount", "quote_price"]:
    if c in pgy.columns:
        s = pgy[c].dropna()
        s = s[s > 0]
        if len(s):
            print(f"{c:18s} n={len(s):4d} 均值={s.mean():>12,.2f} 中位={s.median():>12,.2f} P25={s.quantile(.25):>10,.2f} P75={s.quantile(.75):>10,.2f} max={s.max():>12,.2f}")
print()

print("=" * 70)
print("薯条投放分布")
print("=" * 70)
s = chili["spend"]
print(f"单篇实付: n={len(s)} 总={s.sum():,.0f} 均值={s.mean():,.0f} 中位={s.median():,.0f} P25={s.quantile(.25):,.0f} P75={s.quantile(.75):,.0f} max={s.max():,.0f}")
if "chili_days" in chili:
    d = chili["chili_days"]
    print(f"投放天数: 均值={d.mean():.1f} 中位={d.median():.0f} max={d.max():.0f}")
print()
