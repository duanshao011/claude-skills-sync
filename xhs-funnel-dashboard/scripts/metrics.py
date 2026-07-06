# -*- coding: utf-8 -*-
"""四表合并 + 派生指标 + 相对水位线。

主体笔记 = 当期"有动作"的笔记 = 星河(有转化) ∪ 薯条(有消耗)。
蒲公英作为档案全集，为这些笔记提供前端内容指标和达人合作成本。
灵犀作为人群资产表，透传 TI 人群数、进店兑换比等种草指标。

投放金额口径（2026-07-01 更新）：
  投放金额 = 薯条实际消耗（不含达人合作费）
  ROI = 商家GMV / 投放金额
  阅读UV成本 = 投放金额 / 蒲公英阅读UV
  进店UV成本 = 投放金额 / 星河进店UV
  组件点击成本 = 投放金额 / (正文点击量 + 底栏点击量 + 评论区点击量)

水位线 = 本期主体笔记每个指标的百分位（P25/P75 分档），每期自适应，不预设死阈值。
"""
import math
import numpy as np
import pandas as pd


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


SCORE_FIELDS = {
    "play_5s": 1, "read_3s": 1, "avg_view_time": 1, "finish_rate": 1,
    "interact_rate": 1, "body_cta_ctr": 1, "comment_cta_ctr": 1,
    "content_ctr": 1, "component_click_total": 1, "natural_ratio": 1,
    "visit_rate": 1, "cart_rate": 1, "deal_rate": 1,
    "new_visit_ratio": 1, "search_visit_ratio": 1,
    "roi": 1, "gmv": 1, "visit_uv": 1, "deal_uv": 1, "uv_value": 1,
    "ti_users": 1, "iti_users": 1, "visit_users": 1,
    "ti_visit_ratio": -1, "iti_visit_ratio": -1,
    "read_uv_cost": -1, "visit_uv_cost": -1, "component_cost": -1,
    "cart_cost": -1, "deal_cost": -1,
    "read_uv_funnel": 1, "cart_uv": 1, "uv_cost": -1,
}

FIELD_LABELS = {
    "play_5s": "5s播放率", "read_3s": "3s阅读率", "avg_view_time": "平均浏览时长",
    "finish_rate": "完播率", "interact_rate": "互动率",
    "body_cta_ctr": "正文组件CTR", "comment_cta_ctr": "评论区组件CTR",
    "content_ctr": "内容点击率", "component_click_total": "组件点击总量",
    "natural_ratio": "自然流量占比",
    "visit_rate": "进店率", "cart_rate": "进店加购率", "deal_rate": "进店转化率",
    "new_visit_ratio": "新客进店占比", "search_visit_ratio": "搜索进店占比",
    "roi": "ROI", "gmv": "商家GMV", "visit_uv": "进店UV", "deal_uv": "成交UV",
    "cart_uv": "加购UV", "read_uv_funnel": "阅读UV(星河)", "uv_cost": "UV成本",
    "read_uv_cost": "阅读UV成本", "visit_uv_cost": "进店UV成本",
    "component_cost": "组件点击成本", "cart_cost": "加购成本", "deal_cost": "成交成本",
    "ti_users": "TI人群数", "iti_users": "I+TI人群数", "visit_users": "进店用户数",
    "ti_visit_ratio": "TI人群进店兑换比", "iti_visit_ratio": "I+TI人群进店兑换比",
}


def build_master(pgy, star_agg, chili_agg, lx=None):
    """四表左连接到主表；缺表时对应字段为 NaN。"""
    idx_star = set(star_agg.index) if star_agg is not None else set()
    idx_chili = set(chili_agg.index) if chili_agg is not None else set()
    subject = sorted(idx_star | idx_chili)
    master = pd.DataFrame(index=pd.Index(subject, name="note_id"))

    # 行级来源标记：每篇笔记在哪几张表里存在
    master["in_pgy"] = master.index.isin(pgy.index) if pgy is not None else False
    master["in_star"] = master.index.isin(star_agg.index) if star_agg is not None else False
    master["in_chili"] = master.index.isin(chili_agg.index) if chili_agg is not None else False
    master["in_lx"] = master.index.isin(lx.index) if lx is not None else False

    if pgy is not None:
        pgy2 = pgy.rename(columns={
            "read_uv": "read_uv_content",
            "creator": "creator_pgy",
            "exposure": "pgy_exposure",
            "read_count": "pgy_read",
        })
        master = master.join(pgy2, how="left")

    if star_agg is not None:
        star2 = star_agg.rename(columns={"read_uv": "read_uv_funnel", "creator": "creator_star"})
        master = master.join(star2, how="left")

    if chili_agg is not None:
        chili2 = chili_agg.copy()
        if "creator" in chili2:
            chili2 = chili2.rename(columns={"creator": "creator_chili"})
        master = master.join(chili2, how="left")

    if lx is not None:
        lx2 = lx.rename(columns={
            "creator": "creator_lx",
            "title": "title_lx",
            "exposure": "lx_exposure",
            "read_count": "lx_read",
            "interact_count": "lx_interact_count",
            "interact_rate": "lx_interact_rate",
            "ctr": "lx_ctr",
        })
        # 剔除会与 pgy/star 撞名的列
        overlap = [c for c in lx2.columns if c in master.columns]
        if overlap:
            lx2 = lx2.drop(columns=overlap)
        master = master.join(lx2, how="left")

    master["creator"] = master.get("creator_pgy", pd.Series(index=master.index))
    if "creator_star" in master:
        master["creator"] = master["creator"].fillna(master["creator_star"])
    if "creator_lx" in master:
        master["creator"] = master["creator"].fillna(master["creator_lx"])
    if "creator_chili" in master:
        master["creator"] = master["creator"].fillna(master["creator_chili"])

    fill0 = ["read_uv_funnel", "visit_uv", "new_visit_uv", "search_visit_uv",
             "cart_uv", "deal_uv", "gmv", "spend", "chili_impression",
             "chili_read", "chili_orders", "chili_max_daily", "chili_days",
             "total_amount", "read_uv_content",
             "natural_read", "promo_read",
             "body_cta_click", "footer_cta_click", "comment_cta_click",
             "pgy_exposure", "pgy_read",
             "ti_users", "iti_users", "visit_users",
             "lx_exposure", "lx_read", "interact_count"]
    for c in fill0:
        if c in master:
            master[c] = pd.to_numeric(master[c], errors="coerce").fillna(0)
        else:
            master[c] = 0

    master["is_invested"] = master.get("spend", 0) > 0
    master["roi"] = safe_div(master["gmv"], master["spend"])
    master["read_uv_cost"] = safe_div(master["spend"], master["read_uv_content"])
    master["visit_uv_cost"] = safe_div(master["spend"], master["visit_uv"])
    master["deal_cost"] = safe_div(master["spend"], master["deal_uv"])
    master["cart_cost"] = safe_div(master["spend"], master["cart_uv"])
    master["uv_value"] = safe_div(master["gmv"], master["visit_uv"])
    # UV成本 = 投放金额 / 商家GMV（营销费率/ACoS：每 1 元 GMV 需要多少投放）
    master["uv_cost"] = safe_div(master["spend"], master["gmv"])

    if "body_cta_click" in master:
        master["component_click_total"] = (
            master["body_cta_click"].fillna(0)
            + master["footer_cta_click"].fillna(0)
            + master["comment_cta_click"].fillna(0)
        )
        master["component_cost"] = safe_div(master["spend"], master["component_click_total"])

    if "pgy_exposure" in master:
        master["content_ctr"] = safe_div(master["pgy_read"], master["pgy_exposure"])

    master["visit_rate"] = safe_div(master["visit_uv"], master["read_uv_funnel"])
    master["cart_rate"] = safe_div(master["cart_uv"], master["visit_uv"])
    master["deal_rate"] = safe_div(master["deal_uv"], master["visit_uv"])
    master["new_visit_ratio"] = safe_div(master["new_visit_uv"], master["visit_uv"])
    master["search_visit_ratio"] = safe_div(master["search_visit_uv"], master["visit_uv"])

    master["natural_ratio"] = safe_div(
        master["natural_read"], master["natural_read"] + master["promo_read"]
    )

    master["fans_tier"] = master["fans"].map(bucket_fans) if "fans" in master else "未知"
    master["note_type"] = master.get("note_type", pd.Series(index=master.index)).fillna("未知")

    return master


def add_waterlines(master):
    """对每个 SCORE_FIELD 算百分位与分档（优质/达标/预警）。成本类方向反转。"""
    waterlines = {}
    for field, direction in SCORE_FIELDS.items():
        if field not in master:
            continue
        s = pd.to_numeric(master[field], errors="coerce")
        pct = s.rank(pct=True)
        if direction < 0:
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


def _f(v):
    """转干净 float；NaN/inf/非数 → None。供 cost payload 直接 JSON 序列化。"""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def build_cost_daily(chili_daily, star_daily, master):
    """图表二·单篇成本分析数据。只为有薯条消耗的笔记构建。

    每篇产出：
      summary  — 累计消耗/GMV/ROI/进店UV成本/加购成本/成交成本/历史最高单日消耗
      daily    — [启动日, 当日实付, 进店UV, 加购UV, 成交UV, GMV, 累计进店成本]
    薯条「启动日」× 星河「成交日(归因30)」按天对齐为近似——前端 hover 注明。
    """
    if chili_daily is None or not len(chili_daily):
        return {}

    star_by_note = {}
    if star_daily is not None and len(star_daily):
        sd = star_daily.copy()
        sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
        for nid, g in sd.groupby("note_id"):
            star_by_note[str(nid)] = g

    cost = {}
    for nid, cg in chili_daily.groupby("note_id"):
        nid = str(nid)
        cmap = {int(r["launch_date"]): float(r["spend"]) for _, r in cg.iterrows()}
        smap = {}
        if nid in star_by_note:
            for _, r in star_by_note[nid].iterrows():
                d = r["date"]
                if pd.isna(d):
                    continue
                smap[int(d)] = r
        dates = sorted(set(cmap) | set(smap))
        daily = []
        for d in dates:
            sr = smap.get(d)
            daily.append([
                d,
                _f(cmap.get(d)),
                _f(sr.get("visit_uv")) if sr is not None else None,
                _f(sr.get("cart_uv")) if sr is not None else None,
                _f(sr.get("deal_uv")) if sr is not None else None,
                _f(sr.get("gmv")) if sr is not None else None,
            ])

        # ===== 每日追加：累计进店成本 =====
        n = len(daily)
        cum_s, cum_v = 0.0, 0.0
        for i in range(n):
            cum_s += daily[i][1] or 0.0
            cum_v += daily[i][2] or 0.0
            daily[i].append(_f(cum_s / cum_v) if cum_v > 0 else None)

        row = master.loc[nid] if nid in master.index else None
        if row is not None:
            creator = row.get("creator")
            summary = {
                "spend": _f(row.get("spend")),
                "gmv": _f(row.get("gmv")),
                "roi": _f(row.get("roi")),
                "visit_uv_cost": _f(row.get("visit_uv_cost")),
                "cart_cost": _f(row.get("cart_cost")),
                "deal_cost": _f(row.get("deal_cost")),
                "max_daily": _f(row.get("chili_max_daily")),
                "creator": creator if isinstance(creator, str) else None,
            }
        else:
            summary = {"spend": _f(sum(cmap.values()))}

        cost[nid] = {"summary": summary, "daily": daily}
    return cost


def compute(pgy, star_agg, chili_agg, lx=None, chili_daily=None, star_daily=None):
    master = build_master(pgy, star_agg, chili_agg, lx)
    master, waterlines = add_waterlines(master)
    cost = build_cost_daily(chili_daily, star_daily, master)

    # ===== 全部笔记汇总日趋势（搜索框清空时默认展示） =====
    trends_all = []
    if star_daily is not None and len(star_daily):
        sd = star_daily.copy()
        sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
        g = sd.groupby("date", as_index=False).agg({
            "visit_uv": "sum", "cart_uv": "sum", "deal_uv": "sum", "gmv": "sum"
        }).sort_values("date")
        for _, r in g.iterrows():
            trends_all.append([
                int(r["date"]) if pd.notna(r["date"]) else None,
                _f(r.get("visit_uv")), _f(r.get("cart_uv")),
                _f(r.get("deal_uv")), _f(r.get("gmv"))
            ])

    cost_all = None
    if chili_daily is not None and len(chili_daily):
        # 汇总每日花费
        cd = chili_daily.copy()
        cd["launch_date"] = pd.to_numeric(cd["launch_date"], errors="coerce").astype("Int64")
        g_spend = cd.groupby("launch_date", as_index=False)["spend"].sum().sort_values("launch_date")
        spend_map = {int(r["launch_date"]): float(r["spend"]) for _, r in g_spend.iterrows()}
        # 汇总每日进店UV（从 star_daily）
        visit_map = {}
        if star_daily is not None and len(star_daily):
            sd = star_daily.copy()
            sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
            g_visit = sd.groupby("date", as_index=False)["visit_uv"].sum()
            visit_map = {int(r["date"]): float(r["visit_uv"]) for _, r in g_visit.iterrows()}
        # 合并日期
        all_dates = sorted(set(spend_map) | set(visit_map))
        daily_list = []
        for d in all_dates:
            daily_list.append([d, _f(spend_map.get(d)), _f(visit_map.get(d))])
        # 追加累计成本
        n = len(daily_list)
        cum_s, cum_v = 0.0, 0.0
        for i in range(n):
            cum_s += daily_list[i][1] or 0.0
            cum_v += daily_list[i][2] or 0.0
            daily_list[i].append(_f(cum_s / cum_v) if cum_v > 0 else None)
        cost_all = {
            "summary": {
                "spend": _f(master["spend"].sum()),
                "gmv": _f(master["gmv"].sum()),
                "visit_uv": _f(master["visit_uv"].sum()),
                "cart_uv": _f(master["cart_uv"].sum()),
                "deal_uv": _f(master["deal_uv"].sum()),
                "note_count": int(len(master)),
            },
            "daily": daily_list,
        }

    total_spend = float(master["spend"].sum())
    total_gmv = float(master["gmv"].sum())
    summary = {
        "note_count": int(len(master)),
        "total_spend": total_spend,
        "total_gmv": total_gmv,
        "overall_roi": (total_gmv / total_spend) if total_spend else None,
        "invested_count": int(master["is_invested"].sum()),
    }
    return master, waterlines, summary, cost, trends_all, cost_all
