# -*- coding: utf-8 -*-
"""临时探查：验证三表读取口径，确认后据此写 loaders。跑完即删。"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import pandas as pd

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
PGY = DESK + r"\小红星蒲公英数据\0630蒲公英数据示例.xlsx"
STAR = DESK + r"\小红星蒲公英数据\5月份星河数据.csv"
CHILI = DESK + r"\薯条投放\6月份薯条消耗明细.xlsx"

print("=" * 60)
print("【1】蒲公英 header=2")
pgy = pd.read_excel(PGY, header=2)
print("shape:", pgy.shape)
print("笔记id 在列名:", "笔记id" in pgy.columns)
print("笔记id 唯一数:", pgy["笔记id"].nunique(), "/ 行数", len(pgy), "| 唯一:", pgy["笔记id"].is_unique)
print("发布日期样例:", pgy["笔记发布日期"].dropna().head(3).tolist())
print("总金额样例:", pgy["总金额"].dropna().head(3).tolist())
need = ["5s播放率","3s阅读率","平均浏览时长","视频完播率","互动率","正文组件CTR",
        "评论区组件CTR","自然阅读量","推广阅读量","笔记类型","内容标签","博主粉丝量",
        "阅读UV","博主报价","服务费金额","博主昵称","笔记标题"]
miss = [c for c in need if c not in pgy.columns]
print("缺失关键列:", miss if miss else "无")

print("=" * 60)
print("【2】星河 utf-8-sig")
star = pd.read_csv(STAR, encoding="utf-8-sig", dtype={"内容ID": str})
print("shape:", star.shape)
print("流量类型取值:", star["流量类型"].unique().tolist())
print("归因周期取值:", star["归因周期"].unique().tolist())
# 锁口径
f = star[(star["流量类型"] == "全部流量") & (star["归因周期"].astype(str).isin(["30","30.0"]))].copy()
print("锁口径后行数:", len(f), "| 唯一内容ID:", f["内容ID"].nunique())
num_cols = ["阅读/播放UV","进店UV","新客进店uv","搜索进店UV","商品加购UV","成交UV","商家GMV"]
for c in num_cols:
    f[c] = pd.to_numeric(f[c], errors="coerce").fillna(0)
agg = f.groupby("内容ID")[num_cols].sum()
print("聚合后笔记数:", len(agg))
print("总进店UV:", int(agg["进店UV"].sum()), "| 总成交UV:", int(agg["成交UV"].sum()), "| 总GMV:", round(agg["商家GMV"].sum(),1))
print("日期列样例:", star["日期"].dropna().astype(str).head(3).tolist(), "范围:", star["日期"].min(), "~", star["日期"].max())

print("=" * 60)
print("【3】薯条")
chili = pd.read_excel(CHILI, dtype={"笔记ID": str})
print("shape:", chili.shape)
print("订单状态取值:", chili["订单状态"].unique().tolist())
spend_col = [c for c in chili.columns if "实际消耗" in c][0]
print("消耗列名:", repr(spend_col))
chili[spend_col] = pd.to_numeric(chili[spend_col], errors="coerce").fillna(0)
invested = chili[chili[spend_col] > 0].copy()
print("消耗>0 行数:", len(invested), "| 唯一笔记:", invested["笔记ID"].nunique())
print("总消耗:", round(invested[spend_col].sum(), 1))
cagg = invested.groupby("笔记ID")[spend_col].sum()
print("笔记级消耗 top3:", cagg.sort_values(ascending=False).head(3).round(1).to_dict())

print("=" * 60)
print("【4】三表ID连通（同口径笔记id字符串）")
pgy_ids = set(pgy["笔记id"].dropna().astype(str))
star_ids = set(agg.index.astype(str))
chili_ids = set(cagg.index.astype(str))
print("蒲公英∩星河:", len(pgy_ids & star_ids), "/ 星河", len(star_ids))
print("蒲公英∩薯条:", len(pgy_ids & chili_ids), "/ 薯条", len(chili_ids))
print("星河∩薯条:", len(star_ids & chili_ids))
