# -*- coding: utf-8 -*-
"""专项：6-7月效率下滑归因 + 归因窗口校正 + 高效达人画像"""
import sys, os
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loaders import load_pugongying, load_star, load_chili, load_lingxi

D = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件"
pd.set_option("display.width", 220)
pd.set_option("display.max_columns", 60)

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

m = pd.DataFrame(index=sorted(set(pgy.index) | set(star.index) | set(chili.index)))
for col, src in [("creator", pgy), ("pub_date", pgy), ("note_type", pgy), ("fans", pgy)]:
    m[col] = src[col].reindex(m.index) if col in src else None
m["creator"] = m["creator"].fillna(star["creator"].reindex(m.index)).fillna(chili["creator"].reindex(m.index))
m["fee"] = pgy["total_amount"].reindex(m.index)
m["pgy_read"] = pgy["read_uv"].reindex(m.index)
m["view_time"] = pgy["avg_view_time"].reindex(m.index)
m["interact_rate"] = pgy["interact_rate"].reindex(m.index)
m["cta_click"] = (pgy["body_cta_click"].fillna(0) + pgy["comment_cta_click"].fillna(0) + pgy["footer_cta_click"].fillna(0)).reindex(m.index)
for c in ["read_uv", "visit_uv", "cart_uv", "deal_uv", "gmv"]:
    m[c] = star[c].reindex(m.index)
m["spend"] = chili["spend"].reindex(m.index)
m["chili_days"] = chili["chili_days"].reindex(m.index)
m["month"] = m["pub_date"].dt.to_period("M").astype(str)
m.loc[m["month"] == "NaT", "month"] = None
m["invest"] = m["fee"].fillna(0) + m["spend"].fillna(0)

W = []
def p(s=""): W.append(str(s))

p("=" * 88)
p("A. 归因窗口校正：星河数据实际跑到哪天？7月数据是否已成熟")
p("=" * 88)
p(f"星河 daily 日期范围: {int(star_daily['date'].min())} — {int(star_daily['date'].max())}")
p(f"蒲公英 发布日期范围: {m['pub_date'].min()} — {m['pub_date'].max()}")
p()
# 笔记发布到数据截止的天数
cutoff = pd.to_datetime(str(int(star_daily["date"].max())), format="%Y%m%d")
m["days_since_pub"] = (cutoff - m["pub_date"]).dt.days
mat = m[m["month"].notna()].groupby("month")["days_since_pub"].agg(["min", "median", "max"]).round(0)
mat.columns = ["最短成熟天数", "中位成熟天数", "最长成熟天数"]
mat["笔记数"] = m[m["month"].notna()].groupby("month").size()
mat["归因是否跑满30天"] = np.where(mat["中位成熟天数"] >= 30, "是", "否 ← 数据未成熟")
p(mat.to_string())
p()
p("※ 7月（部分6月）笔记未跑满30天归因窗口，GMV 会继续回流，绝对值不可与3-5月直接比。")
p()

p("=" * 88)
p("B. 同口径对比：只看每篇笔记发布后 15 天内的表现（消除归因窗口差异）")
p("=" * 88)
sd = star_daily.copy()
sd["date_dt"] = pd.to_datetime(sd["date"].astype(str), format="%Y%m%d")
pub = m["pub_date"].dropna()
sd = sd[sd["note_id"].isin(pub.index)]
sd["pub_date"] = sd["note_id"].map(pub)
sd["age"] = (sd["date_dt"] - sd["pub_date"]).dt.days
w15 = sd[(sd["age"] >= 0) & (sd["age"] <= 15)]
agg15 = w15.groupby("note_id").agg(
    read15=("read_uv", "sum"), visit15=("visit_uv", "sum"),
    cart15=("cart_uv", "sum"), deal15=("deal_uv", "sum"), gmv15=("gmv", "sum"))
m2 = m.join(agg15)
# 仅保留发布后已满15天的笔记
ok15 = m2[m2["days_since_pub"] >= 15]
mo15 = ok15[ok15["month"].notna()].groupby("month").agg(
    笔记数=("gmv15", "size"), 投入=("invest", "sum"),
    阅读UV=("read15", "sum"), 进店UV=("visit15", "sum"),
    加购UV=("cart15", "sum"), 成交UV=("deal15", "sum"), GMV=("gmv15", "sum"))
mo15["ROI全成本"] = (mo15["GMV"] / mo15["投入"]).round(2)
mo15["进店率%"] = (mo15["进店UV"] / mo15["阅读UV"] * 100).round(2)
mo15["加购率%"] = (mo15["加购UV"] / mo15["进店UV"] * 100).round(2)
mo15["成交率%"] = (mo15["成交UV"] / mo15["进店UV"] * 100).round(2)
mo15["进店成本"] = (mo15["投入"] / mo15["进店UV"]).round(1)
mo15["成交成本"] = (mo15["投入"] / mo15["成交UV"]).round(0)
mo15["篇均GMV"] = (mo15["GMV"] / mo15["笔记数"]).round(0)
p("【发布后15天窗口 · 同口径】")
p(mo15.to_string())
p()

p("=" * 88)
p("C. 下滑归因：投入结构 vs 内容质量 vs 达人结构，到底哪个变了")
p("=" * 88)
q = m[m["month"].notna()].groupby("month").agg(
    笔记数=("invest", "size"),
    篇均合作费=("fee", "mean"),
    篇均薯条=("spend", "mean"),
    篇均投入=("invest", "mean"),
    投薯条篇数=("spend", lambda s: (s.fillna(0) > 0).sum()),
    篇均蒲公英阅读=("pgy_read", "mean"),
    篇均浏览时长=("view_time", "mean"),
    篇均互动率=("interact_rate", "mean"),
    篇均组件点击=("cta_click", "mean"),
    篇均粉丝=("fans", "median"),
    视频占比=("note_type", lambda s: (s == "视频").sum() / max(len(s), 1)),
).round(2)
q["薯条覆盖率%"] = (q["投薯条篇数"] / q["笔记数"] * 100).round(1)
q["视频占比%"] = (q["视频占比"] * 100).round(1)
q = q.drop(columns=["视频占比", "投薯条篇数"])
p(q.to_string())
p()

p("--- 前端内容力：组件点击率（组件点击/蒲公英阅读UV）逐月 ---")
cc = m[m["month"].notna() & (m["pgy_read"].fillna(0) > 0)].groupby("month").apply(
    lambda g: pd.Series({
        "笔记数": len(g),
        "组件点击总量": g["cta_click"].sum(),
        "蒲公英阅读UV": g["pgy_read"].sum(),
        "组件点击率%": g["cta_click"].sum() / g["pgy_read"].sum() * 100,
        "星河进店/组件点击": g["visit_uv"].sum() / max(g["cta_click"].sum(), 1),
    }), include_groups=False).round(3)
p(cc.to_string())
p()

p("=" * 88)
p("D. 达人复投效果：合作次数 vs 效率")
p("=" * 88)
cn = m[m["creator"].notna()].groupby("creator").agg(
    篇数=("invest", "size"), 投入=("invest", "sum"),
    阅读UV=("read_uv", "sum"), 进店UV=("visit_uv", "sum"),
    成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"))
cn["ROI"] = cn["GMV"] / cn["投入"]
cn["进店成本"] = cn["投入"] / cn["进店UV"]
bk = cn.groupby(pd.cut(cn["篇数"], [0, 1, 2, 3, 5, 100], labels=["1篇", "2篇", "3篇", "4-5篇", "6篇+"]), observed=True).agg(
    达人数=("篇数", "size"), 总篇数=("篇数", "sum"), 总投入=("投入", "sum"),
    阅读UV=("阅读UV", "sum"), 进店UV=("进店UV", "sum"),
    成交UV=("成交UV", "sum"), GMV=("GMV", "sum"))
bk["ROI"] = (bk["GMV"] / bk["总投入"]).round(2)
bk["进店率%"] = (bk["进店UV"] / bk["阅读UV"] * 100).round(2)
bk["进店成本"] = (bk["总投入"] / bk["进店UV"]).round(1)
bk["篇均GMV"] = (bk["GMV"] / bk["总篇数"]).round(0)
p(bk.to_string())
p()

p("=" * 88)
p("E. 高效 vs 低效达人画像对比（进店成本口径）")
p("=" * 88)
eff = m[(m["visit_uv"].fillna(0) > 0) & (m["invest"] > 0)].copy()
eff["进店成本"] = eff["invest"] / eff["visit_uv"]
eff["进店率"] = eff["visit_uv"] / eff["read_uv"] * 100
q1, q3 = eff["进店成本"].quantile([0.25, 0.75])
hi = eff[eff["进店成本"] <= q1]
lo = eff[eff["进店成本"] >= q3]
p(f"进店成本 P25={q1:.2f}元  P75={q3:.2f}元")
p()
cmp = pd.DataFrame({
    "高效组(进店成本≤P25)": [
        len(hi), hi["invest"].sum(), hi["fee"].mean(), hi["spend"].fillna(0).mean(),
        hi["fans"].median(), hi["pgy_read"].mean(), hi["view_time"].mean(),
        hi["interact_rate"].mean() * 100, hi["cta_click"].mean(),
        hi["进店率"].mean(), hi["进店成本"].mean(),
        hi["gmv"].sum() / hi["invest"].sum(), (hi["note_type"] == "视频").sum() / len(hi) * 100,
    ],
    "低效组(进店成本≥P75)": [
        len(lo), lo["invest"].sum(), lo["fee"].mean(), lo["spend"].fillna(0).mean(),
        lo["fans"].median(), lo["pgy_read"].mean(), lo["view_time"].mean(),
        lo["interact_rate"].mean() * 100, lo["cta_click"].mean(),
        lo["进店率"].mean(), lo["进店成本"].mean(),
        lo["gmv"].sum() / lo["invest"].sum(), (lo["note_type"] == "视频").sum() / len(lo) * 100,
    ],
}, index=["笔记数", "总投入", "篇均合作费", "篇均薯条", "粉丝中位数", "篇均蒲公英阅读UV",
          "平均浏览时长(s)", "平均互动率%", "篇均组件点击", "平均进店率%", "平均进店成本",
          "ROI(全成本)", "视频占比%"]).round(2)
p(cmp.to_string())
p()

p("=" * 88)
p("F. 组件点击 → 进店 的转化效率（内容力 vs 承接力）")
p("=" * 88)
cta = m[(m["cta_click"].fillna(0) > 0) & (m["visit_uv"].fillna(0) >= 0)].copy()
p(f"总组件点击 {cta['cta_click'].sum():,.0f} → 星河进店UV {cta['visit_uv'].sum():,.0f}")
p(f"组件点击→进店 转化率: {cta['visit_uv'].sum()/cta['cta_click'].sum()*100:.1f}%")
p("※ >100% 说明进店来源不止组件点击（搜索/店铺等其他路径也算归因进店）")
p()

p("=" * 88)
p("G. 薯条投放节奏：投放天数 vs 效率")
p("=" * 88)
cd = m[(m["chili_days"].fillna(0) > 0)].copy()
cd["天数档"] = pd.cut(cd["chili_days"], [0, 3, 7, 15, 30, 200], labels=["1-3天", "4-7天", "8-15天", "16-30天", "30天+"])
dk = cd.groupby("天数档", observed=True).agg(
    笔记数=("invest", "size"), 总投入=("invest", "sum"), 篇均薯条=("spend", "mean"),
    阅读UV=("read_uv", "sum"), 进店UV=("visit_uv", "sum"),
    成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"))
dk["ROI"] = (dk["GMV"] / dk["总投入"]).round(2)
dk["进店率%"] = (dk["进店UV"] / dk["阅读UV"] * 100).round(2)
dk["进店成本"] = (dk["总投入"] / dk["进店UV"]).round(1)
dk["篇均GMV"] = (dk["GMV"] / dk["笔记数"]).round(0)
p(dk.to_string())
p()

p("=" * 88)
p("H. 星河零覆盖笔记 —— 数据盲区")
p("=" * 88)
no_star = m[m["read_uv"].isna() & (m["invest"] > 0)]
p(f"有投入但星河完全无数据的笔记: {len(no_star)} 篇，投入 {no_star['invest'].sum():,.0f} 元")
p(f"其中蒲公英有阅读数据的: {no_star['pgy_read'].notna().sum()} 篇，阅读UV合计 {no_star['pgy_read'].sum():,.0f}")
p("按月分布：")
p(no_star[no_star["month"].notna()].groupby("month").agg(篇数=("invest", "size"), 投入=("invest", "sum"), 蒲公英阅读=("pgy_read", "sum")).to_string())
p()

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_drop.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(W))
print("OK")
