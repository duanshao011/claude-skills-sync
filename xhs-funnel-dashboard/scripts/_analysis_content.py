# -*- coding: utf-8 -*-
"""内容侧专项：选题、形式、组件位置、开头留人、自然流量、Search特征"""
import sys, os, re
from collections import Counter
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loaders import load_pugongying, load_star, load_chili, load_lingxi

D = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件"
pd.set_option("display.width", 240)
pd.set_option("display.max_columns", 60)
pd.set_option("display.max_colwidth", 40)

pgy = pd.concat([
    load_pugongying(os.path.join(D, "0724蒲公英123456月份数据_勿删.xlsx")),
    load_pugongying(os.path.join(D, "0722蒲公英7月份笔记.xlsx")),
])
pgy = pgy[~pgy.index.duplicated(keep="last")]
star, star_daily, _ = load_star([
    os.path.join(D, "0716旧版星河1234月份_勿删.xlsx"),
    os.path.join(D, "0727星河4567月份.csv"),
])
chili, _, _ = load_chili([
    os.path.join(D, "0706薯条明细23456月份_勿删.xlsx"),
    os.path.join(D, "0727薯条订单明细7月份.xlsx"),
])
lx = load_lingxi(os.path.join(D, "0724灵犀种草贡献笔记TOP榜单.xlsx"))

m = pgy.copy()
m["title"] = m["title"].astype(str)
for c in ["read_uv", "visit_uv", "cart_uv", "deal_uv", "gmv", "search_visit_uv", "new_visit_uv"]:
    m["s_" + c] = star[c].reindex(m.index)
m["spend"] = chili["spend"].reindex(m.index)
m["invest"] = m["total_amount"].fillna(0) + m["spend"].fillna(0)
m["cta_total"] = m["body_cta_click"].fillna(0) + m["comment_cta_click"].fillna(0) + m["footer_cta_click"].fillna(0)
m["cta_rate"] = m["cta_total"] / m["read_uv"].replace(0, np.nan)
m["visit_rate"] = m["s_visit_uv"] / m["s_read_uv"].replace(0, np.nan)
m["visit_cost"] = m["invest"] / m["s_visit_uv"].replace(0, np.nan)
m["month"] = m["pub_date"].dt.to_period("M").astype(str)
m["search_share"] = m["s_search_visit_uv"] / m["s_visit_uv"].replace(0, np.nan)
m["nat_share"] = m["natural_read"] / m["read_count"].replace(0, np.nan)

W = []
def p(s=""): W.append(str(s))

VALID = m[(m["s_visit_uv"].fillna(0) > 0) & (m["read_uv"].fillna(0) > 500) & (m["invest"] > 0)].copy()
p("=" * 92)
p(f"分析样本：{len(VALID)} 篇（有星河进店数据 + 蒲公英阅读>500 + 有投入）")
p("=" * 92)
p()

# ---------- 1. 内容形式 ----------
p("=" * 92)
p("1. 内容形式：图文 vs 视频")
p("=" * 92)
nt = VALID.groupby("note_type").agg(
    篇数=("invest", "size"), 投入=("invest", "sum"), 篇均投入=("invest", "mean"),
    蒲公英阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
    进店UV=("s_visit_uv", "sum"), 成交UV=("s_deal_uv", "sum"), GMV=("s_gmv", "sum"),
    浏览时长=("avg_view_time", "mean"), 互动率=("interact_rate", "mean"))
nt["组件点击率%"] = (nt["组件点击"] / nt["蒲公英阅读"] * 100).round(2)
nt["进店率%"] = (nt["进店UV"] / VALID.groupby("note_type")["s_read_uv"].sum() * 100).round(2)
nt["进店成本"] = (nt["投入"] / nt["进店UV"]).round(2)
nt["ROI"] = (nt["GMV"] / nt["投入"]).round(2)
nt["篇均GMV"] = (nt["GMV"] / nt["篇数"]).round(0)
nt["浏览时长"] = nt["浏览时长"].round(1)
nt["互动率%"] = (nt["互动率"] * 100).round(2)
p(nt[["篇数", "篇均投入", "组件点击率%", "进店率%", "进店成本", "ROI", "篇均GMV", "浏览时长", "互动率%"]].to_string())
p()
p("--- 分月看形式占比变化 ---")
mix = m[m["month"].notna()].groupby(["month", "note_type"]).size().unstack(fill_value=0)
mix["视频占比%"] = (mix.get("视频", 0) / mix.sum(axis=1) * 100).round(1)
p(mix.to_string())
p()

# ---------- 2. 组件位置 ----------
p("=" * 92)
p("2. 组件位置：正文 / 评论区 / 底栏，哪个是主力")
p("=" * 92)
tot_body = VALID["body_cta_click"].sum()
tot_cmt = VALID["comment_cta_click"].sum()
tot_ft = VALID["footer_cta_click"].sum()
tot_all = tot_body + tot_cmt + tot_ft
p(f"正文组件点击   {tot_body:>12,.0f}   占比 {tot_body/tot_all*100:>5.1f}%")
p(f"评论区组件点击 {tot_cmt:>12,.0f}   占比 {tot_cmt/tot_all*100:>5.1f}%")
p(f"底栏组件点击   {tot_ft:>12,.0f}   占比 {tot_ft/tot_all*100:>5.1f}%")
p()
p("--- 有无使用各位置组件的效果对比 ---")
rows = []
for name, col in [("正文", "body_cta_click"), ("评论区", "comment_cta_click"), ("底栏", "footer_cta_click")]:
    has = VALID[VALID[col].fillna(0) > 0]
    non = VALID[VALID[col].fillna(0) <= 0]
    for lab, g in [("用了", has), ("没用", non)]:
        if len(g) == 0: continue
        rows.append({
            "位置": name, "情况": lab, "篇数": len(g),
            "篇均投入": g["invest"].mean(),
            "进店率%": g["s_visit_uv"].sum() / g["s_read_uv"].sum() * 100,
            "进店成本": g["invest"].sum() / g["s_visit_uv"].sum(),
            "ROI": g["s_gmv"].sum() / g["invest"].sum(),
            "篇均GMV": g["s_gmv"].mean(),
        })
p(pd.DataFrame(rows).round(2).to_string(index=False))
p()
p("--- 组件位置数量（用了几个位置）与效果 ---")
VALID["cta_pos_n"] = ((VALID["body_cta_click"].fillna(0) > 0).astype(int)
                      + (VALID["comment_cta_click"].fillna(0) > 0).astype(int)
                      + (VALID["footer_cta_click"].fillna(0) > 0).astype(int))
pn = VALID.groupby("cta_pos_n").agg(
    篇数=("invest", "size"), 篇均投入=("invest", "mean"),
    进店UV=("s_visit_uv", "sum"), GMV=("s_gmv", "sum"), 投入=("invest", "sum"),
    组件点击=("cta_total", "sum"), 阅读=("read_uv", "sum"))
pn["组件点击率%"] = (pn["组件点击"] / pn["阅读"] * 100).round(2)
pn["进店率%"] = (pn["进店UV"] / VALID.groupby("cta_pos_n")["s_read_uv"].sum() * 100).round(2)
pn["进店成本"] = (pn["投入"] / pn["进店UV"]).round(2)
pn["ROI"] = (pn["GMV"] / pn["投入"]).round(2)
pn["篇均GMV"] = (pn["GMV"] / pn["篇数"]).round(0)
p(pn[["篇数", "篇均投入", "组件点击率%", "进店率%", "进店成本", "ROI", "篇均GMV"]].to_string())
p()

# ---------- 3. 开头留人 ----------
p("=" * 92)
p("3. 开头留人：5秒播放率 / 3秒阅读率 与转化的关系")
p("=" * 92)
for col, name in [("play_5s", "5秒播放率(视频)"), ("read_3s", "3秒阅读率(图文)")]:
    sub = VALID[VALID[col].notna() & (VALID[col] > 0)].copy()
    if len(sub) < 20: continue
    qs = sub[col].quantile([.25, .5, .75]).tolist()
    sub["档"] = pd.cut(sub[col], [-1] + qs + [9], labels=["低25%", "25-50%", "50-75%", "高25%"])
    g = sub.groupby("档", observed=True).agg(
        篇数=("invest", "size"), 指标均值=(col, "mean"),
        阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
        进店UV=("s_visit_uv", "sum"), 投入=("invest", "sum"), GMV=("s_gmv", "sum"))
    g["指标均值%"] = (g["指标均值"] * 100).round(1)
    g["组件点击率%"] = (g["组件点击"] / g["阅读"] * 100).round(2)
    g["进店率%"] = (g["进店UV"] / sub.groupby("档", observed=True)["s_read_uv"].sum() * 100).round(2)
    g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
    g["ROI"] = (g["GMV"] / g["投入"]).round(2)
    p(f"--- {name}  n={len(sub)} ---")
    p(g[["篇数", "指标均值%", "组件点击率%", "进店率%", "进店成本", "ROI"]].to_string())
    p()

# ---------- 4. 完播率 ----------
p("=" * 92)
p("4. 完播率与转化")
p("=" * 92)
fr = VALID[VALID["finish_rate"].notna() & (VALID["finish_rate"] > 0)].copy()
qs = fr["finish_rate"].quantile([.25, .5, .75]).tolist()
fr["档"] = pd.cut(fr["finish_rate"], [-1] + qs + [9], labels=["低25%", "25-50%", "50-75%", "高25%"])
g = fr.groupby("档", observed=True).agg(
    篇数=("invest", "size"), 完播率=("finish_rate", "mean"), 浏览时长=("avg_view_time", "mean"),
    阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
    进店UV=("s_visit_uv", "sum"), 投入=("invest", "sum"), GMV=("s_gmv", "sum"))
g["完播率%"] = (g["完播率"] * 100).round(1)
g["浏览时长"] = g["浏览时长"].round(1)
g["组件点击率%"] = (g["组件点击"] / g["阅读"] * 100).round(2)
g["进店率%"] = (g["进店UV"] / fr.groupby("档", observed=True)["s_read_uv"].sum() * 100).round(2)
g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
g["ROI"] = (g["GMV"] / g["投入"]).round(2)
p(g[["篇数", "完播率%", "浏览时长", "组件点击率%", "进店率%", "进店成本", "ROI"]].to_string())
p()

# ---------- 5. 自然流量占比 ----------
p("=" * 92)
p("5. 自然流量占比：内容自身的传播力 vs 靠投放推")
p("=" * 92)
ns = VALID[VALID["nat_share"].notna() & (VALID["nat_share"] > 0)].copy()
ns["档"] = pd.cut(ns["nat_share"], [0, .3, .6, .85, 1.01], labels=["<30%", "30-60%", "60-85%", ">85%"])
g = ns.groupby("档", observed=True).agg(
    篇数=("invest", "size"), 自然占比=("nat_share", "mean"), 篇均投入=("invest", "mean"),
    阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
    进店UV=("s_visit_uv", "sum"), 投入=("invest", "sum"), GMV=("s_gmv", "sum"))
g["自然占比%"] = (g["自然占比"] * 100).round(1)
g["组件点击率%"] = (g["组件点击"] / g["阅读"] * 100).round(2)
g["进店率%"] = (g["进店UV"] / ns.groupby("档", observed=True)["s_read_uv"].sum() * 100).round(2)
g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
g["ROI"] = (g["GMV"] / g["投入"]).round(2)
g["篇均GMV"] = (g["GMV"] / g["篇数"]).round(0)
p(g[["篇数", "自然占比%", "篇均投入", "组件点击率%", "进店率%", "进店成本", "ROI", "篇均GMV"]].to_string())
p()

# ---------- 6. 搜索型内容 ----------
p("=" * 92)
p("6. 搜索进店占比：哪些内容在 Search 场域被找到")
p("=" * 92)
ss = VALID[VALID["search_share"].notna()].copy()
ss["档"] = pd.cut(ss["search_share"], [-.01, .3, .45, .6, 1.01], labels=["<30%", "30-45%", "45-60%", ">60%"])
g = ss.groupby("档", observed=True).agg(
    篇数=("invest", "size"), 搜索占比=("search_share", "mean"), 篇均投入=("invest", "mean"),
    浏览时长=("avg_view_time", "mean"), 阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
    进店UV=("s_visit_uv", "sum"), 投入=("invest", "sum"), GMV=("s_gmv", "sum"), 成交UV=("s_deal_uv", "sum"))
g["搜索占比%"] = (g["搜索占比"] * 100).round(1)
g["浏览时长"] = g["浏览时长"].round(1)
g["组件点击率%"] = (g["组件点击"] / g["阅读"] * 100).round(2)
g["进店率%"] = (g["进店UV"] / ss.groupby("档", observed=True)["s_read_uv"].sum() * 100).round(2)
g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
g["ROI"] = (g["GMV"] / g["投入"]).round(2)
g["成交率%"] = (g["成交UV"] / g["进店UV"] * 100).round(2)
p(g[["篇数", "搜索占比%", "篇均投入", "浏览时长", "组件点击率%", "进店率%", "进店成本", "ROI", "成交率%"]].to_string())
p()

# ---------- 7. 标题选题分析 ----------
p("=" * 92)
p("7. 标题选题：什么样的内容主题进店率高")
p("=" * 92)

THEMES = {
    "测评对比": ["测评", "评测", "对比", "横评", "实测", "试用", "体验report", "值不值", "怎么样", "真实感受"],
    "教学教程": ["教学", "教程", "怎么练", "怎么游", "技巧", "动作", "入门", "自学", "学会", "新手", "教你", "干货"],
    "痛点问题": ["别买", "避雷", "踩坑", "劝退", "后悔", "翻车", "误区", "错误", "问题", "毁", "坑"],
    "推荐种草": ["推荐", "必买", "好物", "种草", "闭眼", "无脑", "宝藏", "神器", "安利", "清单"],
    "身份场景": ["近视", "游泳池", "泳池", "夏天", "健身", "减肥", "瘦", "妈妈", "宝妈", "上班", "打工"],
    "个人故事": ["我的", "自从", "终于", "坚持", "记录", "vlog", "日常", "半年", "一个月", "天后"],
    "价格价值": ["千元", "元", "价格", "贵", "便宜", "性价比", "省", "花了", "值"],
    "黑科技感": ["黑科技", "科技", "智能", "ai", "高科技", "未来"],
}

def tag_theme(t):
    tl = str(t).lower()
    hits = [k for k, ws in THEMES.items() if any(w.lower() in tl for w in ws)]
    return hits

VALID["themes"] = VALID["title"].map(tag_theme)
rows = []
for theme in THEMES:
    sub = VALID[VALID["themes"].map(lambda x: theme in x)]
    if len(sub) < 8: continue
    rows.append({
        "主题": theme, "篇数": len(sub),
        "篇均投入": sub["invest"].mean(),
        "篇均阅读": sub["read_uv"].mean(),
        "浏览时长": sub["avg_view_time"].mean(),
        "组件点击率%": sub["cta_total"].sum() / sub["read_uv"].sum() * 100,
        "进店率%": sub["s_visit_uv"].sum() / sub["s_read_uv"].sum() * 100,
        "进店成本": sub["invest"].sum() / sub["s_visit_uv"].sum(),
        "搜索占比%": sub["s_search_visit_uv"].sum() / sub["s_visit_uv"].sum() * 100,
        "ROI": sub["s_gmv"].sum() / sub["invest"].sum(),
        "篇均GMV": sub["s_gmv"].mean(),
    })
td = pd.DataFrame(rows).round(2).sort_values("进店率%", ascending=False)
p(td.to_string(index=False))
p()
p(f"未命中任何主题的笔记: {(VALID['themes'].map(len)==0).sum()} 篇")
p()

# ---------- 8. 高进店率笔记的标题样本 ----------
p("=" * 92)
p("8. 进店率 TOP30 笔记的标题（看共性）")
p("=" * 92)
tp = VALID[VALID["s_read_uv"] > 3000].nlargest(30, "visit_rate")[
    ["creator", "note_type", "title", "read_uv", "avg_view_time", "cta_rate", "visit_rate", "visit_cost", "s_gmv", "search_share"]].copy()
tp["cta_rate%"] = (tp["cta_rate"] * 100).round(2)
tp["visit_rate%"] = (tp["visit_rate"] * 100).round(2)
tp["search%"] = (tp["search_share"] * 100).round(1)
tp["visit_cost"] = tp["visit_cost"].round(1)
tp["avg_view_time"] = tp["avg_view_time"].round(1)
p(tp[["creator", "note_type", "title", "read_uv", "avg_view_time", "cta_rate%", "visit_rate%", "visit_cost", "s_gmv", "search%"]].to_string())
p()

p("=" * 92)
p("9. 进店率 BOTTOM20 笔记的标题（看反面共性，仅取投入>3000的）")
p("=" * 92)
bt = VALID[(VALID["s_read_uv"] > 3000) & (VALID["invest"] > 3000)].nsmallest(20, "visit_rate")[
    ["creator", "note_type", "title", "read_uv", "avg_view_time", "interact_rate", "cta_rate", "visit_rate", "visit_cost", "invest"]].copy()
bt["cta_rate%"] = (bt["cta_rate"] * 100).round(2)
bt["visit_rate%"] = (bt["visit_rate"] * 100).round(3)
bt["interact%"] = (bt["interact_rate"] * 100).round(2)
bt["visit_cost"] = bt["visit_cost"].round(1)
bt["avg_view_time"] = bt["avg_view_time"].round(1)
p(bt[["creator", "note_type", "title", "read_uv", "avg_view_time", "interact%", "cta_rate%", "visit_rate%", "visit_cost", "invest"]].to_string())
p()

# ---------- 10. 阅读规模与进店率 ----------
p("=" * 92)
p("10. 爆文陷阱：阅读量越大，进店率是否越低")
p("=" * 92)
rb = VALID.copy()
rb["档"] = pd.cut(rb["read_uv"], [0, 5000, 2e4, 5e4, 1e5, 1e9],
                  labels=["<5千", "5千-2万", "2万-5万", "5万-10万", ">10万"])
g = rb.groupby("档", observed=True).agg(
    篇数=("invest", "size"), 篇均阅读=("read_uv", "mean"), 篇均投入=("invest", "mean"),
    阅读=("read_uv", "sum"), 组件点击=("cta_total", "sum"),
    进店UV=("s_visit_uv", "sum"), 投入=("invest", "sum"), GMV=("s_gmv", "sum"))
g["组件点击率%"] = (g["组件点击"] / g["阅读"] * 100).round(2)
g["进店率%"] = (g["进店UV"] / rb.groupby("档", observed=True)["s_read_uv"].sum() * 100).round(2)
g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
g["ROI"] = (g["GMV"] / g["投入"]).round(2)
g["篇均GMV"] = (g["GMV"] / g["篇数"]).round(0)
g["篇均阅读"] = g["篇均阅读"].round(0)
p(g[["篇数", "篇均阅读", "篇均投入", "组件点击率%", "进店率%", "进店成本", "ROI", "篇均GMV"]].to_string())
p()

# ---------- 11. 内容效率矩阵 ----------
p("=" * 92)
p("11. 内容四象限：组件点击率 × 进店率")
p("=" * 92)
q = VALID[VALID["cta_rate"].notna() & VALID["visit_rate"].notna()].copy()
cta_med = q["cta_rate"].median()
vr_med = q["visit_rate"].median()
def quad(r):
    hi_c = r["cta_rate"] >= cta_med
    hi_v = r["visit_rate"] >= vr_med
    if hi_c and hi_v: return "A 双高(理想)"
    if hi_c and not hi_v: return "B 点了不进店(承接断)"
    if not hi_c and hi_v: return "C 没点却进店(搜索/自然)"
    return "D 双低(无效)"
q["象限"] = q.apply(quad, axis=1)
p(f"中位线：组件点击率 {cta_med*100:.2f}%  进店率 {vr_med*100:.2f}%")
g = q.groupby("象限").agg(
    篇数=("invest", "size"), 投入=("invest", "sum"), 篇均投入=("invest", "mean"),
    进店UV=("s_visit_uv", "sum"), GMV=("s_gmv", "sum"),
    浏览时长=("avg_view_time", "mean"), 搜索占比=("search_share", "mean"),
    视频占比=("note_type", lambda s: (s == "视频").sum() / len(s) * 100))
g["进店成本"] = (g["投入"] / g["进店UV"]).round(2)
g["ROI"] = (g["GMV"] / g["投入"]).round(2)
g["篇均GMV"] = (g["GMV"] / g["篇数"]).round(0)
g["浏览时长"] = g["浏览时长"].round(1)
g["搜索占比%"] = (g["搜索占比"] * 100).round(1)
g["视频占比%"] = g["视频占比"].round(1)
p(g[["篇数", "篇均投入", "进店成本", "ROI", "篇均GMV", "浏览时长", "搜索占比%", "视频占比%"]].to_string())
p()

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_content.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(W))
print("OK")
