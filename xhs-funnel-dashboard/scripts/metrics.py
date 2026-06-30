# -*- coding: utf-8 -*-
"""三表合并 + 四层指标 + 相对水位线 + 四象限分类。

主体笔记 = 当期"有动作"的笔记 = 星河(有转化) ∪ 薯条(有消耗)。
蒲公英作为档案全集，为这些笔记提供前端内容指标和达人合作成本。

水位线 = 本期主体笔记每个指标的百分位（P25/P75 分档），每期自适应，不预设死阈值。
"""
import numpy as np
import pandas as pd


# ---------- 基础工具 ----------
def safe_div(a, b):
    """逐元素安全除；分母<=0 返回 NaN（前端显示'待补充'）。"""
    a = pd.to_numeric(a, errors="coerce")
    b = pd.to_numeric(b, errors="coerce")
    out = a / b.replace(0, np.nan)
    return out.replace([np.inf, -np.inf], np.nan)


def bucket_fans(fans):
    if pd.isna(fans):
        return "未知"
    f = float(fans)
    if f < 10000:
        return "素人(<1万)"
    if f < 100000:
        return "腰部(1-10万)"
    if f < 500000:
        return "肩部(10-50万)"
    return "头部(≥50万)"


# 待评分指标：+1 越高越好 / -1 越低越好（成本类）
SCORE_FIELDS = {
    # 内容质量层
    "play_5s": 1, "read_3s": 1, "avg_view_time": 1, "finish_rate": 1,
    "interact_rate": 1, "body_cta_ctr": 1, "comment_cta_ctr": 1, "natural_ratio": 1,
    # 转化漏斗层
    "visit_rate": 1, "cart_rate": 1, "deal_rate": 1,
    "new_visit_ratio": 1, "search_visit_ratio": 1,
    # 效率层
    "roi": 1, "gmv": 1, "visit_uv": 1, "deal_uv": 1,
    "visit_cost": -1, "deal_cost": -1, "read_price": -1,
}

# 中文标签（前端展示）
FIELD_LABELS = {
    "play_5s": "5s播放率", "read_3s": "3s阅读率", "avg_view_time": "平均浏览时长",
    "finish_rate": "完播率", "interact_rate": "互动率", "body_cta_ctr": "正文组件CTR",
    "comment_cta_ctr": "评论组件CTR", "natural_ratio": "自然流量占比",
    "visit_rate": "进店率", "cart_rate": "加购率", "deal_rate": "成交率",
    "new_visit_ratio": "新客进店占比", "search_visit_ratio": "搜索进店占比",
    "roi": "ROI", "gmv": "GMV", "visit_uv": "进店UV", "deal_uv": "成交UV",
    "visit_cost": "进店成本", "deal_cost": "成交成本", "read_price": "阅读单价",
}


# ---------- 合并 + 派生指标 ----------
def build_master(pgy, star_agg, chili_agg):
    subject = sorted(set(star_agg.index) | set(chili_agg.index))
    master = pd.DataFrame(index=pd.Index(subject, name="note_id"))

    # 蒲公英：read_uv 改名避免与星河冲突
    pgy2 = pgy.rename(columns={"read_uv": "read_uv_content", "creator": "creator_pgy"})
    master = master.join(pgy2, how="left")

    # 星河：read_uv 改名
    star2 = star_agg.rename(columns={"read_uv": "read_uv_funnel"})
    master = master.join(star2, how="left")
    if "creator_star" not in master and "creator" in star_agg.columns:
        pass

    # 薯条
    master = master.join(chili_agg, how="left")

    # 达人名：优先蒲公英
    master["creator"] = master["creator_pgy"]

    # 数值缺失补0（转化/消耗类）
    fill0 = ["read_uv_funnel", "visit_uv", "new_visit_uv", "search_visit_uv",
             "cart_uv", "deal_uv", "gmv", "spend", "chili_impression",
             "chili_read", "chili_orders", "total_amount", "read_uv_content",
             "natural_read", "promo_read"]
    for c in fill0:
        if c in master:
            master[c] = pd.to_numeric(master[c], errors="coerce").fillna(0)

    # ---- 成本 / 效率 ----
    master["total_cost"] = master["total_amount"].fillna(0) + master["spend"].fillna(0)
    master["is_invested"] = master["spend"] > 0
    master["roi"] = safe_div(master["gmv"], master["total_cost"])
    master["visit_cost"] = safe_div(master["total_cost"], master["visit_uv"])
    master["deal_cost"] = safe_div(master["total_cost"], master["deal_uv"])
    master["read_price"] = safe_div(master["total_cost"], master["read_uv_content"])

    # ---- 转化漏斗（基于星河同源口径）----
    master["visit_rate"] = safe_div(master["visit_uv"], master["read_uv_funnel"])
    master["cart_rate"] = safe_div(master["cart_uv"], master["visit_uv"])
    master["deal_rate"] = safe_div(master["deal_uv"], master["visit_uv"])
    master["new_visit_ratio"] = safe_div(master["new_visit_uv"], master["visit_uv"])
    master["search_visit_ratio"] = safe_div(master["search_visit_uv"], master["visit_uv"])

    # ---- 内容质量：自然流量占比 ----
    master["natural_ratio"] = safe_div(
        master["natural_read"], master["natural_read"] + master["promo_read"]
    )

    # ---- 归因维度 ----
    master["fans_tier"] = master["fans"].map(bucket_fans) if "fans" in master else "未知"
    master["note_type"] = master.get("note_type", pd.Series(index=master.index)).fillna("未知")

    return master


# ---------- 相对水位线 ----------
def add_waterlines(master):
    """对每个 SCORE_FIELD 算百分位与分档（优质/达标/预警）。成本类方向反转。"""
    waterlines = {}
    for field, direction in SCORE_FIELDS.items():
        if field not in master:
            continue
        s = pd.to_numeric(master[field], errors="coerce")
        pct = s.rank(pct=True)
        if direction < 0:           # 成本类：越低越好 → 反转
            pct = 1 - pct
        master[field + "_pct"] = pct

        def tier(p):
            if pd.isna(p):
                return "na"
            if p >= 0.75:
                return "good"
            if p < 0.25:
                return "warn"
            return "mid"
        master[field + "_tier"] = pct.map(tier)

        valid = s.dropna()
        if len(valid):
            waterlines[field] = {
                "p25": float(valid.quantile(0.25)),
                "p50": float(valid.quantile(0.50)),
                "p75": float(valid.quantile(0.75)),
                "direction": direction,
                "label": FIELD_LABELS.get(field, field),
            }
    return master, waterlines


# ---------- 四象限 ----------
def classify(master):
    """转化综合分 = [进店率, 成交率, ROI] 百分位等权均值；切分线 Y=0.5、X=已投消耗中位数。"""
    parts = [master[c + "_pct"] for c in ["visit_rate", "deal_rate", "roi"] if c + "_pct" in master]
    conv = pd.concat(parts, axis=1).mean(axis=1) if parts else pd.Series(0.0, index=master.index)
    master["conv_score"] = conv.fillna(0)
    # 无进店=转化链路未启动，直接归零（避免大量0值并列 rank 把分数抬到中位）
    master.loc[master["visit_uv"] <= 0, "conv_score"] = 0.0

    invested = master[master["is_invested"]]
    x_split = float(invested["spend"].median()) if len(invested) else 0.0

    def quad(row):
        hi = row["conv_score"] >= 0.5
        if row["is_invested"]:
            return "加大投/稳住" if hi else "止损"
        return "重点追投" if hi else "观察"

    master["quadrant"] = master.apply(quad, axis=1)
    master.attrs["x_split"] = x_split
    return master


# ---------- 汇总 ----------
def compute(pgy, star_agg, chili_agg):
    master = build_master(pgy, star_agg, chili_agg)
    master, waterlines = add_waterlines(master)
    master = classify(master)

    total_cost = float(master["total_cost"].sum())
    total_gmv = float(master["gmv"].sum())
    summary = {
        "note_count": int(len(master)),
        "total_cost": total_cost,
        "total_gmv": total_gmv,
        "overall_roi": (total_gmv / total_cost) if total_cost else None,
        "invested_count": int(master["is_invested"].sum()),
        "quadrant_counts": master["quadrant"].value_counts().to_dict(),
        "x_split": master.attrs.get("x_split", 0.0),
    }
    return master, waterlines, summary
