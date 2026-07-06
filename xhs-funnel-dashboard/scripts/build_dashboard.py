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

from loaders import load_pugongying, load_star, load_chili, load_lingxi
from metrics import compute
from render import build_payload, render_html

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
DEFAULT_SCAN_DIR = r"C:\Users\duansb\Desktop\小红书营销数据\数据看板文件"
# 约定：不传路径的表 = 不加载 = 前端标注"需上传XX表"。
# 默认全空，只加载调用时明确传入的表（每次由博哥发路径决定哪几张表进来）。
DEF_PGY = ""
DEF_STAR = ""
DEF_CHILI = ""
DEF_LX = ""


def scan_data_dir(root):
    """扫描目录，按文件名关键字自动识别四张表。
    返回 dict：{pgy, star(list), chili, lx}
    - 蒲公英：文件名含"蒲公英"
    - 星河：文件名含"星河"或"小红星"（可能多个，全部收集）
    - 薯条：文件名含"薯条"
    - 灵犀：文件名含"灵犀"
    同类多份时按修改时间取最新（除星河可多张）。
    """
    if not os.path.isdir(root):
        return {}
    result = {"pgy": None, "star": [], "chili": None, "lx": None}
    candidates = {"pgy": [], "star": [], "chili": [], "lx": []}
    for name in os.listdir(root):
        if not name.lower().endswith((".xlsx", ".xls", ".csv")):
            continue
        if name.startswith("~"):  # Excel 打开中的临时文件
            continue
        full = os.path.join(root, name)
        mtime = os.path.getmtime(full)
        if "蒲公英" in name:
            candidates["pgy"].append((mtime, full))
        elif "星河" in name or "小红星" in name:
            candidates["star"].append((mtime, full))
        elif "薯条" in name:
            candidates["chili"].append((mtime, full))
        elif "灵犀" in name:
            candidates["lx"].append((mtime, full))
    # 蒲公英/薯条/灵犀取最新一份；星河全部保留（旧版+新版）
    if candidates["pgy"]:
        result["pgy"] = max(candidates["pgy"])[1]
    if candidates["chili"]:
        result["chili"] = max(candidates["chili"])[1]
    if candidates["lx"]:
        result["lx"] = max(candidates["lx"])[1]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pugongying", default=DEF_PGY)
    ap.add_argument("--star", nargs="+", default=[])  # 支持多张星河，后传优先(新版覆盖旧版)
    ap.add_argument("--chili", default=DEF_CHILI)
    ap.add_argument("--lingxi", default=DEF_LX)
    ap.add_argument("--scan-dir", default=None,
                    help="扫描目录自动识别四张表（默认 " + DEFAULT_SCAN_DIR + "）")
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
        if not (args.pugongying or args.star or args.chili or args.lingxi):
            scan_dir = DEFAULT_SCAN_DIR
    if scan_dir and os.path.isdir(scan_dir):
        scanned = scan_data_dir(scan_dir)
        print(f"自动扫描目录: {scan_dir}")
        if scanned.get("pgy") and not args.pugongying:
            args.pugongying = scanned["pgy"]
            print(f"  蒲公英 → {os.path.basename(args.pugongying)}")
        if scanned.get("star") and not args.star:
            args.star = scanned["star"]
            for p in args.star:
                print(f"  星河 → {os.path.basename(p)}")
        if scanned.get("chili") and not args.chili:
            args.chili = scanned["chili"]
            print(f"  薯条 → {os.path.basename(args.chili)}")
        if scanned.get("lx") and not args.lingxi:
            args.lingxi = scanned["lx"]
            print(f"  灵犀 → {os.path.basename(args.lingxi)}")
        # 输出目录也默认为扫描目录（除非博哥显式指定）
        if args.output_dir is None:
            args.output_dir = scan_dir
    if args.output_dir is None:
        args.output_dir = DESK

    print("读取四表 ...")

    source_status = {}

    def _pgy(path):
        return load_pugongying(path, start=args.start, end=args.end)
    pgy, source_status["pgy"] = _try(_pgy, args.pugongying, "蒲公英")
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

    chili_result, source_status["chili"] = _try(load_chili, args.chili, "薯条")
    source_status["chili"]["name"] = "薯条"
    if chili_result is not None:
        chili_agg, chili_daily, cmeta = chili_result
        source_status["chili"]["rows"] = int(len(chili_agg))
    else:
        chili_agg, chili_daily, cmeta = None, None, {}
        source_status["chili"]["rows"] = 0

    lx, source_status["lx"] = _try(load_lingxi, args.lingxi, "灵犀")
    source_status["lx"]["name"] = "灵犀"
    source_status["lx"]["rows"] = int(len(lx)) if lx is not None else 0
    # 灵犀命中主体数 = 灵犀笔记 ∩ (星河 ∪ 薯条)
    if lx is not None and (star_agg is not None or chili_agg is not None):
        subject_ids = set()
        if star_agg is not None:
            subject_ids |= set(star_agg.index)
        if chili_agg is not None:
            subject_ids |= set(chili_agg.index)
        source_status["lx"]["hit"] = int(len(set(lx.index) & subject_ids))
    else:
        source_status["lx"]["hit"] = 0

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

    for k in ["pgy", "star", "chili", "lx"]:
        s = source_status[k]
        badge = "✓" if s["loaded"] else "✗"
        p = f" · {s.get('period')}" if s.get("period") else ""
        print(f"  {badge} {s['name']} {s['rows']} 条{p}{'' if s['loaded'] else '（' + s.get('reason', '') + '）'}")

    master, waterlines, summary, cost, trends_all, cost_all = compute(
        pgy, star_agg, chili_agg, lx,
        chili_daily=chili_daily, star_daily=daily)

    align_ok, align_msg, period = check_alignment(smeta or {}, cmeta or {})

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
    }

    payload = build_payload(master, waterlines, summary, daily, meta, cost=cost,
                            trends_all=trends_all, cost_all=cost_all)
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
