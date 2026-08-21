# -*- coding: utf-8 -*-
"""小红书全链路投放分析看板 · 主编排。

读四表 → 清洗 → 合并 → 派生指标 → 相对水位线
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
import sys
from datetime import datetime

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

from loaders import load_pugongying, load_star, load_chili, load_lingxi, load_bilibili
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
    返回 dict：{pgy, star(list), chili, lx, bili, douyin}
    - 小红书四表：蒲公英/星河/薯条/灵犀（关键字同前，支持子目录）
    - B站：文件名含"B站"（取最新一份）
    - 抖音：文件名含"抖音"（取最新一份，预留）
    同类多份时按修改时间取最新（除星河可多张）。
    """
    if not os.path.isdir(root):
        return {}
    result = {"pgy": None, "star": [], "chili": None, "lx": None, "bili": None, "douyin": None}
    candidates = {"pgy": [], "star": [], "chili": [], "lx": [], "bili": [], "douyin": []}
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not name.lower().endswith((".xlsx", ".xls", ".csv")):
                continue
            if name.startswith("~"):  # Excel 打开中的临时文件
                continue
            full = os.path.join(dirpath, name)
            mtime = os.path.getmtime(full)
            if "蒲公英" in name:
                candidates["pgy"].append((mtime, full))
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
    # 蒲公英/薯条/星河全部保留（多月份合并）；灵犀/B站/抖音取最新一份
    if candidates["pgy"]:
        result["pgy"] = [p for _, p in sorted(candidates["pgy"])]
    if candidates["chili"]:
        result["chili"] = [p for _, p in sorted(candidates["chili"])]
    if candidates["lx"]:
        result["lx"] = max(candidates["lx"])[1]
    if candidates["bili"]:
        result["bili"] = max(candidates["bili"])[1]
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
    if not path or not os.path.exists(path):
        return None, {"loaded": False, "reason": "文件未提供或不存在", "path": path or ""}
    try:
        result = fn(path)
        return result, {"loaded": True, "path": path}
    except Exception as e:
        return None, {"loaded": False, "reason": f"加载失败：{e}", "path": path}


def _f(v):
    """NaN/None → None；numpy 数值 → 原生 Python 数值（保证 JSON 可序列化）。"""
    if v is None or pd.isna(v):
        return None
    if hasattr(v, "item"):  # numpy.int64 / numpy.float64
        v = v.item()
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v


def compute_bilibili(df):
    """B站明细 → 内容档案 + 单篇逐日 + 全量逐日。
    行结构统一为 [date, visit_uv, cart_uv, deal_uv, gmv, play_uv]。
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
    return notes, trends, trends_all


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pugongying", nargs="+", default=[])
    ap.add_argument("--star", nargs="+", default=[])
    ap.add_argument("--chili", nargs="+", default=[])
    ap.add_argument("--lingxi", default=DEF_LX)
    ap.add_argument("--bilibili", default="")
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
        if not (args.pugongying or args.star or args.chili or args.lingxi or args.bilibili or args.douyin):
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
        if scanned.get("lx") and not args.lingxi:
            args.lingxi = scanned["lx"]
            print(f"  灵犀 → {os.path.basename(args.lingxi)}")
        if scanned.get("bili") and not args.bilibili:
            args.bilibili = scanned["bili"]
            print(f"  B站 → {os.path.basename(args.bilibili)}")
        if scanned.get("douyin") and not args.douyin:
            args.douyin = scanned["douyin"]
            print(f"  抖音 → {os.path.basename(args.douyin)}")
        # 输出目录也默认为扫描目录（除非博哥显式指定）
        if args.output_dir is None:
            args.output_dir = scan_dir
    if args.output_dir is None:
        args.output_dir = DESK

    print("读取四表 ...")

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

    lx, source_status["lx"] = _try(load_lingxi, args.lingxi, "灵犀")
    source_status["lx"]["name"] = "灵犀"
    source_status["lx"]["rows"] = int(len(lx)) if lx is not None else 0
    # 灵犀命中数：在四表并集主体下，已加载的灵犀记录都会进入主表。
    source_status["lx"]["hit"] = int(len(lx)) if lx is not None else 0

    # ===== B站（独立于小红书四表：单表全链路，进入独立模块） =====
    bili, source_status["bili"] = _try(load_bilibili, args.bilibili or "", "B站")
    source_status["bili"]["name"] = "B站"
    source_status["bili"]["rows"] = int(len(bili)) if bili is not None else 0
    if bili is not None and len(bili):
        b_lo, b_hi = int(bili["date"].min()), int(bili["date"].max())
        source_status["bili"]["period"] = _period_str(b_lo, b_hi)
    else:
        source_status["bili"]["period"] = ""

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
    if lx is not None and "pub_time" in lx:
        source_status["lx"]["period"] = _dt_period(lx["pub_time"])
    else:
        source_status["lx"]["period"] = ""

    for k in ["pgy", "star", "chili", "lx", "bili"]:
        s = source_status[k]
        badge = "✓" if s["loaded"] else "✗"
        p = f" · {s.get('period')}" if s.get("period") else ""
        print(f"  {badge} {s['name']} {s['rows']} 条{p}{'' if s['loaded'] else '（' + s.get('reason', '') + '）'}")

    master, waterlines, summary, cost, trends_all, cost_all, daily_notes = compute(
        pgy, star_agg, chili_agg, lx,
        chili_daily=chili_daily, star_daily=daily)

    align_ok, align_msg, period = check_alignment(smeta or {}, cmeta or {})

    latest_gap_days = None
    star_latest = (smeta or {}).get("date_max")
    chili_latest = (cmeta or {}).get("launch_max")
    if star_latest and chili_latest:
        latest_gap_days = (
            pd.to_datetime(str(chili_latest), format="%Y%m%d")
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
        "star_period": _period_str((smeta or {}).get("date_min"), (smeta or {}).get("date_max")),
        "latest_data_gap_days": latest_gap_days,
    }

    payload = build_payload(master, waterlines, summary, daily, meta, cost=cost,
                            trends_all=trends_all, cost_all=cost_all,
                            daily_notes=daily_notes)

    # ===== B站 模块数据（无表则为 None，前端显示占位） =====
    if bili is not None and len(bili):
        b_notes, b_trends, b_trends_all = compute_bilibili(bili)
        payload["bilibili"] = {
            "notes": b_notes,
            "trends": b_trends,
            "trends_all": b_trends_all,
            "meta": {
                "period": source_status["bili"].get("period", ""),
                "flow_type": "全部流量",
                "attr_period": 15,
                "note_count": len(b_notes),
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
    print(f"总投入(薯条·实际支付推广完成) {summary['total_spend']:.0f} | 总GMV {summary['total_gmv']:.0f} | 整体ROI "
          + (f"{summary['overall_roi']:.2f}" if summary['overall_roi'] else "—"))
    if len(top):
        t = top.iloc[0]
        title_str = str(t.get('title', ''))[:20] if 'title' in t.index else ''
        roi_str = f"{t['roi']:.1f}" if pd.notna(t.get('roi')) else '—'
        print(f"全场最高ROI: {t.get('creator', '—')} · {title_str} (ROI {roi_str})")
    print("=" * 52)
    return out


if __name__ == "__main__":
    main()
