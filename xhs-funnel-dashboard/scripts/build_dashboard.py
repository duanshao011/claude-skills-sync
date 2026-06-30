# -*- coding: utf-8 -*-
"""小红书全链路投放分析看板 · 主编排。

读三表 → 清洗 → 合并 → 四层指标 → 相对水位线 → 四象限 → 复用洞察
→ 窗口对齐校验 → 注入前端 → 输出单个自包含 HTML。

用法：
  python build_dashboard.py --pugongying 蒲公英.xlsx --star 星河.csv --chili 薯条.xlsx
                            [--start 20260501 --end 20260531] [--output-dir 目录] [--prefix 前缀]
"""
import argparse
import os
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

from loaders import load_pugongying, load_star, load_chili
from metrics import compute
from insights import compute_insights
from render import build_payload, render_html

DESK = r"C:\Users\duansb\Desktop\小红书营销数据"
DEF_PGY = DESK + r"\小红星蒲公英数据\0630蒲公英数据示例.xlsx"
DEF_STAR = DESK + r"\小红星蒲公英数据\5月份星河数据.csv"
DEF_CHILI = DESK + r"\薯条投放\6月份薯条消耗明细.xlsx"


def _md(yyyymmdd):
    s = str(yyyymmdd)
    return f"{int(s[4:6])}/{int(s[6:8])}" if len(s) == 8 else s


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
    msg = f"星河({_md(s_lo)}–{_md(s_hi)})与薯条({_md(c_lo)}–{_md(c_hi)})月份不重叠，止损象限可能虚高"
    return False, msg, period


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pugongying", default=DEF_PGY)
    ap.add_argument("--star", default=DEF_STAR)
    ap.add_argument("--chili", default=DEF_CHILI)
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--output-dir", default=DESK)
    ap.add_argument("--prefix", default=None)
    args = ap.parse_args()

    print("读取三表 ...")
    pgy = load_pugongying(args.pugongying, start=args.start, end=args.end)
    star_agg, daily, smeta = load_star(args.star)
    chili_agg, cmeta = load_chili(args.chili)
    print(f"  蒲公英 {len(pgy)} 篇 | 星河 {len(star_agg)} 篇 | 薯条 {len(chili_agg)} 篇")

    master, waterlines, summary = compute(pgy, star_agg, chili_agg)
    ins = compute_insights(master)

    align_ok, align_msg, period = check_alignment(smeta, cmeta)

    meta = {
        "period": period,
        "flow_type": smeta.get("flow_type", "全部流量"),
        "attr_period": smeta.get("attr_period", 30),
        "align_ok": align_ok,
        "align_msg": align_msg,
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "_insights": ins,
    }

    payload = build_payload(master, waterlines, summary, daily, meta)
    html = render_html(payload)

    prefix = args.prefix or datetime.now().strftime("%m%d_%H%M")
    out = os.path.join(args.output_dir, f"{prefix}_全链路投放看板.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    # ---- 交付回执 ----
    seed = master[master["quadrant"] == "重点追投"].sort_values("roi", ascending=False)
    top = master.sort_values("roi", ascending=False).head(1)
    print("\n" + "=" * 52)
    print("看板已生成:", out)
    print(f"数据周期: {period} | 口径: {meta['flow_type']}/{meta['attr_period']}天")
    print("窗口对齐:", "✓ 已对齐" if align_ok else f"⚠ {align_msg}")
    print(f"总投入 {summary['total_cost']:.0f} | 总GMV {summary['total_gmv']:.0f} | 整体ROI "
          + (f"{summary['overall_roi']:.2f}" if summary['overall_roi'] else "—"))
    print("四象限:", summary["quadrant_counts"])
    if len(seed):
        print(f"重点追投种子 {len(seed)} 篇，最高: {seed.iloc[0]['creator']} (ROI {seed.iloc[0]['roi']:.1f})")
    if len(top):
        print(f"全场最高ROI: {top.iloc[0]['creator']} · {str(top.iloc[0]['title'])[:20]} (ROI {top.iloc[0]['roi']:.1f})")
    if ins.get("stable_creators"):
        names = "、".join(s["creator"] for s in ins["stable_creators"][:3])
        print("推荐追投达人(高ROI且稳):", names)
    print("=" * 52)
    return out


if __name__ == "__main__":
    main()
