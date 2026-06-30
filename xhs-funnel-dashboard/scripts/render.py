# -*- coding: utf-8 -*-
"""构建前端 payload，并把 css/js/echarts/payload 内联成单个自包含 HTML。"""
import json
import math
import os

import numpy as np
import pandas as pd

from metrics import SCORE_FIELDS

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

# notes 导出的标量字段
NOTE_FIELDS = [
    "note_id", "creator", "title", "note_type", "fans", "fans_tier", "content_tag",
    "quadrant", "conv_score", "is_invested",
    "spend", "total_amount", "total_cost", "gmv", "roi",
    "read_uv_content", "read_uv_funnel", "visit_uv", "cart_uv", "deal_uv",
    "play_5s", "read_3s", "avg_view_time", "finish_rate", "interact_rate",
    "body_cta_ctr", "comment_cta_ctr", "natural_ratio",
    "visit_rate", "cart_rate", "deal_rate", "new_visit_ratio", "search_visit_ratio",
    "visit_cost", "deal_cost", "read_price",
]


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        v = float(v)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    try:
        if pd.isna(v):
            return None
    except (ValueError, TypeError):
        pass
    return v


def build_payload(master, waterlines, summary, daily, meta):
    df = master.reset_index()
    notes = []
    for _, row in df.iterrows():
        rec = {k: _clean(row.get(k)) for k in NOTE_FIELDS if k in row or k == "note_id"}
        tiers = {}
        for f in SCORE_FIELDS:
            tc = f + "_tier"
            if tc in row:
                tiers[f] = row[tc]
        rec["tiers"] = tiers
        notes.append(rec)

    trends = {}
    if daily is not None and len(daily):
        keep = set(master.index)
        d = daily[daily["note_id"].isin(keep)]
        for nid, g in d.groupby("note_id"):
            g = g.sort_values("date")
            trends[str(nid)] = [
                [int(r["date"]) if pd.notna(r["date"]) else None,
                 _clean(r.get("visit_uv")), _clean(r.get("cart_uv")),
                 _clean(r.get("deal_uv")), _clean(r.get("gmv"))]
                for _, r in g.iterrows()
            ]

    return {
        "meta": meta,
        "summary": {k: _clean(v) if not isinstance(v, dict) else v for k, v in summary.items()},
        "waterlines": waterlines,
        "notes": notes,
        "trends": trends,
        "insights": meta.pop("_insights", {}),
    }


def safe_json(obj):
    s = json.dumps(obj, ensure_ascii=False, allow_nan=False)
    return s.replace("</", "<\\/").replace(" ", "\\u2028").replace(" ", "\\u2029")


def render_html(payload):
    with open(os.path.join(ASSETS, "template.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(ASSETS, "dashboard.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(ASSETS, "dashboard.js"), encoding="utf-8") as f:
        js = f.read()
    with open(os.path.join(ASSETS, "echarts.min.js"), encoding="utf-8") as f:
        echarts = f.read()

    html = html.replace("/*__CSS__*/", css)
    html = html.replace("/*__ECHARTS__*/", echarts)
    html = html.replace("/*__JS__*/", js)
    html = html.replace("__PAYLOAD__", safe_json(payload))
    return html
