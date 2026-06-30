# -*- coding: utf-8 -*-
"""复用洞察：从高ROI笔记自动提取共性，输出可执行结论（不是数字罗列）。

逻辑：
1. 成功集 = 有成交(gmv>0) 且 ROI 进入有效集前 25%
2. 对比"成功集 vs 有效全体"在 内容形式/达人层级/内容标签/流量结构 的占比
   用 lift = 成功占比 / 全体占比 量化"超配"，lift 越高 = 这个特征越是高ROI的共性
3. 达人维度额外算 ROI 稳定性（同达人多篇变异系数），给"高ROI且稳定"名单
"""
import numpy as np
import pandas as pd


def _split_tags(val):
    if pd.isna(val):
        return []
    s = str(val)
    for sep in ["，", ",", "、", ";", "；", "/", "|"]:
        s = s.replace(sep, " ")
    return [t.strip() for t in s.split() if t.strip()]


def _share(series):
    """分类列的占比分布 {value: share}。"""
    vc = series.value_counts(dropna=True)
    total = vc.sum()
    return {k: v / total for k, v in vc.items()} if total else {}


def _tag_share(series):
    """多值标签列的占比（按笔记计，一篇多标签都计一次）。"""
    counts = {}
    n = 0
    for v in series:
        tags = _split_tags(v)
        if tags:
            n += 1
        for t in tags:
            counts[t] = counts.get(t, 0) + 1
    return {k: v / n for k, v in counts.items()} if n else {}


def _lift_items(success_share, overall_share, min_success_share=0.15, min_lift=1.15):
    items = []
    for val, ss in success_share.items():
        os_ = overall_share.get(val, 0)
        lift = (ss / os_) if os_ > 0 else None
        items.append({
            "value": val,
            "success_share": round(ss, 3),
            "overall_share": round(os_, 3),
            "lift": round(lift, 2) if lift else None,
        })
    items.sort(key=lambda x: (x["lift"] or 0, x["success_share"]), reverse=True)
    highlights = [it for it in items
                  if it["lift"] and it["lift"] >= min_lift and it["success_share"] >= min_success_share]
    return items, highlights


def compute_insights(master):
    valid = master[master["gmv"] > 0].copy()
    out = {"dimensions": [], "conclusions": [], "stable_creators": [], "success_count": 0}
    if len(valid) < 4:
        out["note"] = "有成交的笔记过少，洞察样本不足（需窗口对齐的同期数据）"
        return out

    thresh = float(valid["roi"].quantile(0.75))
    success = valid[valid["roi"] >= thresh].copy()
    out["success_count"] = int(len(success))
    out["roi_threshold"] = round(thresh, 2)

    # 流量结构：自然占比分桶
    def nat_bucket(x):
        if pd.isna(x):
            return None
        return "自然流量主导(≥60%)" if x >= 0.6 else ("均衡(30-60%)" if x >= 0.3 else "付费主导(<30%)")
    for df in (valid, success):
        df["nat_bucket"] = df["natural_ratio"].map(nat_bucket)

    dim_defs = [
        ("内容形式", "note_type", "single", "优先做{v}"),
        ("达人层级", "fans_tier", "single", "追投优先选「{v}」达人"),
        ("流量结构", "nat_bucket", "single", "优先追投「{v}」的笔记"),
        ("内容标签", "content_tag", "multi", "选题复用「{v}」方向"),
    ]
    for name, col, kind, action in dim_defs:
        if col not in master:
            continue
        if kind == "multi":
            ss = _tag_share(success[col])
            os_ = _tag_share(valid[col])
        else:
            ss = _share(success[col])
            os_ = _share(valid[col])
        items, highlights = _lift_items(ss, os_)
        out["dimensions"].append({"name": name, "field": col, "items": items[:8]})
        for hi in highlights[:2]:
            out["conclusions"].append({
                "dim": name,
                "text": f"高ROI笔记中「{hi['value']}」占{round(hi['success_share']*100)}%"
                        f"（全体{round(hi['overall_share']*100)}%，{hi['lift']}×超配）",
                "action": action.format(v=hi["value"]),
                "lift": hi["lift"],
            })

    out["conclusions"].sort(key=lambda c: c["lift"], reverse=True)

    # 达人稳定性：≥2篇有成交的达人
    g = valid.groupby("creator")["roi"]
    stab = pd.DataFrame({"note_count": g.size(), "roi_median": g.median(), "roi_std": g.std()})
    stab = stab[stab["note_count"] >= 2].copy()
    if len(stab):
        stab["cv"] = (stab["roi_std"] / stab["roi_median"].replace(0, np.nan))
        stab = stab.replace([np.inf, -np.inf], np.nan)
        # 高ROI且稳定：roi_median 高、cv 低
        stab = stab.sort_values(["roi_median", "cv"], ascending=[False, True])
        for cr, row in stab.head(8).iterrows():
            out["stable_creators"].append({
                "creator": cr,
                "note_count": int(row["note_count"]),
                "roi_median": round(float(row["roi_median"]), 2),
                "cv": None if pd.isna(row["cv"]) else round(float(row["cv"]), 2),
            })
    return out
