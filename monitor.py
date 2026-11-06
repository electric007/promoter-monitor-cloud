"""Daily monitor: finds promoter open-market buying episodes, scores them, and writes app/data.json for the phone app.
usage: python monitor.py [--days 90] [--pin IOLCP]
Needs: pit/pit_all.csv (pit_fetch.py), promoter/lookalikes_ranked.csv and promoter/lookalike_rates.csv (lookalikes.py / lookalike_rank.py).
Prices are downloaded fresh from Yahoo Finance for the stocks involved and cached for the day in app_cache/."""
import os, sys, json, csv, time, argparse, datetime
import urllib.request, urllib.parse
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

SP = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(SP, "app")
CACHE = os.path.join(SP, "app_cache")
TRACK = os.path.join(SP, "tracking")
for d in (APP, CACHE, TRACK):
    os.makedirs(d, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=90, help="show episodes whose first filing is this many days old or less")
ap.add_argument("--pin", default="IOLCP", help="symbol always shown as the reference example")
args = ap.parse_args()
EPOCH = pd.Timestamp("1970-01-01")
LINK_BARS = 5
SERIES_BARS = 320
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
today = pd.Timestamp(datetime.date.today())

# ------------------------------------------------------------------ disclosures
_frames = []
for _p in ("pit_snapshot.csv.gz", "pit_all.csv"):      # committed snapshot + whatever was downloaded this run
    _f = os.path.join(SP, "pit", _p)
    if os.path.exists(_f):
        _frames.append(pd.read_csv(_f, low_memory=False))
if not _frames:
    sys.exit("No insider-filing data found in pit/. Run pit_fetch.py first.")
pit = pd.concat(_frames, ignore_index=True).drop_duplicates(subset=["did"])
for c in ("acqfromDt", "acqtoDt", "intimDt"):
    pit[c] = pd.to_datetime(pit[c], format="%d-%b-%Y", errors="coerce")
for c in ("secAcq", "secVal", "afterAcqSharesNo", "afterAcqSharesPer"):
    pit[c] = pd.to_numeric(pit[c], errors="coerce")
pit["cat"] = pit.personCategory.fillna("").str.lower()
pit["prom"] = pit.cat.str.contains("promoter")
pit["mode"] = pit.acqMode.fillna("").str.lower()
pit["side"] = pit.tdpTransactionType.fillna("").str.lower()
pit["mkt"] = pit["mode"].str.contains("market") & ~pit["mode"].str.contains("off")
pit["shares_out"] = pit.afterAcqSharesNo / (pit.afterAcqSharesPer / 100.0)
pit = pit.dropna(subset=["acqfromDt", "intimDt", "secAcq"])
pit = pit[(pit.intimDt <= today) & (pit.acqfromDt <= today) & (pit.acqfromDt > "2010-01-01")]
pit = pit[pit.secType.fillna("").str.lower().str.contains("equity") & (pit.secAcq > 0)]
feed_end = pit.intimDt.max()

# ------------------------------------------------------------------ prices
def fetch_prices(sym):
    p = os.path.join(CACHE, f"{sym.replace('&', '_')}_{today.date()}.npz")
    if os.path.exists(p):
        z = np.load(p)
        return {k: z[k] for k in z.files}
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym + '.NS')}?period1=0&period2={int(time.time()) + 86400}&interval=1d"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                d = json.loads(r.read())
            r0 = d["chart"]["result"][0]
            ts, q = r0["timestamp"], r0["indicators"]["quote"][0]
            keep = [i for i in range(len(ts)) if q["close"][i] is not None and q["high"][i] is not None and q["low"][i] is not None]
            if len(keep) < 300:
                return None
            out = dict(d=np.array([ts[i] + 19800 for i in keep], dtype=np.int64) // 86400,
                       h=np.array([q["high"][i] for i in keep]), l=np.array([q["low"][i] for i in keep]),
                       c=np.array([q["close"][i] for i in keep]), v=np.array([q["volume"][i] or 0 for i in keep], dtype=float))
            for old in os.listdir(CACHE):
                if old.startswith(sym.replace("&", "_") + "_") and old != os.path.basename(p):
                    os.remove(os.path.join(CACHE, old))
            np.savez_compressed(p, **out)
            return out
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def ctx(P):
    c, v = P["c"], P["v"]
    cs, vs = pd.Series(c), pd.Series(v)
    P["med_tv"] = (cs * vs).rolling(60).median().shift(1).values
    P["adv"] = vs.rolling(50).mean().shift(1).values
    P["low250"] = pd.Series(P["l"]).rolling(250).min().shift(1).values
    P["mx"] = cs.rolling(250).max().shift(1).values
    P["mn"] = cs.rolling(250).min().shift(1).values
    P["ret"] = np.concatenate([[np.nan], c[1:] / c[:-1] - 1])
    return P


def bar_of(P, ts):
    day = int((pd.Timestamp(ts) - EPOCH).days)
    i = int(np.searchsorted(P["d"], day, side="left"))
    return i if i < len(P["d"]) else None


def iso(day):
    return str((EPOCH + pd.Timedelta(days=int(day))).date())

# ------------------------------------------------------------------ episodes
window_ref = feed_end if (today - feed_end).days > 10 else today
stale = (today - feed_end).days > 10
cut = window_ref - pd.Timedelta(days=args.days)
buys = pit[pit.prom & (pit.side == "buy") & pit.mkt]
cand = buys[buys.intimDt >= cut - pd.Timedelta(days=10)]
syms = sorted(set(cand.symbol) | {args.pin})
print("feed ends", feed_end.date(), "| window from", cut.date(), "| candidate symbols", len(syms))

la = pd.read_csv(os.path.join(SP, "promoter", "lookalikes_ranked.csv"), parse_dates=["start", "signal"])
la["to_ath"] = la.ath_prior / la.signal_close - 1
LF = pd.DataFrame({"qty_adv": np.log(la.qty_adv.clip(lower=0.02)), "near_low": la.near_low, "avg_vm": np.log(la.avg_vm.clip(lower=0.3)),
                   "days": np.log(la.days), "pct_equity": np.log(la.pct_equity.clip(lower=0.005)), "to_ath": np.log1p(la.to_ath.clip(lower=0))})
MU, SD = LF.mean(), LF.std()
LZ = (LF - MU) / SD
la_done = la[la.outcome != "too recent"].copy()
LZd = LZ.loc[la_done.index]
rates = pd.read_csv(os.path.join(SP, "promoter", "lookalike_rates.csv"))

stocks = []
price_fail = 0
names = {}
if os.path.exists(os.path.join(SP, "scan", "EQUITY_L.csv")):
    with open(os.path.join(SP, "scan", "EQUITY_L.csv"), newline="") as fh:
        rd = csv.reader(fh); next(rd)
        for r in rd:
            names[r[0].strip()] = r[1].strip()
name_by_company = pit.drop_duplicates("symbol").set_index("symbol").company.to_dict()

for k, sym in enumerate(syms):
    g = buys[buys.symbol == sym].groupby("acqfromDt").agg(qty=("secAcq", "sum"), val=("secVal", "sum"), intim=("intimDt", "min"),
                                                          shares_out=("shares_out", "median"), who=("acqName", "first"), px_n=("secVal", "size")).reset_index().sort_values("acqfromDt")
    if g.empty:
        continue
    P = fetch_prices(sym)
    if P is None:
        print("  no prices for", sym)
        price_fail += 1
        continue
    c = P["c"]
    if (c[1:] / c[:-1] < 0.5).any() or (c[1:] / c[:-1] > 2.5).any():
        print("  skipped (suspect split/jump in price data):", sym)
        continue
    P = ctx(P)
    rows = []
    for r in g.itertuples():
        b, bi = bar_of(P, r.acqfromDt), bar_of(P, r.intim)
        if b is None or bi is None or b < 300:
            continue
        rows.append((b, bi, r))
    if not rows:
        continue
    eps, cur = [], [rows[0]]
    for x in rows[1:]:
        if x[0] - cur[-1][0] <= LINK_BARS:
            cur.append(x)
        else:
            eps.append(cur); cur = [x]
    eps.append(cur)
    for ep in (eps[-1:] if sym == args.pin else eps):
        b0, bi0, r0 = ep[0]
        sig = max(bi0, b0)
        sig_day = iso(P["d"][sig])
        if pd.Timestamp(sig_day) < cut and sym != args.pin:
            continue
        if not (P["med_tv"][sig] >= 1e7 and c[sig] >= 10):
            continue
        qty = float(sum(x[2].qty for x in ep))
        so = np.nanmedian([x[2].shares_out for x in ep])
        maxday = max(x[2].qty for x in ep)
        adv = P["adv"][b0]
        vm = [P["v"][x[0]] / P["adv"][x[0]] for x in ep if P["adv"][x[0]] > 0]
        rets = [P["ret"][x[0]] for x in ep]
        rec = dict(sym=sym, name=names.get(sym) or name_by_company.get(sym, sym), who=" / ".join(dict.fromkeys(str(x[2].who).title() for x in ep))[:90],
                   start=iso(P["d"][b0]), end=iso(P["d"][ep[-1][0]]), signal=sig_day, days=len(ep), qty=int(qty),
                   val_cr=round(float(sum(x[2].val for x in ep)) / 1e7, 2), pct_equity=round(float(qty / so * 100), 3) if so and so > 0 else None,
                   max_day_pct=round(float(maxday / so * 100), 3) if so and so > 0 else None, qty_adv=round(float(qty / adv), 2) if adv and adv > 0 else None,
                   avg_vm=round(float(np.mean(vm)), 2) if vm else None, avg_ret=round(float(np.nanmean(rets)) * 100, 2),
                   near_low=round(float(c[b0] / P["low250"][b0]), 3), base=bool(P["mx"][b0] / P["mn"][b0] <= 2.2),
                   ret60=round(float(c[b0] / c[b0 - 60] - 1) * 100, 1), signal_close=round(float(c[sig]), 2), last_close=round(float(c[-1]), 2))
        rec["since_pct"] = round((rec["last_close"] / rec["signal_close"] - 1) * 100, 1)
        flags = dict(multi=rec["days"] >= 2, near_low=rec["near_low"] <= 1.15, size=(rec["qty_adv"] or 0) >= 0.5,
                     hidden=(rec["max_day_pct"] if rec["max_day_pct"] is not None else 9) < 0.5, base=rec["base"],
                     absorb=(rec["avg_vm"] or 0) >= 1.5 and rec["avg_ret"] <= 1.5)
        rec["flags"] = {k_: bool(v_) for k_, v_ in flags.items()}
        rec["score"] = int(sum(flags.values()))
        rec["strict"] = bool(rec["near_low"] <= 1.25 and (rec["qty_adv"] or 0) >= 0.5 and flags["hidden"] and flags["multi"] and flags["base"])
        # chart series (last SERIES_BARS bars) and buy markers
        n = len(c)
        s0 = max(0, n - SERIES_BARS)
        rec["series"] = dict(d=[iso(x) for x in P["d"][s0:]], c=[round(float(x), 2) for x in c[s0:]], v=[int(x) for x in P["v"][s0:]])
        rec["buy_days"] = [dict(d=iso(P["d"][x[0]]), q=int(x[2].qty), px=(round(float(x[2].val / x[2].qty), 1) if x[2].qty and x[2].val else None)) for x in ep]
        # checks
        sells = pit[(pit.symbol == sym) & pit.prom & (pit.side == "sell") & pit.mkt & (pit.acqfromDt >= pd.Timestamp(rec["start"]) - pd.Timedelta(days=90))]
        rec["checks"] = dict(promoter_sells_90d=int(len(sells)), held_signal_close=bool(c[-1] >= c[sig] * 0.92),
                             below_signal_pct=round(float((c[sig:].min() / c[sig] - 1) * 100), 1))
        # filings (all insider categories, last 24 months)
        f = pit[(pit.symbol == sym) & (pit.acqfromDt >= window_ref - pd.Timedelta(days=730))].sort_values("acqfromDt", ascending=False).head(40)
        rec["filings"] = [dict(d=str(x.acqfromDt.date()), filed=str(x.intimDt.date()), who=str(x.acqName).title()[:40], cat=str(x.personCategory), side=str(x.tdpTransactionType),
                               mode=str(x.acqMode), qty=int(x.secAcq), val=(round(float(x.secVal) / 1e7, 2) if pd.notna(x.secVal) and x.secVal else None),
                               after=(round(float(x.afterAcqSharesPer), 2) if pd.notna(x.afterAcqSharesPer) else None)) for x in f.itertuples()]
        # look-alikes
        hist = max(0, sig)
        ath_prior = float(P["h"][: sig + 1].max()) if sig >= 1000 else None
        to_ath = (ath_prior / c[sig] - 1) if ath_prior else float(la.to_ath.median())
        v = pd.Series({"qty_adv": np.log(max(rec["qty_adv"] or 0.02, 0.02)), "near_low": rec["near_low"], "avg_vm": np.log(max(rec["avg_vm"] or 0.3, 0.3)),
                       "days": np.log(rec["days"]), "pct_equity": np.log(max(rec["pct_equity"] or 0.005, 0.005)), "to_ath": np.log1p(max(to_ath, 0))})
        dist = np.sqrt((((LZd - (v - MU) / SD)) ** 2).sum(axis=1))
        cand_la = la_done.assign(dist=dist)
        cand_la = cand_la[cand_la.sym != sym].sort_values("dist").head(6)
        rec["lookalikes"] = [dict(sym=x.sym, name=str(names.get(x.sym, x.sym)), signal=str(x.signal.date()), outcome=x.outcome,
                                  days_to_ath=(int(x.days_to_ath) if pd.notna(x.days_to_ath) else None), peak=round(float(x.peak_gain) * 100), dist=round(float(x.dist), 2))
                             for x in cand_la.itertuples()]
        stocks.append(rec)
    if (k + 1) % 20 == 0:
        print("  processed", k + 1, "of", len(syms), "| episodes", len(stocks))

if not stocks or price_fail > 0.5 * len(syms):
    sys.exit(f"Price download failed for {price_fail} of {len(syms)} stocks, or nothing was found. Keeping the previous data.json.")
# one card per (stock, signal day): keep the strongest episode
best = {}
for r in stocks:
    k_ = (r["sym"], r["signal"])
    if k_ not in best or (r["score"], r["qty"]) > (best[k_]["score"], best[k_]["qty"]):
        best[k_] = r
stocks = list(best.values())
# order: the pinned reference first, then by score (high first), newest first within a score
rest = sorted([r for r in stocks if r["sym"] != args.pin], key=lambda r: (-r["score"], -(pd.Timestamp(r["signal"]) - EPOCH).days))
stocks = [r for r in stocks if r["sym"] == args.pin][:1] + rest

# ------------------------------------------------------------------ tracking log (forward test)
log_path = os.path.join(TRACK, "flag_log.csv")
log = pd.read_csv(log_path) if os.path.exists(log_path) else pd.DataFrame(columns=["sym", "signal", "signal_close", "score", "strict", "first_seen", "source"])
first_run = log.first_seen.min() if len(log) else str(today.date())
known = set(zip(log.sym, log.signal))
new_rows = []
for r in stocks:
    if r["sym"] == args.pin:
        continue
    if (r["sym"], r["signal"]) not in known:
        src = "live" if pd.Timestamp(r["signal"]) >= pd.Timestamp(first_run) and not stale else "backfill"
        new_rows.append(dict(sym=r["sym"], signal=r["signal"], signal_close=r["signal_close"], score=r["score"], strict=r["strict"], first_seen=str(today.date()), source=src))
if new_rows:
    log = pd.concat([log, pd.DataFrame(new_rows)], ignore_index=True)
    log.to_csv(log_path, index=False)
tracked = []
last_close = {r["sym"]: r["last_close"] for r in stocks}
for r in log.itertuples():
    lc = last_close.get(r.sym)
    if lc is None:
        P = fetch_prices(r.sym)
        lc = round(float(P["c"][-1]), 2) if P is not None else None
    tracked.append(dict(sym=r.sym, signal=r.signal, signal_close=float(r.signal_close), last_close=lc, score=int(r.score), strict=bool(r.strict), source=r.source,
                        since_pct=(round((lc / float(r.signal_close) - 1) * 100, 1) if lc else None)))

last_bar = max((r["series"]["d"][-1] for r in stocks), default=str(today.date()))
out = dict(generated=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), price_asof=last_bar, filings_asof=str(feed_end.date()), stale=bool(stale),
           window_days=args.days, window_from=str(cut.date()), pin=args.pin,
           baserates=[dict(name=r["name"], n=int(r.n), stocks=int(r.stocks), reach=round(float(r.reach_ath), 3), exp_reach=round(float(r.exp_reach), 3),
                           doubled=round(float(r.doubled), 3), exp_doubled=round(float(r.exp_doubled), 3)) for _, r in rates.iterrows()],
           stocks=stocks, tracked=tracked)
json.dump(out, open(os.path.join(APP, "data.json"), "w"), separators=(",", ":"))
print("wrote app/data.json:", len(stocks), "stocks,", len(tracked), "tracked | size", round(os.path.getsize(os.path.join(APP, "data.json")) / 1024), "KB | filings to", feed_end.date(), "| stale" if stale else "")
