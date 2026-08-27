# -*- coding: utf-8 -*-
"""五表合并 + 派生指标 + 相对水位线。

主体笔记 = 蒲公英 ∪ 星河 ∪ 薯条 ∪ 聚光 ∪ 灵犀 的 note_id 并集。
博哥上传哪几张表，就展示这些表覆盖到的全部笔记；缺表字段由前端明确标注。

投放金额口径（2026-08-24 更新）：
  全量投入 = 薯条实际支付 + 聚光实际消耗
  ROI/成本 = 从每篇首个付费日到星河最新日的同样本有效指标
  阅读/进店/加购/成交业务UV全部固定采用星河口径
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
    "cart_uv": "加购UV", "read_uv_funnel": "阅读/播放UV",
    "uv_value": "进店UV价值", "uv_cost": "阅读UV成本(星河)",
    "read_uv_cost": "阅读UV成本(蒲公英)", "visit_uv_cost": "进店UV成本",
    "component_cost": "组件点击成本", "cart_cost": "加购成本", "deal_cost": "成交成本",
    "ti_users": "TI人群数", "iti_users": "I+TI人群数", "visit_users": "进店用户数",
    "ti_visit_ratio": "TI人群进店兑换比", "iti_visit_ratio": "I+TI人群进店兑换比",
}


def build_master(pgy, star_agg, chili_agg, juguang_agg, lx=None):
    """以五张表 note_id 并集构建主表；缺表时对应字段为 NaN。"""
    for frame in (pgy, star_agg, chili_agg, juguang_agg, lx):
        if frame is not None:
            frame.index = frame.index.astype(str)
    idx_pgy = set(pgy.index) if pgy is not None else set()
    idx_star = set(star_agg.index) if star_agg is not None else set()
    idx_chili = set(chili_agg.index) if chili_agg is not None else set()
    idx_juguang = set(juguang_agg.index) if juguang_agg is not None else set()
    idx_lx = set(lx.index) if lx is not None else set()
    subject = sorted(idx_pgy | idx_star | idx_chili | idx_juguang | idx_lx)
    master = pd.DataFrame(index=pd.Index(subject, name="note_id"))

    # 行级来源标记：每篇笔记在哪几张表里存在
    master["in_pgy"] = master.index.isin(pgy.index) if pgy is not None else False
    master["in_star"] = master.index.isin(star_agg.index) if star_agg is not None else False
    master["in_chili"] = master.index.isin(chili_agg.index) if chili_agg is not None else False
    master["in_juguang"] = master.index.isin(juguang_agg.index) if juguang_agg is not None else False
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
        chili2 = chili_agg.rename(columns={"spend": "chili_spend"}).copy()
        if "creator" in chili2:
            chili2 = chili2.rename(columns={"creator": "creator_chili"})
        master = master.join(chili2, how="left")

    if juguang_agg is not None:
        master = master.join(juguang_agg, how="left")

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

    def _clean_creator(series):
        s = series.astype("string").str.strip()
        # “光粒”是品牌/项目占位账号，任何来源都不得作为真实达人昵称。
        return s.mask(s.isin(["", "nan", "None", "—", "光粒"]))

    master["creator"] = _clean_creator(
        master.get("creator_pgy", pd.Series(index=master.index, dtype="string"))
    )
    if "creator_star" in master:
        master["creator"] = master["creator"].fillna(_clean_creator(master["creator_star"]))
    if "creator_chili" in master:
        master["creator"] = master["creator"].fillna(_clean_creator(master["creator_chili"]))
    if "creator_lx" in master:
        master["creator"] = master["creator"].fillna(_clean_creator(master["creator_lx"]))

    fill0 = ["read_uv_funnel", "visit_uv", "new_visit_uv", "search_visit_uv",
             "cart_uv", "deal_uv", "gmv", "chili_spend", "juguang_spend",
             "juguang_impression", "juguang_click", "juguang_interaction",
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

    master["spend"] = master["chili_spend"] + master["juguang_spend"]
    master["is_invested"] = master.get("spend", 0) > 0
    for field in ["effective_spend", "effective_read_uv", "effective_visit_uv",
                  "effective_cart_uv", "effective_deal_uv", "effective_gmv"]:
        master[field] = np.nan
    master["roi"] = safe_div(master["effective_gmv"], master["effective_spend"])
    master["read_uv_cost"] = safe_div(master["spend"], master["read_uv_content"])
    master["visit_uv_cost"] = safe_div(master["effective_spend"], master["effective_visit_uv"])
    master["deal_cost"] = safe_div(master["effective_spend"], master["effective_deal_uv"])
    master["cart_cost"] = safe_div(master["effective_spend"], master["effective_cart_uv"])
    master["uv_value"] = safe_div(master["gmv"], master["visit_uv"])
    # UV成本 = 投放金额 / 星河阅读UV（拉动一个星河阅读用户的付费成本）
    master["uv_cost"] = safe_div(master["effective_spend"], master["effective_read_uv"])

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


PGY_SCORE_FIELDS = {
    "play_5s", "read_3s", "avg_view_time", "finish_rate", "interact_rate",
    "body_cta_ctr", "comment_cta_ctr", "content_ctr", "component_click_total",
    "natural_ratio", "read_uv_cost",
}
STAR_SCORE_FIELDS = {
    "read_uv_funnel", "visit_uv", "cart_uv", "deal_uv", "gmv", "uv_value",
    "visit_rate", "cart_rate", "deal_rate", "new_visit_ratio", "search_visit_ratio",
}
STAR_PAID_SCORE_FIELDS = {"roi", "uv_cost", "visit_uv_cost", "cart_cost", "deal_cost"}
LX_SCORE_FIELDS = {
    "ti_users", "iti_users", "visit_users", "ti_visit_ratio", "iti_visit_ratio",
}


def _score_source_mask(master, field):
    """水位线只比较拥有对应来源的笔记，缺来源补0不得参与排名。"""
    if field == "component_cost":
        return master["in_pgy"] & (master["in_chili"] | master["in_juguang"])
    if field == "read_uv_cost":
        return master["in_pgy"] & (master["in_chili"] | master["in_juguang"])
    if field in PGY_SCORE_FIELDS:
        return master["in_pgy"]
    if field in STAR_PAID_SCORE_FIELDS:
        return master["in_star"] & (master["in_chili"] | master["in_juguang"])
    if field in STAR_SCORE_FIELDS:
        return master["in_star"]
    if field in LX_SCORE_FIELDS:
        return master["in_lx"]
    return pd.Series(True, index=master.index)


def add_waterlines(master):
    """按真实数据来源计算百分位与分档；缺来源记录固定为 na。"""
    waterlines = {}
    for field, direction in SCORE_FIELDS.items():
        if field not in master:
            continue
        mask = _score_source_mask(master, field)
        s = pd.to_numeric(master[field], errors="coerce").where(mask)
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


def _complete_natural_dates(date_values):
    """将 YYYYMMDD 日期集合补齐为连续自然日，供严格3日滚动窗口使用。"""
    values = sorted({int(v) for v in date_values if pd.notna(v)})
    if not values:
        return []
    start = pd.to_datetime(str(values[0]), format="%Y%m%d")
    end = pd.to_datetime(str(values[-1]), format="%Y%m%d")
    return [int(d.strftime("%Y%m%d")) for d in pd.date_range(start, end, freq="D")]


def build_cost_data(chili_daily, juguang_daily, star_daily, master):
    """构建双渠道成本数据，并把星河同样本有效指标回填主表。"""
    pieces = []
    if chili_daily is not None and len(chili_daily):
        cd = chili_daily.copy().rename(columns={"launch_date": "date", "spend": "chili_spend"})
        cd["note_id"] = cd["note_id"].astype(str)
        cd["date"] = pd.to_numeric(cd["date"], errors="coerce").astype("Int64")
        keep = ["note_id", "date", "chili_spend"]
        for field in ["impression", "read"]:
            if field in cd:
                keep.append(field)
        pieces.append(cd[keep])
    if juguang_daily is not None and len(juguang_daily):
        jd = juguang_daily.copy()
        jd["note_id"] = jd["note_id"].astype(str)
        jd["date"] = pd.to_numeric(jd["date"], errors="coerce").astype("Int64")
        pieces.append(jd)
    if not pieces:
        master["paid_days"] = 0
        return master, {}, None, {}

    events = pieces[0]
    for part in pieces[1:]:
        events = pd.merge(events, part, on=["note_id", "date"], how="outer")
    numeric = ["chili_spend", "juguang_spend", "impression", "read",
               "juguang_impression", "juguang_click", "juguang_interaction"]
    for field in numeric:
        if field not in events:
            events[field] = 0.0
        events[field] = pd.to_numeric(events[field], errors="coerce").fillna(0.0)
    events = events[events["date"].notna()].copy()
    events["date"] = events["date"].astype(int)
    events["spend"] = events["chili_spend"] + events["juguang_spend"]
    positive = events[events["spend"] > 0].copy()

    paid_days = positive.groupby("note_id")["date"].nunique()
    master["paid_days"] = master.index.to_series().map(paid_days).fillna(0).astype(int)
    master["is_invested"] = master["spend"] > 0

    full_chili = float(events["chili_spend"].sum())
    full_juguang = float(events["juguang_spend"].sum())
    chili_ids = set(positive.loc[positive["chili_spend"] > 0, "note_id"])
    juguang_ids = set(positive.loc[positive["juguang_spend"] > 0, "note_id"])
    base_meta = {
        "full_chili_spend": full_chili,
        "full_juguang_spend": full_juguang,
        "full_spend": full_chili + full_juguang,
        "chili_note_count": len(chili_ids),
        "juguang_note_count": len(juguang_ids),
        "both_note_count": len(chili_ids & juguang_ids),
        "paid_note_count": len(chili_ids | juguang_ids),
    }
    if star_daily is None or not len(star_daily):
        return master, {}, None, base_meta

    sd = star_daily.copy()
    sd["note_id"] = sd["note_id"].astype(str)
    sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
    if "read_uv" not in sd:
        sd["read_uv"] = 0
    cutoff = int(sd["date"].max())
    waiting = positive[positive["date"] > cutoff]
    effective_events = positive[positive["date"] <= cutoff].copy()
    first_paid = effective_events.groupby("note_id")["date"].min().astype(int)
    star_ids = set(sd["note_id"])
    matched_ids = set(first_paid.index) & star_ids
    matched_events = effective_events[effective_events["note_id"].isin(matched_ids)].copy()
    unmatched_events = effective_events[~effective_events["note_id"].isin(star_ids)]
    if not matched_ids:
        base_meta.update({
            "star_cutoff": cutoff,
            "waiting_chili_spend": float(waiting["chili_spend"].sum()),
            "waiting_juguang_spend": float(waiting["juguang_spend"].sum()),
            "waiting_spend": float(waiting["spend"].sum()),
            "effective_spend": 0.0, "effective_chili_spend": 0.0,
            "effective_juguang_spend": 0.0, "matched_note_count": 0,
            "unmatched_note_count": len(first_paid),
            "unmatched_spend": float(unmatched_events["spend"].sum()),
        })
        return master, {}, None, base_meta

    effective_star = sd[sd["note_id"].isin(matched_ids) & (sd["date"] <= cutoff)].copy()
    effective_star["first_paid"] = effective_star["note_id"].map(first_paid)
    effective_star = effective_star[effective_star["date"] >= effective_star["first_paid"]]
    star_fields = ["read_uv", "visit_uv", "cart_uv", "deal_uv", "gmv"]
    star_note = effective_star.groupby("note_id")[star_fields].sum()
    spend_note = matched_events.groupby("note_id")[["spend", "chili_spend", "juguang_spend"]].sum()
    for field in ["effective_spend", "effective_chili_spend", "effective_juguang_spend",
                  "effective_read_uv", "effective_visit_uv", "effective_cart_uv",
                  "effective_deal_uv", "effective_gmv"]:
        master[field] = np.nan
    mapping = {
        "effective_spend": (spend_note, "spend"),
        "effective_chili_spend": (spend_note, "chili_spend"),
        "effective_juguang_spend": (spend_note, "juguang_spend"),
        "effective_read_uv": (star_note, "read_uv"),
        "effective_visit_uv": (star_note, "visit_uv"),
        "effective_cart_uv": (star_note, "cart_uv"),
        "effective_deal_uv": (star_note, "deal_uv"),
        "effective_gmv": (star_note, "gmv"),
    }
    for target, (frame, source) in mapping.items():
        master[target] = master.index.to_series().map(frame[source])
    master["roi"] = safe_div(master["effective_gmv"], master["effective_spend"])
    master["uv_cost"] = safe_div(master["effective_spend"], master["effective_read_uv"])
    master["visit_uv_cost"] = safe_div(master["effective_spend"], master["effective_visit_uv"])
    master["cart_cost"] = safe_div(master["effective_spend"], master["effective_cart_uv"])
    master["deal_cost"] = safe_div(master["effective_spend"], master["effective_deal_uv"])

    star_by_note = {nid: group for nid, group in effective_star.groupby("note_id")}
    event_by_note = {nid: group for nid, group in matched_events.groupby("note_id")}
    cost = {}
    for nid in sorted(matched_ids):
        ng = event_by_note.get(nid, pd.DataFrame())
        sg = star_by_note.get(nid, pd.DataFrame())
        start = int(first_paid.loc[nid])
        dates = _complete_natural_dates([start, cutoff])
        event_map = {int(row["date"]): row for _, row in ng.iterrows()}
        star_map = {int(row["date"]): row for _, row in sg.iterrows()}
        rows = []
        cum_spend = cum_visit = 0.0
        for date in dates:
            er = event_map.get(date)
            sr = star_map.get(date)
            chili_spend = float(er.get("chili_spend", 0)) if er is not None else 0.0
            juguang_spend = float(er.get("juguang_spend", 0)) if er is not None else 0.0
            spend = chili_spend + juguang_spend
            visit = float(sr.get("visit_uv", 0)) if sr is not None else 0.0
            cum_spend += spend
            cum_visit += visit
            rows.append([
                date, _f(spend), _f(visit),
                _f(sr.get("cart_uv", 0)) if sr is not None else 0.0,
                _f(sr.get("deal_uv", 0)) if sr is not None else 0.0,
                _f(sr.get("gmv", 0)) if sr is not None else 0.0,
                _f(sr.get("read_uv", 0)) if sr is not None else 0.0,
                _f(cum_spend / cum_visit) if cum_visit > 0 else None,
                _f(chili_spend), _f(juguang_spend),
            ])
        row = master.loc[nid]
        cost[nid] = {
            "summary": {
                "spend": _f(row.get("effective_spend")),
                "chili_spend": _f(row.get("effective_chili_spend")),
                "juguang_spend": _f(row.get("effective_juguang_spend")),
                "gmv": _f(row.get("effective_gmv")), "roi": _f(row.get("roi")),
                "uv_cost": _f(row.get("uv_cost")), "visit_uv_cost": _f(row.get("visit_uv_cost")),
                "cart_cost": _f(row.get("cart_cost")), "deal_cost": _f(row.get("deal_cost")),
                "days": int(ng["date"].nunique()),
                "chili_days": int(ng.loc[ng["chili_spend"] > 0, "date"].nunique()),
                "juguang_days": int(ng.loc[ng["juguang_spend"] > 0, "date"].nunique()),
                "creator": str(row.get("creator")) if pd.notna(row.get("creator")) else "",
            },
            "daily": rows,
        }

    all_dates = _complete_natural_dates([int(first_paid.loc[list(matched_ids)].min()), cutoff])
    spend_date = matched_events.groupby("date")[["spend", "chili_spend", "juguang_spend"]].sum()
    count_date = matched_events.groupby("date")["note_id"].nunique()
    star_date = effective_star.groupby("date")[star_fields].sum()
    daily_all = []
    cum_spend = cum_visit = 0.0
    for date in all_dates:
        er = spend_date.loc[date] if date in spend_date.index else None
        sr = star_date.loc[date] if date in star_date.index else None
        chili_spend = float(er.get("chili_spend", 0)) if er is not None else 0.0
        juguang_spend = float(er.get("juguang_spend", 0)) if er is not None else 0.0
        spend = chili_spend + juguang_spend
        visit = float(sr.get("visit_uv", 0)) if sr is not None else 0.0
        cum_spend += spend
        cum_visit += visit
        daily_all.append([
            date, _f(spend), _f(visit),
            _f(sr.get("cart_uv", 0)) if sr is not None else 0.0,
            _f(sr.get("deal_uv", 0)) if sr is not None else 0.0,
            _f(sr.get("read_uv", 0)) if sr is not None else 0.0,
            _f(cum_spend / cum_visit) if cum_visit > 0 else None,
            int(count_date.get(date, 0)), _f(chili_spend), _f(juguang_spend),
        ])

    creator_map = master["creator"].fillna("").astype(str).to_dict()
    cost_daily_notes = {}
    for date, group in matched_events.groupby("date"):
        items = []
        for _, row in group.iterrows():
            nid = str(row["note_id"])
            items.append({
                "note_id": nid, "creator": creator_map.get(nid, ""),
                "spend": _f(row.get("spend")), "chili_spend": _f(row.get("chili_spend")),
                "juguang_spend": _f(row.get("juguang_spend")),
                "impression": _f(row.get("impression")), "read": _f(row.get("read")),
                "juguang_impression": _f(row.get("juguang_impression")),
                "juguang_click": _f(row.get("juguang_click")),
            })
        items.sort(key=lambda item: -(item["spend"] or 0))
        cost_daily_notes[int(date)] = items

    matched_spend = float(matched_events["spend"].sum())
    matched_chili = float(matched_events["chili_spend"].sum())
    matched_juguang = float(matched_events["juguang_spend"].sum())
    summary = {
        "spend": matched_spend, "chili_spend": matched_chili,
        "juguang_spend": matched_juguang,
        "gmv": float(effective_star["gmv"].sum()),
        "visit_uv": float(effective_star["visit_uv"].sum()),
        "cart_uv": float(effective_star["cart_uv"].sum()),
        "deal_uv": float(effective_star["deal_uv"].sum()),
        "read_uv": float(effective_star["read_uv"].sum()),
        "note_count": len(matched_ids),
        "days": int(matched_events["date"].nunique()),
        "chili_days": int(matched_events.loc[matched_events["chili_spend"] > 0, "date"].nunique()),
        "juguang_days": int(matched_events.loc[matched_events["juguang_spend"] > 0, "date"].nunique()),
    }
    cost_all = {"summary": summary, "daily": daily_all, "daily_notes": cost_daily_notes}
    base_meta.update({
        "star_cutoff": cutoff,
        "waiting_chili_spend": float(waiting["chili_spend"].sum()),
        "waiting_juguang_spend": float(waiting["juguang_spend"].sum()),
        "waiting_spend": float(waiting["spend"].sum()),
        "effective_spend": matched_spend,
        "effective_chili_spend": matched_chili,
        "effective_juguang_spend": matched_juguang,
        "matched_note_count": len(matched_ids),
        "unmatched_note_count": len(set(first_paid.index) - star_ids),
        "unmatched_spend": float(unmatched_events["spend"].sum()),
    })
    return master, cost, cost_all, base_meta


def compute(pgy, star_agg, chili_agg, juguang_agg, lx=None,
            chili_daily=None, juguang_daily=None, star_daily=None):
    master = build_master(pgy, star_agg, chili_agg, juguang_agg, lx)
    master, cost, cost_all, cost_meta = build_cost_data(
        chili_daily, juguang_daily, star_daily, master
    )
    master, waterlines = add_waterlines(master)

    # ===== 全部笔记汇总日趋势（搜索框清空时默认展示） =====
    trends_all = []
    if star_daily is not None and len(star_daily):
        sd = star_daily.copy()
        sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
        if "read_uv" not in sd.columns:
            sd["read_uv"] = 0
        g = sd.groupby("date", as_index=False).agg({
            "visit_uv": "sum", "cart_uv": "sum", "deal_uv": "sum",
            "gmv": "sum", "read_uv": "sum"
        }).sort_values("date")
        for _, r in g.iterrows():
            # [date, visit_uv, cart_uv, deal_uv, gmv, read_uv]
            trends_all.append([
                int(r["date"]) if pd.notna(r["date"]) else None,
                _f(r.get("visit_uv")), _f(r.get("cart_uv")),
                _f(r.get("deal_uv")), _f(r.get("gmv")), _f(r.get("read_uv"))
            ])

    # ===== 每日笔记明细（日维度进店趋势图表用） =====
    daily_notes = {}
    if star_daily is not None and len(star_daily):
        sd = star_daily.copy()
        sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
        # join creator from master
        cm = master[["creator"]].reset_index()
        sd = pd.merge(sd, cm, on="note_id", how="left")
        for date_val, g in sd.groupby("date"):
            if pd.isna(date_val):
                continue
            notes_list = []
            for _, r in g.iterrows():
                c = r.get("creator")
                notes_list.append({
                    "note_id": str(r["note_id"]),
                    "creator": str(c) if pd.notna(c) and c else "",
                    "visit_uv": _f(r.get("visit_uv")),
                    "cart_uv": _f(r.get("cart_uv")),
                    "deal_uv": _f(r.get("deal_uv")),
                    "read_uv": _f(r.get("read_uv")),
                })
            notes_list.sort(key=lambda x: -(x["visit_uv"] or 0))
            daily_notes[int(date_val)] = notes_list

    total_spend = float(cost_meta.get("full_spend", master["spend"].sum()))
    total_gmv = float(master.loc[master["in_star"], "gmv"].sum())
    cost_summary = (cost_all or {}).get("summary", {})
    matched_spend = float(cost_summary.get("spend", 0) or 0)
    matched_gmv = float(cost_summary.get("gmv", 0) or 0)
    summary = {
        "note_count": int(len(master)),
        "total_spend": total_spend,
        "total_chili_spend": float(cost_meta.get("full_chili_spend", 0) or 0),
        "total_juguang_spend": float(cost_meta.get("full_juguang_spend", 0) or 0),
        "total_gmv": total_gmv,
        "overall_roi": (matched_gmv / matched_spend) if matched_spend else None,
        "matched_note_count": int(cost_meta.get("matched_note_count", 0) or 0),
        "matched_spend": matched_spend,
        "matched_gmv": matched_gmv,
        "waiting_attribution_spend": float(cost_meta.get("waiting_spend", 0) or 0),
        "waiting_chili_spend": float(cost_meta.get("waiting_chili_spend", 0) or 0),
        "waiting_juguang_spend": float(cost_meta.get("waiting_juguang_spend", 0) or 0),
        "unmatched_paid_spend": float(cost_meta.get("unmatched_spend", 0) or 0),
        "unmatched_paid_count": int(cost_meta.get("unmatched_note_count", 0) or 0),
        "chili_note_count": int(cost_meta.get("chili_note_count", 0) or 0),
        "juguang_note_count": int(cost_meta.get("juguang_note_count", 0) or 0),
        "both_note_count": int(cost_meta.get("both_note_count", 0) or 0),
        "paid_note_count": int(cost_meta.get("paid_note_count", 0) or 0),
        "star_cost_cutoff": cost_meta.get("star_cutoff"),
        "funnel_violation_count": int((master.loc[master["in_star"], "deal_uv"] > master.loc[master["in_star"], "cart_uv"]).sum()),
        "invested_count": int(master["is_invested"].sum()),
    }
    return master, waterlines, summary, cost, trends_all, cost_all, daily_notes
