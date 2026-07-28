# -*- coding: utf-8 -*-
"""收尾验证：GMV回收周期、关键驱动因子相关性、可执行机会量化"""
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
lx = load_lingxi(os.path.join(D, "0724灵犀种草贡献笔记TOP榜单.xlsx"))

m = pd.DataFrame(index=sorted(set(pgy.index) | set(star.index) | set(chili.index)))
m["creator"] = pgy["creator"].reindex(m.index).fillna(star["creator"].reindex(m.index)).fillna(chili["creator"].reindex(m.index))
m["pub_date"] = pgy["pub_date"].reindex(m.index)
m["note_type"] = pgy["note_type"].reindex(m.index)
m["fans"] = pgy["fans"].reindex(m.index)
m["fee"] = pgy["total_amount"].reindex(m.index)
m["pgy_read"] = pgy["read_uv"].reindex(m.index)
m["view_time"] = pgy["avg_view_time"].reindex(m.index)
m["interact_rate"] = pgy["interact_rate"].reindex(m.index)
m["finish_rate"] = pgy["finish_rate"].reindex(m.index)
m["body_ctr"] = pgy["body_cta_ctr"].reindex(m.index)
m["cta_click"] = (pgy["body_cta_click"].fillna(0) + pgy["comment_cta_click"].fillna(0) + pgy["footer_cta_click"].fillna(0)).reindex(m.index)
for c in ["read_uv", "visit_uv", "cart_uv", "deal_uv", "gmv", "search_visit_uv", "new_visit_uv"]:
    m[c] = star[c].reindex(m.index)
m["spend"] = chili["spend"].reindex(m.index)
m["chili_days"] = chili["chili_days"].reindex(m.index)
m["ti_users"] = lx["ti_users"].reindex(m.index)
m["month"] = m["pub_date"].dt.to_period("M").astype(str)
m.loc[m["month"] == "NaT", "month"] = None
m["invest"] = m["fee"].fillna(0) + m["spend"].fillna(0)

W = []
def p(s=""): W.append(str(s))

p("=" * 88)
p("I. GMV 回收周期：钱投出去多久能见到结果")
p("=" * 88)
sd = star_daily.copy()
sd["date_dt"] = pd.to_datetime(sd["date"].astype(str), format="%Y%m%d")
pub = m["pub_date"].dropna()
sd = sd[sd["note_id"].isin(pub.index)].copy()
sd["pub_date"] = sd["note_id"].map(pub)
sd["age"] = (sd["date_dt"] - sd["pub_date"]).dt.days
sd = sd[sd["age"] >= 0]

# 只用发布满90天的笔记，看GMV随时间累积曲线
cutoff = pd.to_datetime(str(int(star_daily["date"].max())), format="%Y%m%d")
mature = m[(cutoff - m["pub_date"]).dt.days >= 90].index
sdm = sd[sd["note_id"].isin(mature)]
total_gmv = sdm["gmv"].sum()
total_visit = sdm["visit_uv"].sum()
p(f"样本：发布满90天的笔记 {len(mature)} 篇，累计GMV {total_gmv:,.0f}，进店UV {total_visit:,.0f}")
p()
rows = []
for d in [3, 7, 14, 21, 30, 45, 60, 90]:
    w = sdm[sdm["age"] <= d]
    rows.append({
        "天数": f"{d}天内",
        "累计GMV": w["gmv"].sum(),
        "GMV占比%": w["gmv"].sum() / total_gmv * 100,
        "累计进店UV": w["visit_uv"].sum(),
        "进店占比%": w["visit_uv"].sum() / total_visit * 100,
    })
p(pd.DataFrame(rows).round(2).to_string(index=False))
p()
p("※ 该曲线决定「多久能判断一篇笔记成败」和「现金回收节奏」")
p()

p("=" * 88)
p("J. 关键驱动因子：什么最能预测进店/GMV")
p("=" * 88)
cor = m[(m["visit_uv"].fillna(0) > 0) & (m["pgy_read"].fillna(0) > 0)].copy()
cor["进店率"] = cor["visit_uv"] / cor["read_uv"]
cor["组件点击率"] = cor["cta_click"] / cor["pgy_read"]
factors = ["pgy_read", "cta_click", "组件点击率", "view_time", "interact_rate",
           "finish_rate", "fans", "fee", "spend", "chili_days", "ti_users"]
p(f"样本 n={len(cor)}")
p()
p("--- 与「进店UV」的 Spearman 秩相关（规模因子）---")
r1 = cor[factors + ["visit_uv"]].corr(method="spearman")["visit_uv"].drop("visit_uv").sort_values(ascending=False)
p(r1.round(3).to_string())
p()
p("--- 与「进店率」的 Spearman 秩相关（效率因子）---")
r2 = cor[factors + ["进店率"]].corr(method="spearman")["进店率"].drop("进店率").sort_values(ascending=False)
p(r2.round(3).to_string())
p()
p("--- 与「GMV」的 Spearman 秩相关 ---")
r3 = cor[factors + ["gmv"]].corr(method="spearman")["gmv"].drop("gmv").sort_values(ascending=False)
p(r3.round(3).to_string())
p()

p("=" * 88)
p("K. 组件点击率分层效果（可控杠杆验证）")
p("=" * 88)
cc = m[(m["pgy_read"].fillna(0) > 1000) & (m["visit_uv"].notna())].copy()
cc["组件点击率%"] = cc["cta_click"] / cc["pgy_read"] * 100
qs = cc["组件点击率%"].quantile([0.2, 0.4, 0.6, 0.8]).tolist()
cc["档"] = pd.cut(cc["组件点击率%"], [-1] + qs + [1e9],
                 labels=["最低20%", "20-40%", "40-60%", "60-80%", "最高20%"])
kk = cc.groupby("档", observed=True).agg(
    笔记数=("invest", "size"), 组件点击率=("组件点击率%", "mean"),
    投入=("invest", "sum"), 蒲公英阅读=("pgy_read", "sum"),
    进店UV=("visit_uv", "sum"), 成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"),
    浏览时长=("view_time", "mean"), 互动率=("interact_rate", "mean"))
kk["ROI"] = (kk["GMV"] / kk["投入"]).round(2)
kk["进店成本"] = (kk["投入"] / kk["进店UV"]).round(1)
kk["篇均GMV"] = (kk["GMV"] / kk["笔记数"]).round(0)
kk["组件点击率"] = kk["组件点击率"].round(2)
kk["浏览时长"] = kk["浏览时长"].round(1)
kk["互动率%"] = (kk["互动率"] * 100).round(2)
p(kk[["笔记数", "组件点击率", "浏览时长", "互动率%", "投入", "进店UV", "成交UV", "GMV", "ROI", "进店成本", "篇均GMV"]].to_string())
p()

p("=" * 88)
p("L. 搜索进店占比 —— Search 场域的真实贡献")
p("=" * 88)
sv = m[m["search_visit_uv"].notna() & (m["visit_uv"].fillna(0) > 0)]
p(f"总进店UV {sv['visit_uv'].sum():,.0f}  其中搜索进店 {sv['search_visit_uv'].sum():,.0f}  占比 {sv['search_visit_uv'].sum()/sv['visit_uv'].sum()*100:.2f}%")
p(f"新客进店UV {sv['new_visit_uv'].sum():,.0f}  占进店 {sv['new_visit_uv'].sum()/sv['visit_uv'].sum()*100:.2f}%")
p()
smo = sv[sv["month"].notna()].groupby("month").agg(
    进店UV=("visit_uv", "sum"), 搜索进店=("search_visit_uv", "sum"), 新客进店=("new_visit_uv", "sum"))
smo["搜索占比%"] = (smo["搜索进店"] / smo["进店UV"] * 100).round(2)
smo["新客占比%"] = (smo["新客进店"] / smo["进店UV"] * 100).round(2)
p(smo.to_string())
p()

p("=" * 88)
p("M. 机会量化：三个可执行动作的潜在收益")
p("=" * 88)
gmv_total = m["gmv"].sum()
deal_total = m["deal_uv"].sum()
aov = gmv_total / deal_total
invest_total = m["invest"].sum()
p(f"[基准] 总投入 {invest_total:,.0f}  总GMV {gmv_total:,.0f}  全成本ROI {gmv_total/invest_total:.2f}  客单价 {aov:,.0f}")
p()

# 机会1：砍掉低效达人，钱挪到高效达人
eff = m[(m["visit_uv"].fillna(0) > 0) & (m["invest"] > 0)].copy()
eff["进店成本"] = eff["invest"] / eff["visit_uv"]
p75 = eff["进店成本"].quantile(0.75)
med = eff["进店成本"].median()
bad = eff[eff["进店成本"] >= p75]
p(f"【机会1】低效笔记(进店成本≥P75={p75:.1f}元)：{len(bad)}篇，投入 {bad['invest'].sum():,.0f}元，产出GMV {bad['gmv'].sum():,.0f}")
saved = bad["invest"].sum()
new_visit = saved / med
p(f"  若把这笔钱按中位进店成本({med:.1f}元)重新配置 → 可多得进店UV {new_visit-bad['visit_uv'].sum():,.0f}")
uv_value = gmv_total / m["visit_uv"].sum()
p(f"  按进店UV价值 {uv_value:.1f}元/UV 估算，增量GMV 约 {(new_visit-bad['visit_uv'].sum())*uv_value:,.0f} 元")
p()

# 机会2：加购未成交唤回
cart_gap = m["cart_uv"].sum() - m["deal_uv"].sum()
p(f"【机会2】加购未成交 {cart_gap:,.0f} 人（加购{m['cart_uv'].sum():,.0f} - 成交{m['deal_uv'].sum():,.0f}）")
for rate in [0.02, 0.05, 0.10]:
    p(f"  唤回 {rate*100:.0f}% → 增量成交 {cart_gap*rate:,.0f} 人，增量GMV {cart_gap*rate*aov:,.0f} 元")
p()

# 机会3：零效果笔记止损
dead = m[(m["invest"] > 0) & (m["gmv"].fillna(0) <= 0)]
p(f"【机会3】零GMV笔记 {len(dead)}篇，沉没 {dead['invest'].sum():,.0f}元")
no_visit_dead = dead[dead["visit_uv"].fillna(0) <= 0]
p(f"  其中连进店都为0的 {len(no_visit_dead)}篇，沉没 {no_visit_dead['invest'].sum():,.0f}元 ← 完全无效")
p()

# 机会4：进店率提升
cur_visit_rate = m["visit_uv"].sum() / m["read_uv"].sum()
p(f"【机会4】当前整体进店率 {cur_visit_rate*100:.2f}%")
for target in [0.02, 0.025, 0.03]:
    extra_visit = m["read_uv"].sum() * (target - cur_visit_rate)
    p(f"  提到 {target*100:.1f}% → 增量进店UV {extra_visit:,.0f}，增量GMV约 {extra_visit*uv_value:,.0f} 元（投入不变）")
p()

p("=" * 88)
p("N. 达人复用名单：高效且已验证（进店成本低 + 有GMV + 至少1篇）")
p("=" * 88)
cr = m[m["creator"].notna() & (m["invest"] > 0)].groupby("creator").agg(
    篇数=("invest", "size"), 投入=("invest", "sum"), 粉丝=("fans", "median"),
    蒲公英阅读=("pgy_read", "sum"), 组件点击=("cta_click", "sum"),
    进店UV=("visit_uv", "sum"), 成交UV=("deal_uv", "sum"), GMV=("gmv", "sum"))
cr = cr[cr["进店UV"] > 0]
cr["ROI"] = (cr["GMV"] / cr["投入"]).round(2)
cr["进店成本"] = (cr["投入"] / cr["进店UV"]).round(2)
cr["组件点击率%"] = (cr["组件点击"] / cr["蒲公英阅读"] * 100).round(2)
good = cr[(cr["进店成本"] <= 6) & (cr["GMV"] > 20000)].sort_values("ROI", ascending=False)
p(f"符合「进店成本≤6元 且 GMV>2万」的达人：{len(good)} 位")
p(good.head(30)[["篇数", "粉丝", "投入", "进店UV", "成交UV", "GMV", "ROI", "进店成本", "组件点击率%"]].to_string())
p()
p("--- 应停止合作：投入>8000 且 ROI<2 ---")
stop = cr[(cr["投入"] > 8000) & (cr["ROI"] < 2)].sort_values("投入", ascending=False)
p(f"共 {len(stop)} 位，合计投入 {stop['投入'].sum():,.0f} 元，产出 {stop['GMV'].sum():,.0f} 元")
p(stop.head(25)[["篇数", "粉丝", "投入", "进店UV", "成交UV", "GMV", "ROI", "进店成本", "组件点击率%"]].to_string())
p()

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_final.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(W))
print("OK")
