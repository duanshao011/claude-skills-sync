# -*- coding: utf-8 -*-
"""小红书全链路投放分析看板 · 主编排。

读取多平台数据表 → 清洗 → 合并 → 派生指标 → 相对水位线
→ 窗口对齐校验 → 注入前端 → 输出单个自包含 HTML。

用法：
  python build_dashboard.py --pugongying 蒲公英.xlsx --star 星河.xlsx
                            --chili 薯条.xlsx --lingxi 灵犀.xlsx
                            [--start 20260501 --end 20260531]
                            [--output-dir 目录] [--prefix 前缀]

默认输出固定文件名 `全链路投放看板.html`（覆盖同名）；
仅当需要归档时才传 --prefix 保留历史版本。
四张表任意缺失都可运行，缺表的字段前端会标注"需上传XX表"。
"""
import argparse
import os
import re
import sys
import unicodedata
from datetime import datetime

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

from loaders import (
    load_pugongying, load_star, load_chili, load_lingxi,
    load_juguang, load_bilibili, load_bilibili_ads, load_bilibili_fire,
)
from metrics import compute
from render import build_payload, render_html

DESK = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据"
DEFAULT_SCAN_DIR = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件"
# 约定：不传路径的表 = 不加载 = 前端标注"需上传XX表"。
# 默认全空，只加载调用时明确传入的表（每次由博哥发路径决定哪几张表进来）。
DEF_PGY = ""
DEF_STAR = ""
DEF_CHILI = ""
DEF_LX = ""


def scan_data_dir(root):
    """递归扫描目录树，按文件名关键字自动识别各平台数据表。
    返回 dict：{pgy, star(list), chili, juguang(list), lx, bili(list), bili_ads, bili_fire, douyin}
    - 平台优先按 01-小红书/02-抖音/03-B站 子目录判定
    - 小红书五表：蒲公英/星河/薯条/聚光/灵犀
    - B站：目录内星河可多张，必火/三联各取最新一份
    - 抖音：文件名含"抖音"（取最新一份，预留）
    根目录及其他位置继续按文件名关键字兼容识别。
    """
    if not os.path.isdir(root):
        return {}
    result = {"pgy": None, "star": [], "chili": None, "juguang": [], "lx": None,
              "bili": [], "bili_ads": None, "bili_fire": None, "douyin": None}
    candidates = {"pgy": [], "star": [], "chili": [], "juguang": [], "lx": [],
                  "bili": [], "bili_ads": [], "bili_fire": [], "douyin": []}
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not name.lower().endswith((".xlsx", ".xls", ".csv")):
                continue
            if name.startswith("~"):  # Excel 打开中的临时文件
                continue
            full = os.path.join(dirpath, name)
            mtime = os.path.getmtime(full)
            rel_parts = os.path.relpath(dirpath, root).split(os.sep)
            root_name = os.path.basename(os.path.normpath(root))
            in_xhs_dir = root_name == "01-小红书" or "01-小红书" in rel_parts
            in_bili_dir = root_name == "03-B站" or "03-B站" in rel_parts
            in_douyin_dir = root_name == "02-抖音" or "02-抖音" in rel_parts

            if in_bili_dir:
                if "必火" in name:
                    candidates["bili_fire"].append((mtime, full))
                elif "三联" in name:
                    candidates["bili_ads"].append((mtime, full))
                elif "星河" in name or "小红星" in name:
                    candidates["bili"].append((mtime, full))
                continue
            if in_douyin_dir:
                if "抖音" in name:
                    candidates["douyin"].append((mtime, full))
                continue

            # 01-小红书、根目录及其他历史位置沿用原关键字规则。
            if "蒲公英" in name:
                candidates["pgy"].append((mtime, full))
            elif "聚光" in name:
                candidates["juguang"].append((mtime, full))
            elif "B站" in name:
                # 须在"星河"之前判断：B站表导出自星河后台，文件名常为"星河B站"，含双关键字时必须归B站
                candidates["bili"].append((mtime, full))
            elif "星河" in name or "小红星" in name:
                # 排除二次加工的分日趋势/汇总宽表，只允许标准星河明细进入数据链路。
                if any(tag in name for tag in ("分日趋势", "分日汇总", "趋势", "汇总")):
                    continue
                candidates["star"].append((mtime, full))
            elif "薯条" in name:
                candidates["chili"].append((mtime, full))
            elif "灵犀" in name:
                candidates["lx"].append((mtime, full))
            elif "抖音" in name:
                candidates["douyin"].append((mtime, full))
    # 蒲公英/薯条/小红书星河/B站星河全部保留；灵犀/抖音取最新一份。
    if candidates["pgy"]:
        result["pgy"] = [p for _, p in sorted(candidates["pgy"])]
    if candidates["chili"]:
        result["chili"] = [p for _, p in sorted(candidates["chili"])]
    if candidates["juguang"]:
        result["juguang"] = [
            p for _, p in sorted(candidates["juguang"], key=lambda item: os.path.basename(item[1]))
        ]
    if candidates["lx"]:
        result["lx"] = max(candidates["lx"])[1]
    if candidates["bili"]:
        result["bili"] = [
            p for _, p in sorted(candidates["bili"], key=lambda item: os.path.basename(item[1]))
        ]
    if candidates["bili_ads"]:
        result["bili_ads"] = max(candidates["bili_ads"])[1]
    if candidates["bili_fire"]:
        result["bili_fire"] = max(candidates["bili_fire"])[1]
    if candidates["douyin"]:
        result["douyin"] = max(candidates["douyin"])[1]
    # 星河多张排序：文件名含"旧"排最前，含"新"排最后（新版口径优先，重叠日期以新版为准）
    def _star_sort_key(item):
        _, path = item
        name = os.path.basename(path)
        if "旧" in name: return (0, name)
        if "新" in name: return (2, name)
        return (1, name)
    result["star"] = [p for _, p in sorted(candidates["star"], key=_star_sort_key)]
    return result


def _md(yyyymmdd):
    s = str(yyyymmdd)
    return f"{int(s[4:6])}/{int(s[6:8])}" if len(s) == 8 else s


def _period_str(lo, hi):
    """把 (20260602, 20260702) 格式化成 '6/2–7/2'；缺则空串。"""
    if not lo or not hi:
        return ""
    return f"{_md(lo)}–{_md(hi)}"


def _months(lo, hi):
    out = set()
    if lo is None or hi is None:
        return out
    y, m = int(str(lo)[:4]), int(str(lo)[4:6])
    yh, mh = int(str(hi)[:4]), int(str(hi)[4:6])
    while (y, m) <= (yh, mh):
        out.add((y, m))
        m += 1
        if m > 12:
            m = 1; y += 1
    return out


def check_alignment(smeta, cmeta):
    s_lo, s_hi = smeta.get("date_min"), smeta.get("date_max")
    c_lo, c_hi = cmeta.get("launch_min"), cmeta.get("launch_max")
    period = []
    if s_lo:
        period.append(f"星河 {_md(s_lo)}–{_md(s_hi)}")
    if c_lo:
        period.append(f"薯条 {_md(c_lo)}–{_md(c_hi)}")
    period = " · ".join(period) if period else "—"

    if not (s_lo and c_lo):
        return True, "", period
    overlap = _months(s_lo, s_hi) & _months(c_lo, c_hi)
    if overlap:
        return True, "", period
    msg = f"星河({_md(s_lo)}–{_md(s_hi)})与薯条({_md(c_lo)}–{_md(c_hi)})月份不重叠，整体ROI可能虚高"
    return False, msg, period


def _try(fn, path, label):
    """安全加载：文件不存在或加载失败，返回 None + 状态。"""
    paths = list(path) if isinstance(path, (list, tuple)) else [path]
    paths = [p for p in paths if p]
    display_path = " · ".join(paths)
    if not paths or not all(os.path.exists(p) for p in paths):
        return None, {"loaded": False, "reason": "文件未提供或不存在", "path": display_path}
    try:
        result = fn(path)
        return result, {"loaded": True, "path": display_path}
    except Exception as e:
        return None, {"loaded": False, "reason": f"加载失败：{e}", "path": display_path}


def _f(v):
    """NaN/None → None；numpy 数值 → 原生 Python 数值（保证 JSON 可序列化）。"""
    if v is None or pd.isna(v):
        return None
    if hasattr(v, "item"):  # numpy.int64 / numpy.float64
        v = v.item()
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v


def _cost_div(spend, uv):
    spend = float(spend or 0)
    uv = float(uv or 0)
    return (spend / uv) if uv > 0 else None


def _date_sequence(lo, hi):
    if not lo or not hi or int(lo) > int(hi):
        return []
    start = pd.to_datetime(str(int(lo)), format="%Y%m%d")
    end = pd.to_datetime(str(int(hi)), format="%Y%m%d")
    return [int(v.strftime("%Y%m%d")) for v in pd.date_range(start, end, freq="D")]


def compute_bilibili(df, ads=None, fire=None):
    """构建 B站趋势、日维度明细及必火+三联双渠道成本数据。

    趋势行：[date, visit_uv, cart_uv, deal_uv, gmv, play_uv]
    成本汇总行：[date, spend, visit_uv, cart_uv, deal_uv, play_uv, cum_visit_cost, paid_count]
    成本单篇行：[date, spend, visit_uv, cart_uv, deal_uv, gmv, play_uv, cum_visit_cost]
    """
    notes = []
    for nid, g in df.groupby("note_id"):
        g = g.sort_values("date")
        row = g.iloc[-1]  # 取最新一行拿达人/链接等元信息
        notes.append({
            "note_id": str(nid),
            "creator": str(row.get("creator", "") or ""),
            "url": str(row.get("url", "") or ""),
            "play_uv": _f(g["play_uv"].sum()) if "play_uv" in g else None,
            "visit_uv": _f(g["visit_uv"].sum()) if "visit_uv" in g else None,
            "cart_uv": _f(g["cart_uv"].sum()) if "cart_uv" in g else None,
            "deal_uv": _f(g["deal_uv"].sum()) if "deal_uv" in g else None,
            "gmv": _f(g["gmv"].sum()) if "gmv" in g else None,
            "new_visit_uv": _f(g["new_visit_uv"].sum()) if "new_visit_uv" in g else None,
            "first_date": int(g["date"].min()),
        })
    notes.sort(key=lambda n: n["first_date"], reverse=True)

    trends = {}
    for nid, g in df.groupby("note_id"):
        g = g.sort_values("date")
        trends[str(nid)] = [
            [int(r["date"]),
             _f(r.get("visit_uv")), _f(r.get("cart_uv")),
             _f(r.get("deal_uv")), _f(r.get("gmv")),
             _f(r.get("play_uv"))]
            for _, r in g.iterrows()
        ]

    trends_all = []
    g = df.groupby("date", as_index=False).agg({
        "play_uv": "sum", "visit_uv": "sum", "cart_uv": "sum",
        "deal_uv": "sum", "gmv": "sum",
    }).sort_values("date")
    for _, r in g.iterrows():
        trends_all.append([
            int(r["date"]),
            _f(r.get("visit_uv")), _f(r.get("cart_uv")),
            _f(r.get("deal_uv")), _f(r.get("gmv")), _f(r.get("play_uv")),
        ])

    creator_map = {n["note_id"]: n.get("creator", "") for n in notes}
    daily_notes = {}
    for date_val, dg in df.groupby("date"):
        items = []
        for _, r in dg.iterrows():
            nid = str(r["note_id"])
            items.append({
                "note_id": nid,
                "creator": creator_map.get(nid, ""),
                "play_uv": _f(r.get("play_uv")),
                "visit_uv": _f(r.get("visit_uv")),
                "cart_uv": _f(r.get("cart_uv")),
                "deal_uv": _f(r.get("deal_uv")),
            })
        items.sort(key=lambda x: -(x["visit_uv"] or 0))
        daily_notes[int(date_val)] = items

    result = {
        "notes": notes,
        "trends": trends,
        "trends_all": trends_all,
        "daily_notes": daily_notes,
        "cost": {},
        "cost_all": None,
        "cost_meta": {},
        "quality": {
            "funnel_violation_count": int(
                ((pd.to_numeric(df.get("deal_uv"), errors="coerce").fillna(0)
                  > pd.to_numeric(df.get("cart_uv"), errors="coerce").fillna(0))).sum()
            ),
        },
    }
    if ads is None and fire is None:
        return result

    def normalize_creator(value):
        text = unicodedata.normalize("NFKC", str(value or "")).casefold()
        return re.sub(r"\s+", "", text)

    star = df.copy()
    star["note_id"] = star["note_id"].astype(str)
    star["date"] = pd.to_numeric(star["date"], errors="coerce").astype("Int64")
    creator_ids = {}
    for nid, group in star.groupby("note_id"):
        creator = str(group.iloc[-1].get("creator", "") or "")
        creator_ids.setdefault(normalize_creator(creator), set()).add(str(nid))

    events = []
    trilan_source_spend = 0.0
    source_dates = []
    invalid_trilan_spend = float(ads.attrs.get("invalid_id_spend", 0)) if ads is not None else 0.0
    if ads is not None and len(ads):
        trilan = ads.copy()
        trilan["note_id"] = trilan["note_id"].astype(str)
        trilan["date"] = pd.to_numeric(trilan["date"], errors="coerce").astype("Int64")
        trilan["trilan_spend"] = pd.to_numeric(trilan["spend"], errors="coerce").fillna(0.0)
        trilan_source_spend = float(trilan["trilan_spend"].sum())
        source_dates.extend([int(trilan["date"].min()), int(trilan["date"].max())])
        keep = ["note_id", "date", "trilan_spend"]
        for field in ["impression", "click", "title"]:
            if field in trilan:
                keep.append(field)
        events.append(trilan[keep])

    bihuo_source_spend = 0.0
    unmatched_bihuo_spend = ambiguous_bihuo_spend = 0.0
    unmatched_bihuo_creators = []
    ambiguous_bihuo_creators = []
    if fire is not None and len(fire):
        fd = fire.copy()
        bihuo_source_spend = float(fd["bihuo_spend"].sum())
        source_dates.extend([int(fd["date"].min()), int(fd["date"].max())])
        fd["creator_key"] = fd["creator"].map(normalize_creator)
        fd["matched_ids"] = fd["creator_key"].map(lambda key: sorted(creator_ids.get(key, set())))
        fd["match_count"] = fd["matched_ids"].map(len)
        unmatched = fd[fd["match_count"] == 0]
        ambiguous = fd[fd["match_count"] > 1]
        unmatched_bihuo_spend = float(unmatched["bihuo_spend"].sum())
        ambiguous_bihuo_spend = float(ambiguous["bihuo_spend"].sum())
        unmatched_bihuo_creators = sorted(set(unmatched["creator"].astype(str)))
        ambiguous_bihuo_creators = sorted(set(ambiguous["creator"].astype(str)))
        matched_fire = fd[fd["match_count"] == 1].copy()
        matched_fire["note_id"] = matched_fire["matched_ids"].map(lambda ids: ids[0])
        keep = ["note_id", "date", "bihuo_spend"]
        for field in ["bihuo_orders", "bihuo_title", "bihuo_play", "bihuo_blue_click"]:
            if field in matched_fire:
                keep.append(field)
        if len(matched_fire):
            events.append(matched_fire[keep])

    if not events:
        result["cost_meta"] = {
            "source_period": _period_str(min(source_dates), max(source_dates)) if source_dates else "",
            "source_spend": _f(trilan_source_spend + bihuo_source_spend),
            "source_trilan_spend": _f(trilan_source_spend),
            "source_bihuo_spend": _f(bihuo_source_spend),
            "unmatched_bihuo_spend": _f(unmatched_bihuo_spend),
            "ambiguous_bihuo_spend": _f(ambiguous_bihuo_spend),
            "unmatched_bihuo_creators": unmatched_bihuo_creators,
            "ambiguous_bihuo_creators": ambiguous_bihuo_creators,
            "matched_note_count": 0,
        }
        return result
    paid = events[0]
    for part in events[1:]:
        paid = pd.merge(paid, part, on=["note_id", "date"], how="outer")
    for field in ["trilan_spend", "bihuo_spend", "impression", "click",
                  "bihuo_orders", "bihuo_play", "bihuo_blue_click"]:
        if field not in paid:
            paid[field] = 0.0
        paid[field] = pd.to_numeric(paid[field], errors="coerce").fillna(0.0)
    paid["date"] = pd.to_numeric(paid["date"], errors="coerce").astype(int)
    paid["spend"] = paid["bihuo_spend"] + paid["trilan_spend"]
    paid = paid[paid["spend"] > 0].copy()

    star_max = int(star["date"].max())
    source_min, source_max = int(paid["date"].min()), int(paid["date"].max())
    waiting = paid[paid["date"] > star_max]
    effective_paid = paid[paid["date"] <= star_max].copy()
    first_paid = effective_paid.groupby("note_id")["date"].min().astype(int)
    star_ids = set(star["note_id"])
    unmatched_trilan_spend = float(
        effective_paid.loc[~effective_paid["note_id"].isin(star_ids), "trilan_spend"].sum()
    )
    paid_ids = set(first_paid.index) & star_ids
    effective_paid = effective_paid[effective_paid["note_id"].isin(paid_ids)]
    effective_start = int(first_paid.loc[list(paid_ids)].min()) if paid_ids else source_min
    effective_star = star[star["note_id"].isin(paid_ids) & (star["date"] <= star_max)].copy()
    effective_star["first_paid"] = effective_star["note_id"].map(first_paid)
    effective_star = effective_star[effective_star["date"] >= effective_star["first_paid"]]

    trilan_ids = set(paid.loc[paid["trilan_spend"] > 0, "note_id"])
    bihuo_ids = set(paid.loc[paid["bihuo_spend"] > 0, "note_id"])
    result["cost_meta"] = {
        "source_period": _period_str(source_min, source_max),
        "effective_period": _period_str(effective_start, star_max),
        "effective_start": effective_start, "effective_end": star_max,
        "source_spend": _f(trilan_source_spend + bihuo_source_spend),
        "source_trilan_spend": _f(trilan_source_spend),
        "source_bihuo_spend": _f(bihuo_source_spend),
        "effective_spend": _f(effective_paid["spend"].sum()),
        "effective_trilan_spend": _f(effective_paid["trilan_spend"].sum()),
        "effective_bihuo_spend": _f(effective_paid["bihuo_spend"].sum()),
        "excluded_after_cutoff_spend": _f(waiting["spend"].sum()),
        "waiting_trilan_spend": _f(waiting["trilan_spend"].sum()),
        "waiting_bihuo_spend": _f(waiting["bihuo_spend"].sum()),
        "invalid_id_spend": _f(invalid_trilan_spend),
        "unmatched_trilan_spend": _f(unmatched_trilan_spend),
        "unmatched_spend": _f(unmatched_trilan_spend),
        "unmatched_bihuo_spend": _f(unmatched_bihuo_spend),
        "ambiguous_bihuo_spend": _f(ambiguous_bihuo_spend),
        "unmatched_bihuo_creators": unmatched_bihuo_creators,
        "ambiguous_bihuo_creators": ambiguous_bihuo_creators,
        "trilan_note_count": len(trilan_ids), "bihuo_note_count": len(bihuo_ids),
        "both_note_count": len(trilan_ids & bihuo_ids),
        "paid_note_count": len(trilan_ids | bihuo_ids),
        "matched_note_count": len(paid_ids),
        "cutoff_reason": "双渠道成本统一截止B站星河最新日期",
        "sample_rule": "每条视频从必火或三联首个付费日开始；必火整单归到推广开始日",
    }
    if not paid_ids:
        return result

    numeric = ["play_uv", "visit_uv", "cart_uv", "deal_uv", "gmv"]
    star_daily = effective_star.groupby(["note_id", "date"], as_index=False)[numeric].sum()
    dates = _date_sequence(effective_start, star_max)
    cost = {}
    for nid in sorted(paid_ids):
        note_paid = effective_paid[effective_paid["note_id"] == nid]
        note_star = star_daily[star_daily["note_id"] == nid]
        note_start = int(first_paid.loc[nid])
        paid_map = {int(row["date"]): row for _, row in note_paid.iterrows()}
        star_map = {int(row["date"]): row for _, row in note_star.iterrows()}
        rows = []
        cum_spend = cum_visit = 0.0
        for date in _date_sequence(note_start, star_max):
            er = paid_map.get(date)
            sr = star_map.get(date)
            bihuo_spend = float(er.get("bihuo_spend", 0)) if er is not None else 0.0
            trilan_spend = float(er.get("trilan_spend", 0)) if er is not None else 0.0
            spend = bihuo_spend + trilan_spend
            visit = float(sr.get("visit_uv", 0)) if sr is not None else 0.0
            cum_spend += spend
            cum_visit += visit
            rows.append([
                date, _f(spend), _f(visit),
                _f(sr.get("cart_uv", 0)) if sr is not None else 0.0,
                _f(sr.get("deal_uv", 0)) if sr is not None else 0.0,
                _f(sr.get("gmv", 0)) if sr is not None else 0.0,
                _f(sr.get("play_uv", 0)) if sr is not None else 0.0,
                _f(_cost_div(cum_spend, cum_visit)), _f(bihuo_spend), _f(trilan_spend),
            ])
        spend = float(note_paid["spend"].sum())
        bihuo_spend = float(note_paid["bihuo_spend"].sum())
        trilan_spend = float(note_paid["trilan_spend"].sum())
        play = float(note_star["play_uv"].sum())
        visit = float(note_star["visit_uv"].sum())
        cart = float(note_star["cart_uv"].sum())
        deal = float(note_star["deal_uv"].sum())
        gmv = float(note_star["gmv"].sum())
        cost[nid] = {
            "summary": {
                "spend": _f(spend), "bihuo_spend": _f(bihuo_spend),
                "trilan_spend": _f(trilan_spend), "gmv": _f(gmv),
                "roi": _f(_cost_div(gmv, spend)), "uv_cost": _f(_cost_div(spend, play)),
                "visit_uv_cost": _f(_cost_div(spend, visit)),
                "cart_cost": _f(_cost_div(spend, cart)), "deal_cost": _f(_cost_div(spend, deal)),
                "days": int(note_paid["date"].nunique()),
                "bihuo_days": int(note_paid.loc[note_paid["bihuo_spend"] > 0, "date"].nunique()),
                "trilan_days": int(note_paid.loc[note_paid["trilan_spend"] > 0, "date"].nunique()),
                "creator": creator_map.get(nid, ""),
            },
            "daily": rows,
        }
    result["cost"] = cost

    spend_date = effective_paid.groupby("date")[["spend", "bihuo_spend", "trilan_spend"]].sum()
    count_date = effective_paid.groupby("date")["note_id"].nunique()
    star_date = star_daily.groupby("date")[numeric].sum()
    daily_all = []
    cum_spend = cum_visit = 0.0
    for date in dates:
        er = spend_date.loc[date] if date in spend_date.index else None
        sr = star_date.loc[date] if date in star_date.index else None
        bihuo_spend = float(er.get("bihuo_spend", 0)) if er is not None else 0.0
        trilan_spend = float(er.get("trilan_spend", 0)) if er is not None else 0.0
        spend = bihuo_spend + trilan_spend
        visit = float(sr.get("visit_uv", 0)) if sr is not None else 0.0
        cum_spend += spend
        cum_visit += visit
        daily_all.append([
            date, _f(spend), _f(visit),
            _f(sr.get("cart_uv", 0)) if sr is not None else 0.0,
            _f(sr.get("deal_uv", 0)) if sr is not None else 0.0,
            _f(sr.get("play_uv", 0)) if sr is not None else 0.0,
            _f(_cost_div(cum_spend, cum_visit)), int(count_date.get(date, 0)),
            _f(bihuo_spend), _f(trilan_spend),
        ])

    cost_daily_notes = {}
    for date, group in effective_paid.groupby("date"):
        items = []
        for _, row in group.iterrows():
            nid = str(row["note_id"])
            items.append({
                "note_id": nid, "creator": creator_map.get(nid, ""),
                "spend": _f(row.get("spend")),
                "bihuo_spend": _f(row.get("bihuo_spend")),
                "trilan_spend": _f(row.get("trilan_spend")),
                "impression": _f(row.get("impression")), "click": _f(row.get("click")),
                "bihuo_orders": _f(row.get("bihuo_orders")),
            })
        items.sort(key=lambda item: -(item["spend"] or 0))
        cost_daily_notes[int(date)] = items

    total_spend = float(effective_paid["spend"].sum())
    total_bihuo = float(effective_paid["bihuo_spend"].sum())
    total_trilan = float(effective_paid["trilan_spend"].sum())
    total_gmv = float(effective_star["gmv"].sum())
    result["cost_all"] = {
        "summary": {
            "spend": _f(total_spend), "bihuo_spend": _f(total_bihuo),
            "trilan_spend": _f(total_trilan), "gmv": _f(total_gmv),
            "roi": _f(_cost_div(total_gmv, total_spend)),
            "visit_uv": _f(effective_star["visit_uv"].sum()),
            "cart_uv": _f(effective_star["cart_uv"].sum()),
            "deal_uv": _f(effective_star["deal_uv"].sum()),
            "play_uv": _f(effective_star["play_uv"].sum()),
            "note_count": len(paid_ids), "days": int(effective_paid["date"].nunique()),
            "bihuo_days": int(effective_paid.loc[effective_paid["bihuo_spend"] > 0, "date"].nunique()),
            "trilan_days": int(effective_paid.loc[effective_paid["trilan_spend"] > 0, "date"].nunique()),
        },
        "daily": daily_all, "daily_notes": cost_daily_notes,
    }
    for note in result["notes"]:
        nid = note["note_id"]
        note["bihuo_spend"] = _f(paid.loc[paid["note_id"] == nid, "bihuo_spend"].sum())
        note["trilan_spend"] = _f(paid.loc[paid["note_id"] == nid, "trilan_spend"].sum())
        note["spend"] = _f((note["bihuo_spend"] or 0) + (note["trilan_spend"] or 0))
        note["in_bihuo"] = bool((note["bihuo_spend"] or 0) > 0)
        note["in_trilan"] = bool((note["trilan_spend"] or 0) > 0)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pugongying", nargs="+", default=[])
    ap.add_argument("--star", nargs="+", default=[])
    ap.add_argument("--chili", nargs="+", default=[])
    ap.add_argument("--juguang", nargs="+", default=[])
    ap.add_argument("--lingxi", default=DEF_LX)
    ap.add_argument("--bilibili", nargs="+", default=[])
    ap.add_argument("--bilibili-ads", default="")
    ap.add_argument("--bilibili-fire", default="")
    ap.add_argument("--douyin", default="")
    ap.add_argument("--scan-dir", default=None,
                    help="扫描目录自动识别各平台表（默认 " + DEFAULT_SCAN_DIR + "）")
    ap.add_argument("--no-scan", action="store_true", help="禁用自动扫描（只用显式传的路径）")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--output-dir", default=None)
    ap.add_argument("--prefix", default=None)
    args = ap.parse_args()

    # 自动扫描：显式 --scan-dir 或默认目录（除非 --no-scan 或已传所有路径）
    scan_dir = args.scan_dir
    if not scan_dir and not args.no_scan:
        # 只在博哥没显式传路径时才自动用默认扫描目录
        if not (args.pugongying or args.star or args.chili or args.juguang or args.lingxi or
                args.bilibili or args.bilibili_ads or args.bilibili_fire or args.douyin):
            scan_dir = DEFAULT_SCAN_DIR
    if scan_dir and os.path.isdir(scan_dir):
        scanned = scan_data_dir(scan_dir)
        print(f"自动扫描目录: {scan_dir}")
        if scanned.get("pgy") and not args.pugongying:
            args.pugongying = scanned["pgy"]
            for p in args.pugongying:
                print(f"  蒲公英 → {os.path.basename(p)}")
        if scanned.get("star") and not args.star:
            args.star = scanned["star"]
            for p in args.star:
                print(f"  星河 → {os.path.basename(p)}")
        if scanned.get("chili") and not args.chili:
            args.chili = scanned["chili"]
            for p in args.chili:
                print(f"  薯条 → {os.path.basename(p)}")
        if scanned.get("juguang") and not args.juguang:
            args.juguang = scanned["juguang"]
            for p in args.juguang:
                print(f"  聚光 → {os.path.basename(p)}")
        if scanned.get("lx") and not args.lingxi:
            args.lingxi = scanned["lx"]
            print(f"  灵犀 → {os.path.basename(args.lingxi)}")
        if scanned.get("bili") and not args.bilibili:
            args.bilibili = scanned["bili"]
            for p in args.bilibili:
                print(f"  B站星河 → {os.path.basename(p)}")
        if scanned.get("bili_ads") and not args.bilibili_ads:
            args.bilibili_ads = scanned["bili_ads"]
            print(f"  B站三联 → {os.path.basename(args.bilibili_ads)}")
        if scanned.get("bili_fire") and not args.bilibili_fire:
            args.bilibili_fire = scanned["bili_fire"]
            print(f"  B站必火 → {os.path.basename(args.bilibili_fire)}")
        if scanned.get("douyin") and not args.douyin:
            args.douyin = scanned["douyin"]
            print(f"  抖音 → {os.path.basename(args.douyin)}")
        # 输出目录也默认为扫描目录（除非博哥显式指定）
        if args.output_dir is None:
            args.output_dir = scan_dir
    if args.output_dir is None:
        args.output_dir = DESK

    print("读取各平台数据表 ...")

    source_status = {}

    pgy_paths = [p for p in (args.pugongying or []) if p and os.path.exists(p)]
    if pgy_paths:
        try:
            parts = []
            for p in pgy_paths:
                df = load_pugongying(p, start=args.start, end=args.end)
                if df is not None and len(df):
                    if df.index.name == "note_id":
                        df = df.reset_index()
                    parts.append(df)
            if parts:
                pgy = pd.concat(parts, ignore_index=True)
                if "note_id" in pgy.columns:
                    pgy = pgy.drop_duplicates(subset=["note_id"], keep="last")
                    pgy = pgy.set_index("note_id")
            else:
                pgy = None
            source_status["pgy"] = {"loaded": pgy is not None, "path": " · ".join(pgy_paths)}
        except Exception as e:
            pgy = None
            source_status["pgy"] = {"loaded": False, "path": " · ".join(pgy_paths), "reason": f"加载失败：{e}"}
    else:
        pgy = None
        source_status["pgy"] = {"loaded": False, "path": "", "reason": "文件未提供或不存在"}
    source_status["pgy"]["name"] = "蒲公英"
    source_status["pgy"]["rows"] = int(len(pgy)) if pgy is not None else 0

    # 星河支持多张：过滤存在的路径；全都不存在则视为未上传
    star_paths = [p for p in (args.star or []) if p and os.path.exists(p)]
    if star_paths:
        try:
            star_agg, daily, smeta = load_star(star_paths)
            source_status["star"] = {
                "loaded": True, "path": " · ".join(star_paths), "rows": int(len(star_agg)),
                "name": "淘宝星河",
            }
        except Exception as e:
            star_agg, daily, smeta = None, None, {}
            source_status["star"] = {
                "loaded": False, "path": " · ".join(star_paths), "rows": 0,
                "reason": f"加载失败：{e}", "name": "淘宝星河",
            }
    else:
        star_agg, daily, smeta = None, None, {}
        source_status["star"] = {
            "loaded": False, "path": "", "rows": 0,
            "reason": "文件未提供或不存在", "name": "淘宝星河",
        }

    chili_paths = [p for p in (args.chili or []) if p and os.path.exists(p)]
    if chili_paths:
        try:
            # 多份明细必须在订单粒度先去重，再按笔记汇总；不能分别汇总后直接相加。
            chili_agg, chili_daily, cmeta = load_chili(chili_paths)
            source_status["chili"] = {
                "loaded": chili_agg is not None,
                "path": " · ".join(chili_paths),
                "dedup_rows": int((cmeta or {}).get("dedup_rows", 0)),
            }
        except Exception as e:
            chili_agg, chili_daily, cmeta = None, None, {}
            source_status["chili"] = {"loaded": False, "path": " · ".join(chili_paths), "reason": f"加载失败：{e}"}
    else:
        chili_agg, chili_daily, cmeta = None, None, {}
        source_status["chili"] = {"loaded": False, "path": "", "reason": "文件未提供或不存在"}
    source_status["chili"]["name"] = "薯条"
    if chili_agg is not None and "note_id" in chili_agg.columns:
        chili_agg["note_id"] = chili_agg["note_id"].astype(str)
    source_status["chili"]["rows"] = int(len(chili_agg)) if chili_agg is not None else 0

    juguang_paths = [p for p in (args.juguang or []) if p and os.path.exists(p)]
    if juguang_paths:
        try:
            juguang_agg, juguang_daily, jmeta = load_juguang(juguang_paths)
            source_status["juguang"] = {
                "loaded": True,
                "path": " · ".join(juguang_paths),
                "rows": int((jmeta or {}).get("source_rows", len(juguang_daily))),
                "valid_rows": int(len(juguang_daily)),
                "summary_rows": int((jmeta or {}).get("summary_rows", 0)),
                "summary_diff": (jmeta or {}).get("summary_diff"),
                "invalid_rows": int((jmeta or {}).get("invalid_rows", 0)),
                "invalid_spend": (jmeta or {}).get("invalid_spend", 0),
                "name": "聚光",
            }
        except Exception as e:
            juguang_agg, juguang_daily, jmeta = None, None, {}
            source_status["juguang"] = {
                "loaded": False, "path": " · ".join(juguang_paths), "rows": 0,
                "reason": f"加载失败：{e}", "name": "聚光",
            }
    else:
        juguang_agg, juguang_daily, jmeta = None, None, {}
        source_status["juguang"] = {
            "loaded": False, "path": "", "rows": 0,
            "reason": "文件未提供或不存在", "name": "聚光",
        }

    lx, source_status["lx"] = _try(load_lingxi, args.lingxi, "灵犀")
    source_status["lx"]["name"] = "灵犀"
    source_status["lx"]["rows"] = int(len(lx)) if lx is not None else 0
    # 灵犀命中数：在五表并集主体下，已加载的灵犀记录都会进入主表。
    source_status["lx"]["hit"] = int(len(lx)) if lx is not None else 0

    # ===== B站（独立于小红书五表，进入独立模块） =====
    bili, source_status["bili"] = _try(load_bilibili, args.bilibili or [], "B站")
    source_status["bili"]["name"] = "B站星河"
    source_status["bili"]["rows"] = int(len(bili)) if bili is not None else 0
    if bili is not None and len(bili):
        b_lo, b_hi = int(bili["date"].min()), int(bili["date"].max())
        source_status["bili"]["period"] = _period_str(b_lo, b_hi)
    else:
        source_status["bili"]["period"] = ""

    bili_ads, source_status["bili_ads"] = _try(
        load_bilibili_ads, args.bilibili_ads or "", "B站三联"
    )
    source_status["bili_ads"]["name"] = "B站三联"
    source_status["bili_ads"]["rows"] = (
        int(bili_ads.attrs.get("source_rows", len(bili_ads))) if bili_ads is not None else 0
    )
    source_status["bili_ads"]["valid_rows"] = int(len(bili_ads)) if bili_ads is not None else 0
    source_status["bili_ads"]["invalid_id_rows"] = (
        int(bili_ads.attrs.get("invalid_id_rows", 0)) if bili_ads is not None else 0
    )
    source_status["bili_ads"]["invalid_id_spend"] = (
        float(bili_ads.attrs.get("invalid_id_spend", 0)) if bili_ads is not None else 0
    )
    if bili_ads is not None and len(bili_ads):
        ba_lo, ba_hi = int(bili_ads["date"].min()), int(bili_ads["date"].max())
        source_status["bili_ads"]["period"] = _period_str(ba_lo, ba_hi)
    else:
        source_status["bili_ads"]["period"] = ""

    bili_fire, source_status["bili_fire"] = _try(
        load_bilibili_fire, args.bilibili_fire or "", "B站必火"
    )
    source_status["bili_fire"]["name"] = "B站必火"
    source_status["bili_fire"]["rows"] = (
        int(bili_fire.attrs.get("source_rows", len(bili_fire))) if bili_fire is not None else 0
    )
    source_status["bili_fire"]["valid_rows"] = int(len(bili_fire)) if bili_fire is not None else 0
    source_status["bili_fire"]["completed_orders"] = (
        int(bili_fire.attrs.get("completed_orders", 0)) if bili_fire is not None else 0
    )
    if bili_fire is not None and len(bili_fire):
        bf_lo, bf_hi = int(bili_fire["date"].min()), int(bili_fire["date"].max())
        source_status["bili_fire"]["period"] = _period_str(bf_lo, bf_hi)
    else:
        source_status["bili_fire"]["period"] = ""

    # ===== 每张表的日期范围（用于状态卡展示） =====
    def _dt_period(series):
        s = pd.to_datetime(series, errors="coerce").dropna()
        if not len(s):
            return ""
        lo, hi = s.min(), s.max()
        return f"{lo.month}/{lo.day}–{hi.month}/{hi.day}"

    if pgy is not None and "pub_date" in pgy:
        source_status["pgy"]["period"] = _dt_period(pgy["pub_date"])
    else:
        source_status["pgy"]["period"] = ""
    source_status["star"]["period"] = _period_str((smeta or {}).get("date_min"), (smeta or {}).get("date_max"))
    source_status["chili"]["period"] = _period_str((cmeta or {}).get("launch_min"), (cmeta or {}).get("launch_max"))
    source_status["juguang"]["period"] = _period_str((jmeta or {}).get("date_min"), (jmeta or {}).get("date_max"))
    if lx is not None and "pub_time" in lx:
        source_status["lx"]["period"] = _dt_period(lx["pub_time"])
    else:
        source_status["lx"]["period"] = ""

    for k in ["pgy", "star", "chili", "juguang", "lx", "bili", "bili_fire", "bili_ads"]:
        s = source_status[k]
        badge = "✓" if s["loaded"] else "✗"
        p = f" · {s.get('period')}" if s.get("period") else ""
        print(f"  {badge} {s['name']} {s['rows']} 条{p}{'' if s['loaded'] else '（' + s.get('reason', '') + '）'}")

    master, waterlines, summary, cost, trends_all, cost_all, daily_notes = compute(
        pgy, star_agg, chili_agg, juguang_agg, lx,
        chili_daily=chili_daily, juguang_daily=juguang_daily, star_daily=daily)

    align_ok, align_msg, period = check_alignment(smeta or {}, cmeta or {})

    latest_gap_days = None
    star_latest = (smeta or {}).get("date_max")
    chili_latest = (cmeta or {}).get("launch_max")
    juguang_latest = (jmeta or {}).get("date_max")
    cost_latest = max([v for v in [chili_latest, juguang_latest] if v], default=None)
    if star_latest and cost_latest:
        latest_gap_days = (
            pd.to_datetime(str(cost_latest), format="%Y%m%d")
            - pd.to_datetime(str(star_latest), format="%Y%m%d")
        ).days

    meta = {
        "period": period,
        "flow_type": (smeta or {}).get("flow_type", "全部流量"),
        "attr_period": (smeta or {}).get("attr_period", 30),
        "align_ok": align_ok,
        "align_msg": align_msg,
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "sources": source_status,
        # KPI 卡片专用时间范围：薯条=投放周期(启动时间)，星河=数据日期周期
        "chili_period": _period_str((cmeta or {}).get("launch_min"), (cmeta or {}).get("launch_max")),
        "juguang_period": _period_str((jmeta or {}).get("date_min"), (jmeta or {}).get("date_max")),
        "star_period": _period_str((smeta or {}).get("date_min"), (smeta or {}).get("date_max")),
        "latest_data_gap_days": latest_gap_days,
    }

    payload = build_payload(master, waterlines, summary, daily, meta, cost=cost,
                            trends_all=trends_all, cost_all=cost_all,
                            daily_notes=daily_notes)

    # ===== B站 模块数据（无表则为 None，前端显示占位） =====
    if bili is not None and len(bili):
        b_data = compute_bilibili(bili, bili_ads, bili_fire)
        b_cost_meta = b_data.get("cost_meta", {})
        source_status["bili_ads"].update({
            "effective_period": b_cost_meta.get("effective_period", ""),
            "effective_spend": b_cost_meta.get("effective_spend"),
            "excluded_after_cutoff_spend": b_cost_meta.get("excluded_after_cutoff_spend"),
            "matched_note_count": b_cost_meta.get("matched_note_count", 0),
        })
        source_status["bili_fire"].update({
            "matched_note_count": b_cost_meta.get("bihuo_note_count", 0),
            "unmatched_spend": b_cost_meta.get("unmatched_bihuo_spend", 0),
            "ambiguous_spend": b_cost_meta.get("ambiguous_bihuo_spend", 0),
        })
        payload["bilibili"] = {
            "notes": b_data["notes"],
            "trends": b_data["trends"],
            "trends_all": b_data["trends_all"],
            "daily_notes": b_data["daily_notes"],
            "cost": b_data["cost"],
            "cost_all": b_data["cost_all"],
            "meta": {
                "period": source_status["bili"].get("period", ""),
                "flow_type": "全部流量",
                "attr_period": 15,
                "note_count": len(b_data["notes"]),
                **b_data.get("quality", {}),
                **b_cost_meta,
            },
        }
    else:
        payload["bilibili"] = None
    html = render_html(payload)

    # 默认固定文件名（覆盖同名），传 --prefix 才带前缀归档
    fname = f"{args.prefix}_全链路投放看板.html" if args.prefix else "全链路投放看板.html"
    out = os.path.join(args.output_dir, fname)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    top = master.sort_values("roi", ascending=False).head(1)
    print("\n" + "=" * 52)
    print("看板已生成:", out)
    print(f"数据周期: {period} | 口径: {meta['flow_type']}/{meta['attr_period']}天")
    print("窗口对齐:", "✓ 已对齐" if align_ok else f"⚠ {align_msg}" if align_msg else "—")
    print(f"全量投入(薯条+聚光) {summary['total_spend']:.2f} | 薯条 {summary['total_chili_spend']:.2f} | 聚光 {summary['total_juguang_spend']:.2f}")
    print(f"星河截止 {summary.get('star_cost_cutoff') or '—'} | 等待归因 {summary['waiting_attribution_spend']:.2f} | 未命中星河 {summary['unmatched_paid_spend']:.2f}")
    print(f"投放笔记: 薯条 {summary['chili_note_count']} · 聚光 {summary['juguang_note_count']} · 双投 {summary['both_note_count']} · 并集 {summary['paid_note_count']} · 同样本 {summary['matched_note_count']}")
    print(f"有效成本 {summary['matched_spend']:.2f} | 同样本GMV {summary['matched_gmv']:.2f} | 总GMV {summary['total_gmv']:.2f} | 整体ROI "
          + (f"{summary['overall_roi']:.2f}" if summary['overall_roi'] else "—"))
    if len(top):
        t = top.iloc[0]
        title_str = str(t.get('title', ''))[:20] if 'title' in t.index else ''
        roi_str = f"{t['roi']:.1f}" if pd.notna(t.get('roi')) else '—'
        print(f"全场最高ROI: {t.get('creator', '—')} · {title_str} (ROI {roi_str})")
    bili_payload = payload.get("bilibili") or {}
    bili_meta = bili_payload.get("meta") or {}
    bili_summary = ((bili_payload.get("cost_all") or {}).get("summary") or {})
    if bili_payload:
        print("-" * 52)
        print(f"B站全量投入 {float(bili_meta.get('source_spend') or 0):.2f} | 必火 {float(bili_meta.get('source_bihuo_spend') or 0):.2f} | 三联 {float(bili_meta.get('source_trilan_spend') or 0):.2f}")
        print(f"B站有效成本 {float(bili_summary.get('spend') or 0):.2f} | GMV {float(bili_summary.get('gmv') or 0):.2f} | ROI "
              + (f"{float(bili_summary.get('roi')):.2f}" if bili_summary.get("roi") is not None else "—"))
        print(f"B站视频: 必火 {bili_meta.get('bihuo_note_count', 0)} · 三联 {bili_meta.get('trilan_note_count', 0)} · 双投 {bili_meta.get('both_note_count', 0)} · 并集 {bili_meta.get('paid_note_count', 0)}")
        print(f"B站昵称匹配: 未命中 {len(bili_meta.get('unmatched_bihuo_creators') or [])} · 一对多 {len(bili_meta.get('ambiguous_bihuo_creators') or [])} · 等待归因 {float(bili_meta.get('excluded_after_cutoff_spend') or 0):.2f}")
    print("=" * 52)
    return out


if __name__ == "__main__":
    main()
