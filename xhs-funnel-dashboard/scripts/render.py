# -*- coding: utf-8 -*-
"""构建前端 payload，并把 css/js/echarts/payload 内联成单个自包含 HTML。

payload 结构:
  meta: 数据周期/口径/对齐状态/数据源加载状态
  summary: 全局KPI（总投入/GMV/ROI/笔记数）
  waterlines: 每个指标的 P25/P75 分档线（前端着色用）
  notes: 每篇笔记的全字段记录（含 tier 标签）
  trends: 每篇笔记的每日转化时序（模块一趋势用）
  cost: 图表二·单篇成本分析（每篇summary+daily）
  column_groups: 表格所有可选列的元数据（分组/字段名/单位/口径解释/是否派生）—— 悬停卡片和自定义列弹窗用

字段口径都写在 columns 里，前端直接展示，不用改代码。
"""
import json
import math
import os

import numpy as np
import pandas as pd

from metrics import SCORE_FIELDS

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


COLUMN_GROUPS = [
    {
        "key": "base",
        "label": "基础信息",
        "columns": [
            {"key": "note_id",    "label": "笔记ID",     "unit": "",   "type": "id",
             "formula": "小红书笔记唯一 ID", "meaning": "四表关联的主键", "source": "四表"},
            {"key": "creator",    "label": "达人昵称",   "unit": "",   "type": "text",
             "formula": "优先取蒲公英博主昵称", "meaning": "笔记作者", "source": "蒲公英/灵犀"},
            {"key": "pub_date",   "label": "笔记发布日期", "unit": "",   "type": "date",
             "formula": "取蒲公英笔记发布日期", "meaning": "笔记创作时间", "source": "蒲公英"},
            {"key": "note_type",  "label": "笔记类型",   "unit": "",   "type": "text",
             "formula": "取蒲公英笔记类型", "meaning": "图文/视频", "source": "蒲公英"},
            {"key": "content_tag", "label": "内容标签",  "unit": "",   "type": "text",
             "formula": "取蒲公英内容标签", "meaning": "笔记的内容分类标签", "source": "蒲公英"},
        ],
    },
    {
        "key": "pgy",
        "label": "蒲公英（前端内容）",
        "columns": [
            {"key": "read_uv_content", "label": "阅读UV", "unit": "", "type": "int",
             "formula": "蒲公英原表『阅读UV』", "meaning": "去重后的阅读用户数", "source": "蒲公英"},
            {"key": "content_ctr", "label": "点击率", "unit": "%", "type": "ratio",
             "formula": "蒲公英『阅读量 / 曝光量』",
             "meaning": "看到笔记后点开的比例，反映封面/标题吸引力", "source": "蒲公英"},
            {"key": "avg_view_time", "label": "平均浏览时长", "unit": "s", "type": "num",
             "formula": "蒲公英原表『平均浏览时长』", "meaning": "内容留人能力", "source": "蒲公英"},
            {"key": "body_cta_click", "label": "正文组件点击量", "unit": "", "type": "int",
             "formula": "蒲公英原表『正文组件点击量』", "meaning": "正文内挂件被点击次数", "source": "蒲公英"},
            {"key": "comment_cta_click", "label": "评论区组件点击量", "unit": "", "type": "int",
             "formula": "蒲公英原表『评论区组件点击量』", "meaning": "评论区挂件被点击次数", "source": "蒲公英"},
            {"key": "footer_cta_click", "label": "底栏组件点击量", "unit": "", "type": "int",
             "formula": "蒲公英原表『笔记底栏组件点击量』", "meaning": "笔记底栏挂件被点击次数", "source": "蒲公英"},
            {"key": "component_click_total", "label": "组件点击总量", "unit": "", "type": "int",
             "formula": "正文 + 评论区 + 底栏 三处组件点击量之和",
             "meaning": "笔记全部挂件吸引力总和", "source": "系统计算"},
            {"key": "play_5s", "label": "5s播放率", "unit": "%", "type": "ratio",
             "formula": "蒲公英原表『5s播放率』", "meaning": "视频前5秒完成播放的比例", "source": "蒲公英"},
            {"key": "finish_rate", "label": "完播率", "unit": "%", "type": "ratio",
             "formula": "蒲公英原表『视频完播率』", "meaning": "视频看到底的比例", "source": "蒲公英"},
            {"key": "interact_rate", "label": "互动率", "unit": "%", "type": "ratio",
             "formula": "蒲公英原表『互动率』", "meaning": "互动量/阅读量", "source": "蒲公英"},
            {"key": "body_cta_ctr", "label": "正文组件CTR", "unit": "%", "type": "ratio",
             "formula": "蒲公英原表『正文组件CTR』", "meaning": "正文组件点击率", "source": "蒲公英"},
            {"key": "comment_cta_ctr", "label": "评论区组件CTR", "unit": "%", "type": "ratio",
             "formula": "蒲公英原表『评论区组件CTR』", "meaning": "评论区组件点击率", "source": "蒲公英"},
            {"key": "natural_ratio", "label": "自然流量占比", "unit": "%", "type": "ratio",
             "formula": "自然阅读量 / (自然阅读量 + 推广阅读量)",
             "meaning": "内容自然吸引力占比", "source": "系统计算"},
            {"key": "fans", "label": "粉丝量", "unit": "", "type": "int",
             "formula": "蒲公英原表『博主粉丝量』", "meaning": "达人粉丝规模", "source": "蒲公英"},
            {"key": "total_amount", "label": "达人合作费", "unit": "元", "type": "num",
             "formula": "蒲公英原表『总金额』", "meaning": "签达人的合作费（本次口径未算入投放金额）", "source": "蒲公英"},
        ],
    },
    {
        "key": "star",
        "label": "淘宝星河（后端转化）",
        "columns": [
            {"key": "read_uv_funnel", "label": "阅读UV", "unit": "", "type": "int",
             "formula": "星河『阅读/播放UV』，全部流量+归因30天口径，按笔记ID聚合",
             "meaning": "星河后端归因视角的阅读用户数（与蒲公英口径不同）", "source": "星河"},
            {"key": "cart_uv", "label": "加购UV", "unit": "", "type": "int",
             "formula": "星河『商品加购UV』", "meaning": "加购去重用户数", "source": "星河"},
            {"key": "deal_uv", "label": "成交UV", "unit": "", "type": "int",
             "formula": "星河『成交UV』", "meaning": "成交去重用户数", "source": "星河"},
            {"key": "gmv", "label": "商家GMV", "unit": "元", "type": "num",
             "formula": "星河『商家GMV』", "meaning": "该笔记带来的成交金额", "source": "星河"},
            {"key": "uv_value", "label": "UV价值", "unit": "元", "type": "num",
             "formula": "商家GMV / 进店UV",
             "meaning": "每个进店用户平均带来的成交金额，越高说明进店质量越好", "source": "系统计算"},
            {"key": "uv_cost", "label": "UV成本", "unit": "", "type": "num",
             "formula": "薯条累计投放金额 / 累计商家GMV",
             "meaning": "每 1 元 GMV 对应多少投放（营销费率，越低越好；等同于 1/ROI）", "source": "系统计算", "needs": ["薯条"]},
            {"key": "visit_uv", "label": "进店UV", "unit": "", "type": "int",
             "formula": "星河原表『进店UV』，全部流量+归因30天口径，按笔记ID聚合",
             "meaning": "看笔记后进店的去重用户数", "source": "星河"},
            {"key": "visit_rate", "label": "进店率", "unit": "%", "type": "ratio",
             "formula": "进店UV / 阅读播放UV", "meaning": "读者进店的比例", "source": "系统计算"},
            {"key": "cart_rate", "label": "进店加购率", "unit": "%", "type": "ratio",
             "formula": "加购UV / 进店UV", "meaning": "进店后加购的比例", "source": "系统计算"},
            {"key": "deal_rate", "label": "进店转化率", "unit": "%", "type": "ratio",
             "formula": "成交UV / 进店UV", "meaning": "进店后成交的比例", "source": "系统计算"},
        ],
    },
    {
        "key": "chili",
        "label": "薯条投放（成本统计）",
        "columns": [
            {"key": "spend", "label": "累计金额", "unit": "元", "type": "num",
             "formula": "薯条『实际支付金额』，仅订单状态=推广完成，按笔记ID聚合",
             "meaning": "该笔记的实际付费投放金额（不含达人合作费/退款/优惠抵扣）", "source": "薯条"},
            {"key": "chili_days", "label": "累计投放天数", "unit": "天", "type": "int",
             "formula": "薯条不同启动日期去重计数", "meaning": "实际有投放的天数（非自然天数）", "source": "薯条"},
            {"key": "roi", "label": "ROI", "unit": "", "type": "num",
             "formula": "商家GMV / 累计金额", "meaning": "每花 1 元付费投放带来的成交金额", "source": "系统计算", "needs": ["薯条"]},
            {"key": "visit_uv_cost", "label": "进店UV成本", "unit": "元", "type": "num",
             "formula": "累计金额 / 进店UV", "meaning": "拉动一个进店用户的付费成本，越低越好", "source": "系统计算", "needs": ["薯条"]},
            {"key": "cart_cost", "label": "加购成本", "unit": "元", "type": "num",
             "formula": "累计金额 / 加购UV", "meaning": "拉动一个加购用户的付费成本，越低越好", "source": "系统计算", "needs": ["薯条"]},
            {"key": "deal_cost", "label": "成交成本", "unit": "元", "type": "num",
             "formula": "累计金额 / 成交UV", "meaning": "拉动一单成交的付费成本，越低越好", "source": "系统计算", "needs": ["薯条"]},
            {"key": "read_uv_cost", "label": "阅读UV成本", "unit": "元", "type": "num",
             "formula": "累计金额 / 蒲公英阅读UV", "meaning": "拉动一个阅读用户的付费成本，越低越好", "source": "系统计算", "needs": ["薯条"]},
            {"key": "component_cost", "label": "组件点击成本", "unit": "元", "type": "num",
             "formula": "累计金额 / 组件点击总量", "meaning": "拉动一次组件点击的付费成本，越低越好", "source": "系统计算", "needs": ["薯条"]},
        ],
    },
    {
        "key": "lx",
        "label": "灵犀（人群资产）",
        "columns": [
            {"key": "ti_users", "label": "TI人群数", "unit": "", "type": "int",
             "formula": "灵犀原表『TI人群数』",
             "meaning": "看到笔记后进入兴趣层(Interest)+种草层(Truth)的用户去重数", "source": "灵犀"},
            {"key": "iti_users", "label": "I+TI人群数", "unit": "", "type": "int",
             "formula": "灵犀原表『I+TI人群数』",
             "meaning": "触达 Impression + 兴趣/种草层的用户去重数（更大范围）", "source": "灵犀"},
            {"key": "visit_users", "label": "进店用户数", "unit": "", "type": "int",
             "formula": "灵犀原表『进店用户数』",
             "meaning": "看笔记后进店的用户数（灵犀口径）", "source": "灵犀"},
            {"key": "ti_visit_ratio", "label": "TI人群进店兑换比", "unit": "", "type": "num",
             "formula": "灵犀原表『TI人群进店兑换比』",
             "meaning": "多少个 TI 人群才兑换出 1 个进店用户，数值越低种草效率越高", "source": "灵犀"},
            {"key": "iti_visit_ratio", "label": "I+TI人群进店兑换比", "unit": "", "type": "num",
             "formula": "灵犀原表『I+TI人群进店兑换比』",
             "meaning": "多少个 I+TI 人群才兑换出 1 个进店用户，数值越低越好", "source": "灵犀"},
        ],
    },
]


# 全链路数据表的默认展示列（按博哥要求）
DEFAULT_COLUMNS = [
    # 基础信息
    "note_id", "creator", "pub_date",
    # 蒲公英（前端内容）
    "read_uv_content", "content_ctr", "avg_view_time",
    "body_cta_click", "comment_cta_click", "component_click_total",
    # 淘宝星河（后端转化）—— 阅读UV/加购UV/成交UV/商家GMV/UV价值/UV成本
    "read_uv_funnel", "cart_uv", "deal_uv", "gmv", "uv_value", "uv_cost",
    # 薯条投放（成本统计）—— 累计金额/累计投放天数/ROI
    "spend", "chili_days", "roi",
    # 灵犀（人群资产）
    "ti_visit_ratio",
]


NOTE_FIELDS = [
    "note_id", "creator", "title", "note_type", "fans", "fans_tier", "content_tag",
    "pub_date",
    "in_pgy", "in_star", "in_chili", "in_lx",
    "spend", "total_amount", "gmv", "roi", "uv_value", "uv_cost",
    "read_uv_content", "read_uv_funnel", "content_ctr",
    "pgy_exposure", "pgy_read",
    "body_cta_click", "footer_cta_click", "comment_cta_click", "component_click_total",
    "component_cost", "read_uv_cost", "visit_uv_cost", "cart_cost", "deal_cost",
    "chili_max_daily", "chili_days",
    "visit_uv", "cart_uv", "deal_uv",
    "play_5s", "read_3s", "avg_view_time", "finish_rate", "interact_rate",
    "body_cta_ctr", "comment_cta_ctr", "footer_cta_ctr", "natural_ratio",
    "visit_rate", "cart_rate", "deal_rate", "new_visit_ratio", "search_visit_ratio",
    "ti_users", "iti_users", "visit_users", "ti_visit_ratio", "iti_visit_ratio",
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
    if isinstance(v, pd.Timestamp):
        if pd.isna(v):
            return None
        return v.strftime("%Y-%m-%d")
    try:
        if pd.isna(v):
            return None
    except (ValueError, TypeError):
        pass
    return v


def build_payload(master, waterlines, summary, daily, meta, cost=None,
                  trends_all=None, cost_all=None):
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
        "cost": cost or {},
        "trends_all": trends_all or [],
        "cost_all": cost_all or None,
        "column_groups": COLUMN_GROUPS,
        "default_columns": DEFAULT_COLUMNS,
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
