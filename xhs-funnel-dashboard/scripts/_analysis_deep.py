# -*- coding: utf-8 -*-
"""深度诊断：成本结构、漏斗断点、达人分层、时间趋势、投放效率"""
import sys, os
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loaders import load_pugongying, load_star, load_chili, load_lingxi

D = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件"
pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 50)

pgy = pd.concat([
    load_pugongying(os.path.join(D, "0724蒲公英123456月份数据_勿删.xlsx")),
    load_pugongying(os.path.join(D, "0722蒲公英7月份笔记.xlsx")),
])
pgy = pgy[~pgy.index.duplicated(keep="last")]
star, star_daily, _ = load_star([
    os.path.join(D, "0716旧版星河1234月份_勿删.xlsx"),
    os.path.join(D, "0727星河4567月份.csv"),
])
chili, chili_daily, _ = load_chili([
    os.path.join(D, "0706薯条明细23456月份_勿删.xlsx"),
    os.path.join(D, "0727薯条订单明细7月份.xlsx"),
])
lx = load_lingxi(os.path.join(D, "0724灵犀种草贡献笔记TOP榜单.xlsx"))

# ============ 合并主表 ============
m = pd.DataFrame(index=sorted(set(pgy.index) | set(star.index) | set(chili.index)))
m["creator"] = pgy["creator"].reindex(m.index)
m["creator"] = m["creator"].fillna(star["creator"].reindex(m.index))
m["creator"] = m["creator"].fillna(chili["creator"].reindex(m.index))
m["pub_date"] = pgy["pub_date"].reindex(m.index)
m["note_type"] = pgy["note_type"].reindex(m.index)
m["content_tag"] = pgy["content_tag"].reindex(m.index)
m["fans"] = pgy["fans"].reindex(m.index)
m["fee"] = pgy["total_amount"].reindex(m.index)          # 达人合作费
m["quote"] = pgy["quote_price"].reindex(m.index)
m["pgy_read"] = pgy["read_uv"].reindex(m.index)
m["view_time"] = pgy["avg_view_time"].reindex(m.index)
m["cta_click"] = (pgy["body_cta_click"].fillna(0) + pgy["comment_cta_click"].fillna(0) + pgy["footer_cta_click"].fillna(0)).reindex(m.index)
m["read_uv"] = star["read_uv"].reindex(m.index)
m["visit_uv"] = star["visit_uv"].reindex(m.index)
m["cart_uv"] = star["cart_uv"].reindex(m.index)
m["deal_uv"] = star["deal_uv"].reindex(m.index)
m["gmv"] = star["gmv"].reindex(m.index)
m["spend"] = chili["spend"].reindex(m.index)
m["chili_days"] = chili["chili_days"].reindex(m.index)
m["ti_users"] = lx["ti_users"].reindex(m.index)
m["lx_visit"] = lx["visit_users"].reindex(m.index)
m["month"] = m["pub_date"].dt.to_period("M").astype(str)
m.loc[m["month"] == "NaT", "month"] = None

W = []
def p(s=""):
    W.append(str(s))

p("=" * 78)
p("一、真实成本结构（关键：ROI 口径被低估了成本）")
p("=" * 78)
fee_total = m["fee"].sum()
spend_total = m["spend"].sum()
gmv_total = m["gmv"].sum()
p(f"达人合作费(蒲公英total_amount): {fee_total:>14,.0f}  占比 {fee_total/(fee_total+spend_total)*100:.1f}%")
p(f"薯条投放费(实付推广完成):       {spend_total:>14,.0f}  占比 {spend_total/(fee_total+spend_total)*100:.1f}%")
p(f"总投入:                         {(fee_total+spend_total):>14,.0f}")
p(f"总GMV:                          {gmv_total:>14,.0f}")
p(f"")
p(f"看板口径ROI(只算薯条):  {gmv_total/spend_total:>8.2f}")
p(f"全成本ROI(含达人费):    {gmv_total/(fee_total+spend_total):>8.2f}   <<< 真实经营口径")
p()

# 同样本口径
both = m[(m["spend"] > 0) & (m["gmv"].notna())]
bf = both["fee"].sum(); bs = both["spend"].sum(); bg = both["gmv"].sum()
p(f"[同样本 n={len(both)}] 合作费 {bf:,.0f} + 薯条 {bs:,.0f} = {bf+bs:,.0f} → GMV {bg:,.0f}")
p(f"[同样本] 薯条口径ROI {bg/bs:.2f} / 全成本ROI {bg/(bf+bs):.2f}")
p()

p("=" * 78)
p("二、漏斗断点定位")
p("=" * 78)
r, v, c, d = m["read_uv"].sum(), m["visit_uv"].sum(), m["cart_uv"].sum(), m["deal_uv"].sum()
p(f"阅读UV {r:>12,.0f}")
p(f"进店UV {v:>12,.0f}   转化 {v/r*100:>6.2f}%   流失 {(1-v/r)*100:>5.2f}%")
p(f"加购UV {c:>12,.0f}   转化 {c/v*100:>6.2f}%   流失 {(1-c/v)*100:>5.2f}%")
p(f"成交UV {d:>12,.0f}   转化 {d/c*100:>6.2f}%   流失 {(1-d/c)*100:>5.2f}%")
p(f"全链路 阅读→成交 {d/r*100:.4f}%  （每万次阅读成交 {d/r*10000:.1f} 人）")
p()
p(f"客单价(GMV/成交UV): {gmv_total/d:,.0f} 元")
p(f"进店UV价值:         {gmv_total/v:,.2f} 元")
p(f"阅读UV价值:         {gmv_total/r:,.4f} 元")
p()

p("=" * 78)
p("三、GMV 集中度（是否被少数笔记撑起）")
p("=" * 78)
g = m[m["gmv"] > 0]["gmv"].sort_values(ascending=False)
p(f"有GMV的笔记数: {len(g)} / 全部 {len(m)} （{len(g)/len(m)*100:.1f}%）")
p(f"零GMV笔记数:   {len(m) - len(g)}")
for k in [1, 3, 5, 10, 20, 50]:
    if k <= len(g):
        p(f"TOP{k:<3d} 贡献 {g.head(k).sum()/g.sum()*100:>6.2f}% GMV  （{g.head(k).sum():>12,.0f}）")
p()
p("TOP15 笔记：")
top = m.loc[g.head(15).index, ["creator", "month", "note_type", "gmv", "spend", "fee", "read_uv", "visit_uv", "deal_uv"]].copy()
top["ROI_薯条"] = (top["gmv"] / top["spend"]).round(1)
top["ROI_全成本"] = (top["gmv"] / (top["spend"].fillna(0) + top["fee"].fillna(0))).round(1)
p(top.to_string())
p()

p("=" * 78)
p("四、月度趋势")
p("=" * 78)
mo = m[m["month"].notna()].groupby("month").agg(
    笔记数=("gmv", "size"),
    合作费=("fee", "sum"),
    薯条=("spend", "sum"),
    阅读UV=("read_uv", "sum"),
    进店UV=("visit_uv", "sum"),
    加购UV=("cart_uv", "sum"),
    成交UV=("deal_uv", "sum"),
    GMV=("gmv", "sum"),
)
mo["总投入"] = mo["合作费"] + mo["薯条"]
mo["ROI薯条"] = (mo["GMV"] / mo["薯条"]).round(2)
mo["ROI全成本"] = (mo["GMV"] / mo["总投入"]).round(2)
mo["进店率%"] = (mo["进店UV"] / mo["阅读UV"] * 100).round(2)
mo["成交率%"] = (mo["成交UV"] / mo["进店UV"] * 100).round(2)
mo["进店成本"] = (mo["总投入"] / mo["进店UV"]).round(2)
mo["成交成本"] = (mo["总投入"] / mo["成交UV"]).round(0)
mo["篇均投入"] = (mo["总投入"] / mo["笔记数"]).round(0)
p(mo.to_string())
p()

p("=" * 78)
p("五、达人分层（按GMV贡献）")
p("=" * 78)
cr = m[m["creator"].notna()].groupby("creator").agg(
    篇数=("gmv", "size"),
    合作费=("fee", "sum"),
    薯条=("spend", "sum"),
    阅读UV=("read_uv", "sum"),
    进店UV=("visit_uv", "sum"),
    成交UV=("deal_uv", "sum"),
    GMV=("gmv", "sum"),
    粉丝=("fans", "max"),
)
cr["总投入"] = cr["合作费"] + cr["薯条"]
cr["ROI"] = (cr["GMV"] / cr["总投入"]).round(2)
cr["进店率%"] = (cr["进店UV"] / cr["阅读UV"] * 100).round(2)
cr["进店成本"] = (cr["总投入"] / cr["进店UV"]).round(1)
cr = cr.sort_values("GMV", ascending=False)
p(f"合作达人总数: {len(cr)}")
p(f"有GMV产出的达人: {(cr['GMV']>0).sum()}  零产出: {(cr['GMV']<=0).sum()}")
p()
p("--- GMV TOP20 达人 ---")
p(cr.head(20)[["篇数", "粉丝", "总投入", "阅读UV", "进店UV", "成交UV", "GMV", "ROI", "进店率%", "进店成本"]].to_string())
p()
p("--- 投入最多但ROI最低的15个达人（投入>10000）---")
low = cr[cr["总投入"] > 10000].sort_values("ROI").head(15)
p(low[["篇数", "粉丝", "总投入", "阅读UV", "进店UV", "成交UV", "GMV", "ROI", "进店率%", "进店成本"]].to_string())
p()

p("=" * 78)
p("六、投放效率：薯条花费 vs 产出（边际效应）")
p("=" * 78)
sp = m[(m["spend"] > 0) & (m["read_uv"].notna())].copy()
sp["bucket"] = pd.cut(sp["spend"], [0, 300, 1000, 3000, 6000, 10000, 1e9],
                      labels=["≤300", "300-1k", "1k-3k", "3k-6k", "6k-1w", ">1w"])
bk = sp.groupby("bucket", observed=True).agg(
    笔记数=("spend", "size"),
    总薯条=("spend", "sum"),
    总合作费=("fee", "sum"),
    阅读UV=("read_uv", "sum"),
    进店UV=("visit_uv", "sum"),
    成交UV=("deal_uv", "sum"),
    GMV=("gmv", "sum"),
)
bk["总投入"] = bk["总薯条"] + bk["总合作费"]
bk["ROI薯条"] = (bk["GMV"] / bk["总薯条"]).round(2)
bk["ROI全成本"] = (bk["GMV"] / bk["总投入"]).round(2)
bk["进店率%"] = (bk["进店UV"] / bk["阅读UV"] * 100).round(2)
bk["进店成本"] = (bk["总投入"] / bk["进店UV"]).round(1)
bk["篇均GMV"] = (bk["GMV"] / bk["笔记数"]).round(0)
bk["零GMV篇数"] = sp[sp["gmv"].fillna(0) <= 0].groupby("bucket", observed=True).size()
p(bk.to_string())
p()

p("=" * 78)
p("七、内容类型与标签效果")
p("=" * 78)
if m["note_type"].notna().any():
    nt = m[m["note_type"].notna()].groupby("note_type").agg(
        篇数=("gmv", "size"), 合作费=("fee", "sum"), 薯条=("spend", "sum"),
        阅读UV=("read_uv", "sum"), 进店UV=("visit_uv", "sum"),
        成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"), 浏览时长=("view_time", "mean"))
    nt["总投入"] = nt["合作费"] + nt["薯条"]
    nt["ROI"] = (nt["GMV"] / nt["总投入"]).round(2)
    nt["进店率%"] = (nt["进店UV"] / nt["阅读UV"] * 100).round(2)
    nt["进店成本"] = (nt["总投入"] / nt["进店UV"]).round(1)
    p(nt.to_string())
p()
if m["content_tag"].notna().any():
    p("--- 内容标签 TOP15（按篇数）---")
    ct = m[m["content_tag"].notna()].groupby("content_tag").agg(
        篇数=("gmv", "size"), 总投入=("fee", "sum"), 薯条=("spend", "sum"),
        阅读UV=("read_uv", "sum"), 进店UV=("visit_uv", "sum"), GMV=("gmv", "sum"))
    ct["投入"] = ct["总投入"] + ct["薯条"]
    ct["ROI"] = (ct["GMV"] / ct["投入"]).round(2)
    ct["进店率%"] = (ct["进店UV"] / ct["阅读UV"] * 100).round(2)
    p(ct.sort_values("篇数", ascending=False).head(15)[["篇数", "投入", "阅读UV", "进店UV", "GMV", "ROI", "进店率%"]].to_string())
p()

p("=" * 78)
p("八、粉丝量级效果")
p("=" * 78)
fs = m[m["fans"].notna() & (m["fans"] > 0)].copy()
fs["级别"] = pd.cut(fs["fans"], [0, 5000, 1e4, 5e4, 1e5, 5e5, 1e9],
                   labels=["<5k", "5k-1w", "1w-5w", "5w-10w", "10w-50w", ">50w"])
fb = fs.groupby("级别", observed=True).agg(
    篇数=("gmv", "size"), 合作费=("fee", "mean"), 薯条=("spend", "sum"),
    阅读UV=("read_uv", "sum"), 进店UV=("visit_uv", "sum"),
    成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"))
fb["总投入"] = fs.groupby("级别", observed=True)["fee"].sum() + fb["薯条"]
fb["ROI"] = (fb["GMV"] / fb["总投入"]).round(2)
fb["进店率%"] = (fb["进店UV"] / fb["阅读UV"] * 100).round(2)
fb["进店成本"] = (fb["总投入"] / fb["进店UV"]).round(1)
fb["篇均合作费"] = fb["合作费"].round(0)
p(fb[["篇数", "篇均合作费", "总投入", "阅读UV", "进店UV", "成交UV", "GMV", "ROI", "进店率%", "进店成本"]].to_string())
p()

p("=" * 78)
p("九、零效果笔记盘点（钱花了没结果）")
p("=" * 78)
dead = m[(m["fee"].fillna(0) + m["spend"].fillna(0) > 0) & (m["gmv"].fillna(0) <= 0)]
p(f"有投入但零GMV的笔记: {len(dead)} 篇")
p(f"沉没投入: {(dead['fee'].fillna(0)+dead['spend'].fillna(0)).sum():,.0f} 元 "
  f"（占总投入 {(dead['fee'].fillna(0)+dead['spend'].fillna(0)).sum()/(fee_total+spend_total)*100:.1f}%）")
p(f"这批笔记的阅读UV: {dead['read_uv'].sum():,.0f}  进店UV: {dead['visit_uv'].sum():,.0f}")
p()
no_visit = m[(m["fee"].fillna(0) + m["spend"].fillna(0) > 0) & (m["visit_uv"].fillna(0) <= 0)]
p(f"有投入但零进店的笔记: {len(no_visit)} 篇  沉没 {(no_visit['fee'].fillna(0)+no_visit['spend'].fillna(0)).sum():,.0f} 元")
p()
p("--- 投入最高的15篇零GMV笔记 ---")
dd = dead.copy()
dd["投入"] = dd["fee"].fillna(0) + dd["spend"].fillna(0)
p(dd.nlargest(15, "投入")[["creator", "month", "note_type", "投入", "fee", "spend", "read_uv", "visit_uv", "cart_uv"]].to_string())
p()

p("=" * 78)
p("十、加购未成交 —— 临门一脚流失")
p("=" * 78)
has_cart = m[m["cart_uv"].fillna(0) > 0]
p(f"有加购的笔记: {len(has_cart)} 篇")
p(f"总加购UV {has_cart['cart_uv'].sum():,.0f} → 成交UV {has_cart['deal_uv'].sum():,.0f}")
p(f"加购未成交人数: {has_cart['cart_uv'].sum()-has_cart['deal_uv'].sum():,.0f} 人")
p(f"按客单价{gmv_total/d:,.0f}元估算，流失GMV约 {(has_cart['cart_uv'].sum()-has_cart['deal_uv'].sum())*gmv_total/d:,.0f} 元")
p()
cart_no_deal = m[(m["cart_uv"].fillna(0) > 0) & (m["deal_uv"].fillna(0) == 0)]
p(f"有加购但零成交的笔记: {len(cart_no_deal)} 篇，加购UV合计 {cart_no_deal['cart_uv'].sum():,.0f}")
p()

p("=" * 78)
p("十一、灵犀人群资产")
p("=" * 78)
lxm = m[m["ti_users"].notna()]
p(f"灵犀命中笔记: {len(lxm)}")
p(f"TI人群总数: {lxm['ti_users'].sum():,.0f}")
p(f"灵犀进店用户: {lxm['lx_visit'].sum():,.0f}")
if lxm["ti_users"].sum() > 0:
    p(f"TI→进店兑换: {lxm['lx_visit'].sum()/lxm['ti_users'].sum()*100:.2f}%")
p()

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_deep.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(W))
print("OK")
