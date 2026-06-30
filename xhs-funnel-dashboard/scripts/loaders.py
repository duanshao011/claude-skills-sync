# -*- coding: utf-8 -*-
"""三个独立 loader：把每张表的"坑"各自封死，输出标准化列名的 DataFrame。

- load_pugongying: 多级表头(header=2)，按发布日期可选筛当期；返回笔记粒度档案
- load_star:       锁口径(全部流量+归因30)再聚合，避免重复累加；返回(笔记粒度, 日维度)
- load_chili:      过滤"实际消耗>0"剔除未投行；按笔记ID汇总消耗
"""
import pandas as pd

from column_map import (
    PGY_SCHEMA, STAR_SCHEMA, CHILI_SCHEMA, REQUIRED,
    resolve, resolve_by_position,
)


# ---------- 通用清洗 ----------
def _to_num(series):
    return pd.to_numeric(series, errors="coerce").fillna(0)


def _to_ratio(series):
    """统一解析为 0~1 比例。带%的字符串去%后/100；裸数值>1.5 视为百分数(/100)。"""
    def conv(x):
        if pd.isna(x):
            return None
        xs = str(x).strip()
        if xs in ("", "-", "—", "None", "nan"):
            return None
        if xs.endswith("%"):
            try:
                return float(xs[:-1].replace(",", "")) / 100.0
            except ValueError:
                return None
        try:
            v = float(xs.replace(",", ""))
        except ValueError:
            return None
        return v / 100.0 if v > 1.5 else v
    return series.map(conv)


def _std_frame(raw, schema, table_key):
    """按 schema 解析列名→标准键，校验必需字段，返回只含标准列的 DataFrame。"""
    m = resolve(raw.columns, schema)
    resolve_by_position(raw, schema, m)
    missing = [f for f in REQUIRED[table_key] if f not in m]
    if missing:
        raise ValueError(
            f"[{table_key}] 缺少关键字段 {missing}；已识别到的列：{list(raw.columns)[:30]} ..."
        )
    df = raw[[m[k] for k in m]].copy()
    df.columns = list(m.keys())
    return df


# ---------- 蒲公英 ----------
PGY_RATIO = ["play_5s", "read_3s", "finish_rate", "interact_rate",
             "body_cta_ctr", "comment_cta_ctr"]
PGY_NUM = ["read_uv", "avg_view_time", "natural_read", "promo_read",
           "fans", "quote_price", "service_fee", "total_amount"]


def load_pugongying(path, start=None, end=None):
    raw = pd.read_excel(path, header=2)
    df = _std_frame(raw, PGY_SCHEMA, "pgy")
    df["note_id"] = df["note_id"].astype(str).str.strip()
    df = df[df["note_id"].notna() & (df["note_id"] != "") & (df["note_id"] != "nan")]

    for c in PGY_NUM:
        if c in df:
            df[c] = _to_num(df[c])
    for c in PGY_RATIO:
        if c in df:
            df[c] = _to_ratio(df[c])

    # 发布日期可选筛当期
    if "pub_date" in df:
        df["pub_date"] = pd.to_datetime(df["pub_date"], errors="coerce")
        if start:
            df = df[df["pub_date"] >= pd.to_datetime(str(start))]
        if end:
            df = df[df["pub_date"] <= pd.to_datetime(str(end))]

    # 笔记粒度：同 id 取首行（蒲公英本就一篇一行）
    df = df.drop_duplicates(subset="note_id", keep="first").set_index("note_id")
    return df


# ---------- 星河 ----------
STAR_NUM = ["read_uv", "visit_uv", "new_visit_uv", "search_visit_uv",
            "cart_uv", "deal_uv", "gmv"]


def load_star(path):
    raw = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    df = _std_frame(raw, STAR_SCHEMA, "star")
    df["note_id"] = df["note_id"].astype(str).str.strip()

    meta = {}
    # 锁流量类型：优先"全部流量"，否则取出现最多的
    if "flow_type" in df:
        if (df["flow_type"] == "全部流量").any():
            df = df[df["flow_type"] == "全部流量"]
            meta["flow_type"] = "全部流量"
        else:
            top = df["flow_type"].mode().iloc[0]
            df = df[df["flow_type"] == top]
            meta["flow_type"] = top
    # 锁归因周期：优先30，否则取最大
    if "attr_period" in df:
        periods = pd.to_numeric(df["attr_period"], errors="coerce")
        pick = 30 if (periods == 30).any() else int(periods.max())
        df = df[periods == pick]
        meta["attr_period"] = pick

    for c in STAR_NUM:
        if c in df:
            df[c] = _to_num(df[c])

    # 日期范围（用于窗口校验/趋势）
    if "date" in df:
        d = pd.to_numeric(df["date"], errors="coerce")
        meta["date_min"], meta["date_max"] = int(d.min()), int(d.max())

    keep = [c for c in STAR_NUM if c in df]
    agg = df.groupby("note_id")[keep].sum()

    # 日维度（趋势折线用）：每 note_id 每天一行
    daily = None
    if "date" in df:
        dcols = ["note_id", "date"] + [c for c in ["visit_uv", "cart_uv", "deal_uv", "gmv"] if c in df]
        daily = df[dcols].copy()
        daily["date"] = pd.to_numeric(daily["date"], errors="coerce").astype("Int64")
        daily = daily.groupby(["note_id", "date"], as_index=False)[
            [c for c in ["visit_uv", "cart_uv", "deal_uv", "gmv"] if c in df]
        ].sum()

    return agg, daily, meta


# ---------- 薯条 ----------
def load_chili(path):
    raw = pd.read_excel(path, dtype=str)
    df = _std_frame(raw, CHILI_SCHEMA, "chili")
    df["note_id"] = df["note_id"].astype(str).str.strip()
    df["spend"] = _to_num(df["spend"])
    if "budget" in df:
        df["budget"] = _to_num(df["budget"])
    for c in ["impression", "read"]:
        if c in df:
            df[c] = _to_num(df[c])

    meta = {}
    # 投放时间范围（窗口校验用）
    if "launch_time" in df:
        lt = pd.to_datetime(df["launch_time"], errors="coerce")
        if lt.notna().any():
            meta["launch_min"] = int(lt.min().strftime("%Y%m%d"))
            meta["launch_max"] = int(lt.max().strftime("%Y%m%d"))

    invested = df[df["spend"] > 0].copy()
    sum_cols = [c for c in ["spend", "impression", "read"] if c in invested]
    agg = invested.groupby("note_id")[sum_cols].sum()
    agg = agg.rename(columns={"impression": "chili_impression", "read": "chili_read"})
    agg["chili_orders"] = invested.groupby("note_id").size()
    return agg, meta
