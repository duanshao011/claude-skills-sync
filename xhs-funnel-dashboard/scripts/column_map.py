# -*- coding: utf-8 -*-
"""三表列名容错映射。

把"导出批次列号/列名可能漂移"的问题收敛到这一个文件。
每个标准字段(英文键) 定义 (列名候选[], 兜底列号 或 None)。
解析优先级：精确列名 → 模糊包含 → 兜底列号。
关键字段缺失由 loaders 负责报错，这里只负责解析。
"""

# ---- 蒲公英（前端内容 + 达人合作成本），header=2 读取 ----
PGY_SCHEMA = {
    "note_id":        (["笔记id", "笔记ID", "内容ID"], 10),
    "creator":        (["博主昵称", "达人昵称"], 1),
    "fans":           (["博主粉丝量", "粉丝量"], 3),
    "title":          (["笔记标题", "标题"], 5),
    "note_type":      (["笔记类型"], 7),
    "pub_date":       (["笔记发布日期", "发布日期"], 8),
    "content_tag":    (["内容标签"], 11),
    "quote_price":    (["博主报价"], 16),
    "service_fee":    (["服务费金额"], 17),
    "total_amount":   (["总金额"], 112),
    "read_uv":        (["阅读UV"], 22),
    "play_5s":        (["5s播放率"], 23),
    "read_3s":        (["3s阅读率"], 24),
    "avg_view_time":  (["平均浏览时长"], 26),
    "finish_rate":    (["视频完播率"], 27),
    "interact_rate":  (["互动率"], 29),
    "natural_read":   (["自然阅读量"], 36),
    "promo_read":     (["推广阅读量"], 38),
    "body_cta_ctr":   (["正文组件CTR"], 60),
    "comment_cta_ctr": (["评论区组件CTR"], 77),
}

# ---- 星河（后端转化），utf-8-sig CSV ----
STAR_SCHEMA = {
    "note_id":        (["内容ID", "笔记ID", "笔记id"], None),
    "creator":        (["达人昵称", "博主昵称"], None),
    "date":           (["日期"], None),
    "flow_type":      (["流量类型"], None),
    "attr_period":    (["归因周期"], None),
    "read_uv":        (["阅读/播放UV", "阅读UV"], None),
    "visit_uv":       (["进店UV"], None),
    "new_visit_uv":   (["新客进店uv", "新客进店UV"], None),
    "search_visit_uv": (["搜索进店UV"], None),
    "cart_uv":        (["商品加购UV", "加购UV"], None),
    "deal_uv":        (["成交UV"], None),
    "gmv":            (["商家GMV", "全店成交GMV(元)"], None),
}

# ---- 薯条（付费投放消耗），xlsx ----
CHILI_SCHEMA = {
    "note_id":     (["笔记ID", "笔记id", "内容ID"], None),
    "creator":     (["被推广者", "达人昵称"], None),
    "spend":       (["实际消耗（元）", "实际消耗(元)", "实际消耗"], None),
    "budget":      (["推广总预算（元）", "推广总预算(元)", "推广总预算"], None),
    "status":      (["订单状态"], None),
    "launch_time": (["启动时间"], None),
    "impression":  (["曝光量"], None),
    "read":        (["阅读量"], None),
}

# 关键字段：缺了就无法构建看板，loaders 必须报错
REQUIRED = {
    "pgy":   ["note_id", "total_amount"],
    "star":  ["note_id", "visit_uv", "gmv"],
    "chili": ["note_id", "spend"],
}


def resolve(columns, schema):
    """返回 {标准字段: 真实列名}；命中不了的字段不放入结果。

    columns: df.columns（可迭代）
    schema:  上面的 *_SCHEMA
    """
    cols = list(columns)
    cols_str = [str(c) for c in cols]
    mapping = {}
    for std, (cands, _fallback) in schema.items():
        hit = None
        # 1) 精确匹配
        for cand in cands:
            if cand in cols_str:
                hit = cols[cols_str.index(cand)]
                break
        # 2) 模糊包含（去空格后子串）
        if hit is None:
            for cand in cands:
                key = cand.replace(" ", "")
                for i, c in enumerate(cols_str):
                    if key and key in c.replace(" ", ""):
                        hit = cols[i]
                        break
                if hit is not None:
                    break
        if hit is not None:
            mapping[std] = hit
    return mapping


def resolve_by_position(df, schema, mapping):
    """对仍未命中的字段，尝试用兜底列号（仅当 df 列数足够）。就地补充 mapping。"""
    ncol = df.shape[1]
    for std, (_cands, fallback) in schema.items():
        if std in mapping:
            continue
        if fallback is not None and fallback < ncol:
            mapping[std] = df.columns[fallback]
    return mapping
