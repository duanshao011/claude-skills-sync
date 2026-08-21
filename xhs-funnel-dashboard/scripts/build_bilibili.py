# -*- coding: utf-8 -*-
"""B站投放数据看板 · 主编排。

扫 B站 目录 → 加载商家后台导出的明细 CSV（单表全链路字段）
→ 按 内容ID×日期 聚合 → 注入 B站模板（assets/bilibili 三件套）
→ 输出 `B站投放看板.html`（放在 B站 数据目录里）。

当前看板只含「单篇趋势分析」模块；架构与小红书 modTrend 一致。

用法：
  python build_bilibili.py
  python build_bilibili.py --scan-dir 某目录 --output-dir 某目录
"""
import argparse
import json
import os
import sys
from datetime import datetime

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(SKILL_DIR, "assets")
BILI_ASSETS = os.path.join(ASSETS, "bilibili")
DEFAULT_SCAN_DIR = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件\03-B站"

# B站 后台导出列名 → 标准键（缺列时按位置兜底 / 加载失败给出明确提示）
COL_MAP = {
    "note_id": ["内容ID"],
    "date": ["日期"],
    "creator": ["达人昵称"],
    "url": ["内容链接"],
    "play_uv": ["阅读/播放UV"],
    "visit_uv": ["进店UV"],
    "cart_uv": ["商品加购UV"],
    "deal_uv": ["成交UV"],
    "gmv": ["商家GMV"],
    "new_visit_uv": ["新客进店uv"],
    "search_visit_uv": ["搜索进店UV"],
}

REQUIRED = ["note_id", "date", "visit_uv"]


def _to_num(series):
    return pd.to_numeric(series, errors="coerce").fillna(0)


def scan_data_dir(root):
    """扫描目录，识别文件名含「B站」的数据表；同类多份取修改时间最新一份。"""
    if not os.path.isdir(root):
        return None
    candidates = []
    for name in os.listdir(root):
        if not name.lower().endswith((".xlsx", ".xls", ".csv")):
            continue
        if name.startswith("~"):  # Excel 打开中的临时文件
            continue
        if "B站" in name:
            candidates.append((os.path.getmtime(os.path.join(root, name)), os.path.join(root, name)))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def load_bilibili(path):
    """加载 B站 明细表 → 标准化列名 DataFrame（内容ID×日期粒度）。"""
    raw = pd.read_csv(path, encoding="utf-8-sig") if path.lower().endswith(".csv") \
        else pd.read_excel(path)
    mapped = {}
    for key, names in COL_MAP.items():
        col = next((c for c in raw.columns if str(c).strip() in names), None)
        if col is not None:
            mapped[key] = col
    missing = [k for k in REQUIRED if k not in mapped]
    if missing:
        raise ValueError(
            f"[B站] 缺少关键字段 {missing}；已识别到的列：{list(raw.columns)[:30]} ..."
        )
    df = pd.DataFrame({k: raw[mapped[k]] for k in mapped})
    # 日期统一转 yyyymmdd 数字；兼容 "20260817" / "2026-08-17" 两种写法
    date_s = df["date"].astype(str).str.strip()
    m = date_s.str.extract(r"(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})")
    df["date"] = pd.to_numeric(m[0] + m[1].str.zfill(2) + m[2].str.zfill(2), errors="coerce")
    df = df.dropna(subset=["date"]).copy()
    df["date"] = df["date"].astype("int64")
    for key in ["play_uv", "visit_uv", "cart_uv", "deal_uv", "gmv",
                "new_visit_uv", "search_visit_uv"]:
        if key in df.columns:
            df[key] = _to_num(df[key])
    df["note_id"] = df["note_id"].astype(str).str.strip()
    df["creator"] = df.get("creator", pd.Series("", index=df.index)).fillna("").astype(str)
    df["url"] = df.get("url", pd.Series("", index=df.index)).fillna("").astype(str)
    return df


def _f(v):
    """NaN/None → None；numpy 数值 → 原生 Python 数值（保证 JSON 可序列化）。"""
    if v is None or pd.isna(v):
        return None
    if hasattr(v, "item"):  # numpy.int64 / numpy.float64
        v = v.item()
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v


def _period_str(lo, hi):
    if not lo or not hi:
        return ""
    return f"{int(str(lo)[4:6])}/{int(str(lo)[6:8])}–{int(str(hi)[4:6])}/{int(str(hi)[6:8])}"


def compute(df):
    """聚合：notes（内容档案）+ trends（单篇逐日）+ trends_all（全量逐日）。"""
    notes = []
    for nid, g in df.groupby("note_id"):
        g = g.sort_values("date")
        row = g.iloc[-1]  # 取最新一行拿达人/链接等元信息
        notes.append({
            "note_id": str(nid),
            "creator": row.get("creator", ""),
            "url": row.get("url", ""),
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
        # [date, visit_uv, cart_uv, deal_uv, gmv, play_uv]
        trends_all.append([
            int(r["date"]),
            _f(r.get("visit_uv")), _f(r.get("cart_uv")),
            _f(r.get("deal_uv")), _f(r.get("gmv")), _f(r.get("play_uv")),
        ])

    return notes, trends, trends_all


def build_payload(df, notes, trends, trends_all, source_path):
    lo = int(df["date"].min())
    hi = int(df["date"].max())
    meta = {
        "period": _period_str(lo, hi),
        "flow_type": "全部流量",
        "attr_period": 15,
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "sources": {
            "bilibili": {
                "name": "B站",
                "loaded": True,
                "path": os.path.basename(source_path),
                "rows": int(len(df)),
                "period": _period_str(lo, hi),
            },
        },
    }
    summary = {
        "note_count": int(len(notes)),
        "total_play": _f(df["play_uv"].sum()) if "play_uv" in df else None,
        "total_visit": _f(df["visit_uv"].sum()),
        "total_cart": _f(df["cart_uv"].sum()) if "cart_uv" in df else None,
        "total_deal": _f(df["deal_uv"].sum()) if "deal_uv" in df else None,
        "total_gmv": _f(df["gmv"].sum()) if "gmv" in df else None,
    }
    return {"meta": meta, "summary": summary, "notes": notes,
            "trends": trends, "trends_all": trends_all}


def safe_json(obj):
    s = json.dumps(obj, ensure_ascii=False, allow_nan=False)
    return s.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def render_html(payload):
    def _read(p):
        with open(p, encoding="utf-8") as f:
            return f.read()
    html = _read(os.path.join(BILI_ASSETS, "template.html"))
    css = _read(os.path.join(BILI_ASSETS, "dashboard.css"))
    js = _read(os.path.join(BILI_ASSETS, "dashboard.js"))
    echarts = _read(os.path.join(ASSETS, "echarts.min.js"))
    html = html.replace("/*__CSS__*/", css)
    html = html.replace("/*__ECHARTS__*/", echarts)
    html = html.replace("/*__JS__*/", js)
    html = html.replace("__PAYLOAD__", safe_json(payload))
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan-dir", default=None, help="B站数据目录（默认 " + DEFAULT_SCAN_DIR + "）")
    ap.add_argument("--output-dir", default=None, help="看板输出目录（默认同 scan-dir）")
    args = ap.parse_args()

    scan_dir = args.scan_dir or DEFAULT_SCAN_DIR
    source_path = scan_data_dir(scan_dir)
    if not source_path:
        print(f"✗ 未在 {scan_dir} 找到文件名含「B站」的数据表（csv/xlsx）")
        sys.exit(1)
    print(f"数据表: {os.path.basename(source_path)}")

    try:
        df = load_bilibili(source_path)
    except Exception as e:
        print(f"✗ B站表加载失败：{e}")
        sys.exit(1)

    notes, trends, trends_all = compute(df)
    payload = build_payload(df, notes, trends, trends_all, source_path)

    out_dir = args.output_dir or scan_dir
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "B站投放看板.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(render_html(payload))

    s = payload["summary"]
    print("\n" + "=" * 52)
    print("看板已生成:", out)
    print(f"数据周期: {payload['meta']['period']} | 口径: {payload['meta']['flow_type']}/{payload['meta']['attr_period']}天")
    print(f"内容数: {s['note_count']} | 总播放UV: {int(s['total_play'] or 0):,} "
          f"| 总进店UV: {int(s['total_visit'] or 0):,} | 总成交UV: {int(s['total_deal'] or 0):,} "
          f"| 总GMV: ¥{s['total_gmv'] or 0:,.2f}")
    print("=" * 52)


if __name__ == "__main__":
    main()
