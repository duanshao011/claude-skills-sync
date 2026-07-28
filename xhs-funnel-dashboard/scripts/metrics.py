# -*- coding: utf-8 -*-
"""四表合并 + 派生指标 + 相对水位线。

主体笔记 = 蒲公英 ∪ 星河 ∪ 薯条 ∪ 灵犀 的 note_id 并集。
博哥上传哪几张表，就展示这些表覆盖到的全部笔记；缺表字段由前端明确标注。

投放金额口径（2026-07-22 更新）：
  投放金额 = 薯条实际支付金额（仅推广完成；不含达人合作费）
  ROI = 商家GMV / 投放金额
  阅读UV成本 = 投放金额 / 星河阅读/播放UV
  进店UV成本 = 投放金额 / 星河进店UV
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


def build_master(pgy, star_agg, chili_agg, lx=None):
    """以四张表 note_id 并集构建主表；缺表时对应字段为 NaN。"""
    for frame in (pgy, star_agg, chili_agg, lx):
        if frame is not None:
            frame.index = frame.index.astype(str)
    idx_pgy = set(pgy.index) if pgy is not None else set()
    idx_star = set(star_agg.index) if star_agg is not None else set()
    idx_chili = set(chili_agg.index) if chili_agg is not None else set()
    idx_lx = set(lx.index) if lx is not None else set()
    subject = sorted(idx_pgy | idx_star | idx_chili | idx_lx)
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
    # UV成本 = 投放金额 / 星河阅读UV（拉动一个星河阅读用户的付费成本）
    master["uv_cost"] = safe_div(master["spend"], master["read_uv_funnel"])

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
STAR_CHILI_SCORE_FIELDS = {"roi", "uv_cost", "visit_uv_cost", "cart_cost", "deal_cost"}
LX_SCORE_FIELDS = {
    "ti_users", "iti_users", "visit_users", "ti_visit_ratio", "iti_visit_ratio",
}


def _score_source_mask(master, field):
    """水位线只比较拥有对应来源的笔记，缺来源补0不得参与排名。"""
    if field == "component_cost":
        return master["in_pgy"] & master["in_chili"]
    if field == "read_uv_cost":
        return master["in_pgy"] & master["in_chili"]
    if field in PGY_SCORE_FIELDS:
        return master["in_pgy"]
    if field in STAR_CHILI_SCORE_FIELDS:
        return master["in_star"] & master["in_chili"]
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


def build_cost_daily(chili_daily, star_daily, master):
    """图表二·单篇成本分析数据。只为有薯条消耗的笔记构建。

    每篇产出：
      summary  — 累计消耗/GMV/ROI/阅读UV成本/进店UV成本/加购成本/成交成本/投放天数
      daily    — [启动日, 当日实付, 进店UV, 加购UV, 成交UV, GMV, 阅读UV, 累计进店成本]
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
        dates = _complete_natural_dates(set(cmap) | set(smap))
        daily = []
        for d in dates:
            sr = smap.get(d)
            # [date, spend, visit_uv, cart_uv, deal_uv, gmv, read_uv]
            daily.append([
                d,
                _f(cmap.get(d)),
                _f(sr.get("visit_uv")) if sr is not None else None,
                _f(sr.get("cart_uv")) if sr is not None else None,
                _f(sr.get("deal_uv")) if sr is not None else None,
                _f(sr.get("gmv")) if sr is not None else None,
                _f(sr.get("read_uv")) if sr is not None else None,
            ])

        # ===== 每日追加：累计进店成本（index 7） =====
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
                "uv_cost": _f(row.get("uv_cost")),
                "visit_uv_cost": _f(row.get("visit_uv_cost")),
                "cart_cost": _f(row.get("cart_cost")),
                "deal_cost": _f(row.get("deal_cost")),
                "max_daily": _f(row.get("chili_max_daily")),
                "days": int(row.get("chili_days")) if pd.notna(row.get("chili_days")) else 0,
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

    cost_all = None
    matched_mask = master["in_chili"] & master["in_star"]
    matched_ids = set(master.index[matched_mask].astype(str))
    if chili_daily is not None and len(chili_daily) and matched_ids:
        # 成本效率只允许同样本：薯条与星河均命中的笔记。
        cd = chili_daily.copy()
        cd["note_id"] = cd["note_id"].astype(str)
        cd = cd[cd["note_id"].isin(matched_ids)].copy()
        cd["launch_date"] = pd.to_numeric(cd["launch_date"], errors="coerce").astype("Int64")
        g_spend = cd.groupby("launch_date", as_index=False)["spend"].sum().sort_values("launch_date")
        spend_map = {int(r["launch_date"]): float(r["spend"]) for _, r in g_spend.iterrows()}
        g_cnt = cd.groupby("launch_date")["note_id"].nunique()
        count_map = {int(k): int(v) for k, v in g_cnt.items() if pd.notna(k)}

        visit_map, cart_map, deal_map, read_map = {}, {}, {}, {}
        if star_daily is not None and len(star_daily):
            sd = star_daily.copy()
            sd["note_id"] = sd["note_id"].astype(str)
            sd = sd[sd["note_id"].isin(matched_ids)].copy()
            sd["date"] = pd.to_numeric(sd["date"], errors="coerce").astype("Int64")
            if "read_uv" not in sd.columns:
                sd["read_uv"] = 0
            g_uv = sd.groupby("date", as_index=False).agg({
                "visit_uv": "sum", "cart_uv": "sum", "deal_uv": "sum", "read_uv": "sum"
            })
            for _, r in g_uv.iterrows():
                d = int(r["date"])
                visit_map[d] = float(r["visit_uv"])
                cart_map[d] = float(r["cart_uv"])
                deal_map[d] = float(r["deal_uv"])
                read_map[d] = float(r["read_uv"])

        # 补齐自然日，保证前端“当前点及前2点”严格等于当前日及前2个自然日。
        all_dates = _complete_natural_dates(set(spend_map) | set(visit_map))
        daily_list = []
        for d in all_dates:
            # [date, spend, visit_uv, cart_uv, deal_uv, read_uv]
            daily_list.append([
                d, _f(spend_map.get(d, 0)), _f(visit_map.get(d, 0)),
                _f(cart_map.get(d, 0)), _f(deal_map.get(d, 0)), _f(read_map.get(d, 0)),
            ])
        cum_s, cum_v = 0.0, 0.0
        for row in daily_list:
            cum_s += row[1] or 0.0
            cum_v += row[2] or 0.0
            row.append(_f(cum_s / cum_v) if cum_v > 0 else None)
            row.append(count_map.get(row[0], 0))

        creator_map = {}
        if "creator" in master.columns:
            for nid, row in master.loc[matched_mask].iterrows():
                c = row.get("creator")
                creator_map[str(nid)] = str(c) if pd.notna(c) and c else ""
        cost_daily_notes = {}
        has_imp = "impression" in cd.columns
        has_read = "read" in cd.columns
        for d, g in cd.groupby("launch_date"):
            if pd.isna(d):
                continue
            items = []
            for _, r in g.iterrows():
                nid = str(r["note_id"])
                items.append({
                    "note_id": nid,
                    "creator": creator_map.get(nid, ""),
                    "spend": _f(r.get("spend")),
                    "impression": _f(r.get("impression")) if has_imp else None,
                    "read": _f(r.get("read")) if has_read else None,
                })
            items.sort(key=lambda x: -(x["spend"] or 0))
            cost_daily_notes[int(d)] = items

        matched = master.loc[matched_mask]
        cost_all = {
            "summary": {
                "spend": _f(matched["spend"].sum()),
                "gmv": _f(matched["gmv"].sum()),
                "visit_uv": _f(matched["visit_uv"].sum()),
                "cart_uv": _f(matched["cart_uv"].sum()),
                "deal_uv": _f(matched["deal_uv"].sum()),
                "read_uv": _f(matched["read_uv_funnel"].sum()),
                "note_count": int(matched_mask.sum()),
            },
            "daily": daily_list,
            "daily_notes": cost_daily_notes,
        }

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

    total_spend = float(master.loc[master["in_chili"], "spend"].sum())
    total_gmv = float(master.loc[master["in_star"], "gmv"].sum())
    matched = master.loc[matched_mask]
    matched_spend = float(matched["spend"].sum())
    matched_gmv = float(matched["gmv"].sum())
    summary = {
        "note_count": int(len(master)),
        "total_spend": total_spend,
        "total_gmv": total_gmv,
        "overall_roi": (matched_gmv / matched_spend) if matched_spend else None,
        "matched_note_count": int(matched_mask.sum()),
        "matched_spend": matched_spend,
        "matched_gmv": matched_gmv,
        "funnel_violation_count": int((master.loc[master["in_star"], "deal_uv"] > master.loc[master["in_star"], "cart_uv"]).sum()),
        "invested_count": int(master["is_invested"].sum()),
    }
    return master, waterlines, summary, cost, trends_all, cost_all, daily_notes
