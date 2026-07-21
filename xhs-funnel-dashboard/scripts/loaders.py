# -*- coding: utf-8 -*-
"""四个独立 loader：把每张表的"坑"各自封死，输出标准化列名的 DataFrame。

- load_pugongying: 多级表头(header=2)，按发布日期可选筛当期；返回笔记粒度档案
- load_star:       锁口径(全部流量+归因30)再聚合，避免重复累加；返回(笔记粒度, 日维度)
- load_chili:      过滤"实际消耗>0"剔除未投行；按笔记ID汇总消耗
- load_lingxi:     人群资产表，笔记粒度直接映射
"""
import pandas as pd

from column_map import (
    PGY_SCHEMA, STAR_SCHEMA, CHILI_SCHEMA, LX_SCHEMA, REQUIRED,
    resolve, resolve_by_position,
)


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
             "body_cta_ctr", "footer_cta_ctr", "comment_cta_ctr"]
PGY_NUM = ["exposure", "read_count", "read_uv", "avg_view_time",
           "natural_read", "promo_read", "fans", "quote_price",
           "service_fee", "total_amount",
           "body_cta_click", "footer_cta_click", "comment_cta_click"]


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

    if "pub_date" in df:
        df["pub_date"] = pd.to_datetime(df["pub_date"], errors="coerce")
        if start:
            df = df[df["pub_date"] >= pd.to_datetime(str(start))]
        if end:
            df = df[df["pub_date"] <= pd.to_datetime(str(end))]

    df = df.drop_duplicates(subset="note_id", keep="first").set_index("note_id")
    return df


# ---------- 星河 ----------
STAR_NUM = ["read_uv", "visit_uv", "new_visit_uv", "search_visit_uv",
            "cart_uv", "deal_uv", "gmv"]


def _parse_star_date(series):
    """星河日期归一：'2026-07-04'/'2026-07-04\\t'/'20260704'/int → int YYYYMMDD。"""
    s = series.astype(str).str.strip().str.replace("\t", "", regex=False)
    dt = pd.to_datetime(s, errors="coerce")
    d = dt.dt.strftime("%Y%m%d")
    d = pd.to_numeric(d, errors="coerce")
    # 兜底：已经是纯数字 YYYYMMDD 的字符串
    fallback = pd.to_numeric(s, errors="coerce")
    d = d.fillna(fallback)
    return d.astype("Int64")


def _load_one_star(path):
    """读一张星河 xlsx/csv → 标准列 + 已锁口径 + 已归一日期的 DataFrame。"""
    if str(path).lower().endswith(".csv"):
        raw = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    else:
        raw = pd.read_excel(path, dtype=str)
    df = _std_frame(raw, STAR_SCHEMA, "star")
    df["note_id"] = df["note_id"].astype(str).str.strip()

    file_meta = {}
    # 流量类型：新版有(全部流量)；旧版无(整表默认已是全部流量)
    if "flow_type" in df:
        ft = df["flow_type"].astype(str).str.strip()
        if (ft == "全部流量").any():
            df = df[ft == "全部流量"]
            file_meta["flow_type"] = "全部流量"
        else:
            top = ft.mode().iloc[0]
            df = df[ft == top]
            file_meta["flow_type"] = top
    else:
        file_meta["flow_type"] = "全部流量"  # 旧版默认口径

    # 归因周期：新版"归因周期"/旧版"归因口径"，都规约到数值 30
    if "attr_period" in df:
        cleaned = df["attr_period"].astype(str).str.replace("\t", "", regex=False).str.strip()
        periods = pd.to_numeric(cleaned, errors="coerce")
        if periods.notna().any():
            pick = 30 if (periods == 30).any() else int(periods.max())
            df = df[periods == pick]
            file_meta["attr_period"] = pick

    for c in STAR_NUM:
        if c in df:
            df[c] = _to_num(df[c])

    if "date" in df:
        df["date"] = _parse_star_date(df["date"])
        df = df[df["date"].notna()]
        if len(df):
            file_meta["date_min"] = int(df["date"].min())
            file_meta["date_max"] = int(df["date"].max())

    return df, file_meta


def load_star(path):
    """支持单个路径或路径列表。传多张时按顺序读入，重叠日期后传优先(keep='last')。

    典型场景：旧版1234月 + 新版456月，两张都覆盖4月。传参顺序 [旧版, 新版]，
    重叠区新版覆盖旧版；旧版1-3月保留（新版覆盖不到）。
    """
    paths = [path] if isinstance(path, str) else list(path)
    frames, file_metas = [], []
    for p in paths:
        df_one, meta_one = _load_one_star(p)
        df_one["_src"] = p  # 源文件标记，便于溯源
        frames.append(df_one)
        file_metas.append(meta_one)

    df = pd.concat(frames, ignore_index=True)

    # 重叠去重：同 (note_id, date) 保留后传的一份（新版口径优先）
    if "date" in df:
        df = df.drop_duplicates(subset=["note_id", "date"], keep="last")

    # 汇总 meta：期间取并集
    meta = {"flow_type": file_metas[0].get("flow_type", "全部流量"),
            "attr_period": file_metas[0].get("attr_period", 30)}
    date_mins = [m.get("date_min") for m in file_metas if m.get("date_min")]
    date_maxs = [m.get("date_max") for m in file_metas if m.get("date_max")]
    if date_mins:
        meta["date_min"] = min(date_mins)
    if date_maxs:
        meta["date_max"] = max(date_maxs)
    meta["files"] = paths

    keep = [c for c in STAR_NUM if c in df]
    agg = df.groupby("note_id")[keep].sum()

    if "creator" in df:
        agg["creator"] = df.drop_duplicates(subset="note_id", keep="last").set_index("note_id")["creator"]

    daily = None
    if "date" in df:
        _daily_num = ["visit_uv", "cart_uv", "deal_uv", "gmv", "read_uv"]
        dcols = ["note_id", "date"] + [c for c in _daily_num if c in df]
        daily = df[dcols].copy()
        daily["date"] = daily["date"].astype("Int64")
        daily = daily.groupby(["note_id", "date"], as_index=False)[
            [c for c in _daily_num if c in df]
        ].sum()

    return agg, daily, meta


# ---------- 薯条 ----------
def load_chili(path):
    """口径(2026-07-02 更新)：投放金额 = 实际支付金额，仅订单状态=推广完成。

    新薯条表(含 real_pay/status) → 新口径；老表(无 real_pay) → 回退旧口径(实际消耗>0)。
    返回 (agg, chili_daily, meta)：
      agg          — 按 note_id 聚合 spend/chili_max_daily/chili_orders
      chili_daily  — 按 (note_id, launch_date) 的每日实付 → 图表二柱状图
      meta         — launch_min/max 等
    """
    raw = pd.read_excel(path, dtype=str)
    df = _std_frame(raw, CHILI_SCHEMA, "chili")
    df["note_id"] = df["note_id"].astype(str).str.strip()

    # —— 金额字段：优先实际支付，无则回退实际消耗（兼容老表） ——
    has_real_pay = "real_pay" in df
    pay_col = "real_pay" if has_real_pay else "spend"
    df["spend"] = _to_num(df[pay_col])
    if "budget" in df:
        df["budget"] = _to_num(df["budget"])
    for c in ["impression", "read"]:
        if c in df:
            df[c] = _to_num(df[c])

    # —— 状态筛选：有 status 列只取推广完成，无则不筛（兼容老表） ——
    if "status" in df:
        df = df[df["status"] == "推广完成"].copy()

    # —— 启动时间 → launch_date（int YYYYMMDD） ——
    meta = {}
    if "launch_time" in df:
        lt = pd.to_datetime(df["launch_time"], errors="coerce")
        df["launch_date"] = lt.dt.strftime("%Y%m%d").astype("Int64")
        df = df[df["launch_date"].notna()]
        if lt.notna().any():
            meta["launch_min"] = int(lt.min().strftime("%Y%m%d"))
            meta["launch_max"] = int(lt.max().strftime("%Y%m%d"))

    # 只保留实际支付>0的行（打了钱但退款的剔除）
    invested = df[df["spend"] > 0].copy()

    # 按 note_id 聚合
    g = invested.groupby("note_id")
    agg = g["spend"].sum().to_frame()
    if "impression" in invested:
        agg["chili_impression"] = g["impression"].sum()
    if "read" in invested:
        agg["chili_read"] = g["read"].sum()
    agg["chili_orders"] = g.size()
    if "creator" in invested:
        agg["creator"] = g["creator"].first()  # 薯条的 被推广者
    # 历史最高单日消耗
    if "launch_date" in invested:
        daily_sum = invested.groupby(["note_id", "launch_date"])["spend"].sum()
        agg["chili_max_daily"] = daily_sum.groupby("note_id").max()
        agg["chili_days"] = daily_sum.groupby("note_id").size()  # 累计投放天数

    # 每日消耗明细 → 图表三柱状图数据源 + 点击展开每日投放明细
    chili_daily = None
    if "launch_date" in invested:
        # 动态聚合：spend 必选；impression/read 列存在才聚
        agg_cols = {"spend": "sum"}
        if "impression" in invested:
            agg_cols["impression"] = "sum"
        if "read" in invested:
            agg_cols["read"] = "sum"
        chili_daily = (
            invested.groupby(["note_id", "launch_date"])
            .agg(agg_cols)
            .reset_index()
        )
        # 确保 launch_date 是 int 而非 nullable Int64（JSON safe）
        chili_daily["launch_date"] = chili_daily["launch_date"].astype(int)

    return agg, chili_daily, meta


# ---------- 灵犀 ----------
LX_NUM = ["exposure", "read_count", "interact_count",
          "iti_users", "ti_users", "visit_users",
          "ctr", "interact_rate",
          "ti_visit_ratio", "iti_visit_ratio"]


def load_lingxi(path):
    """灵犀笔记 TOP 榜单，一篇一行，直接映射。

    数值字段保留原样(不做/100归一)，因为灵犀导出"点击率=26.94"实为百分数字面值，
    "TI人群进店兑换比=3.59"是次日兑换的相对倍数，都按原值透出，前端加解释即可。
    """
    raw = pd.read_excel(path)
    df = _std_frame(raw, LX_SCHEMA, "lx")
    df["note_id"] = df["note_id"].astype(str).str.strip()
    df = df[df["note_id"].notna() & (df["note_id"] != "") & (df["note_id"] != "nan")]

    for c in LX_NUM:
        if c in df:
            df[c] = _to_num(df[c])

    df = df.drop_duplicates(subset="note_id", keep="first").set_index("note_id")
    return df
