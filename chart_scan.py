"""Chart scan: finds NSE stocks at each stage of the IOLCP-style chart path and writes app/chartscan.json for the phone app.
Stages (all from daily prices, no look-ahead):
  base   - a 250-day range under 2.2x high-to-low and the price within 5% of the top of it
  break  - a close at a 250-day high on 3x+ volume inside such a base, in the last 20 trading days,
           labelled Fresh (5 bars or fewer), Holding (held 80% of closes above the old high) or Failing
  ath    - a close above the all-time high in the data (4+ years of history) in the last 20 trading days
Prices come from Yahoo Finance for every stock on the NSE list in scan/EQUITY_L.csv (about 1,900), about 6 minutes.
Research only. In backtests these chart-only stages did not beat matched random stocks; Failing breakouts did clearly worse."""
import os, sys, json, csv, time, datetime
import urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

SP = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(SP, "app")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
EPOCH = datetime.date(1970, 1, 1)
CAP = {"base": 40, "break": 40, "ath": 30}
SPARK = 130

syms = []
with open(os.path.join(SP, "scan", "EQUITY_L.csv"), newline="") as fh:
    rd = csv.reader(fh)
    next(rd)
    for r in rd:
        try:
            listed = datetime.datetime.strptime(r[3].strip(), "%d-%b-%Y").date()
        except Exception:
            continue
        if r[2].strip() in ("EQ", "BE") and listed <= datetime.date(2024, 6, 30):
            syms.append((r[0].strip(), r[1].strip()))
print("stocks to scan:", len(syms), flush=True)


def fetch(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym + '.NS')}?range=10y&interval=1d"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                d = json.loads(r.read())
            r0 = d["chart"]["result"][0]
            ts, q = r0["timestamp"], r0["indicators"]["quote"][0]
            keep = [i for i in range(len(ts)) if q["close"][i] is not None and q["high"][i] is not None and q["low"][i] is not None]
            if len(keep) < 400:
                return None
            return dict(d=np.array([ts[i] + 19800 for i in keep], dtype=np.int64) // 86400, h=np.array([q["high"][i] for i in keep]),
                        l=np.array([q["low"][i] for i in keep]), c=np.array([q["close"][i] for i in keep]), v=np.array([q["volume"][i] or 0 for i in keep], dtype=float))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return "fail"


def iso(day):
    return str(EPOCH + datetime.timedelta(days=int(day)))


def analyse(sym, name, P):
    c, h, l, v, d = P["c"], P["h"], P["l"], P["v"], P["d"]
    n = len(c)
    if (c[1:] / c[:-1] < 0.5).any() or (c[1:] / c[:-1] > 2.5).any():
        return None
    cs, vs = pd.Series(c), pd.Series(v)
    tv = float((cs * vs).rolling(60).median().iloc[-1])
    if not (tv >= 1e7 and c[-1] >= 10):
        return None
    adv = vs.rolling(50).mean().shift(1).values
    with np.errstate(divide="ignore", invalid="ignore"):
        vm = np.where(adv > 0, v / adv, 0.0)
    mx = cs.rolling(250).max().shift(1).values
    mn = cs.rolling(250).min().shift(1).values
    with np.errstate(invalid="ignore"):
        base = (mx / mn) <= 2.2
        cond = base & (c >= mx) & (vm >= 3)
    out = dict(sym=sym, name=name, close=round(float(c[-1]), 2), last=iso(d[-1]), tv_cr=round(tv / 1e7, 1), spark=[round(float(x), 2) for x in c[-SPARK:]],
               chg=round(float(c[-1] / c[-2] - 1) * 100, 2))
    lists = {}
    # breakout in the last 20 bars
    ev = [i for i in range(n - 20, n) if cond[i]]
    if ev:
        i = ev[0]
        L = float(mx[i])
        k = n - 1 - i
        w, wl = c[i + 1 :], l[i + 1 :]
        above = int((w >= L).sum()) if k else 0
        dip = float(wl.min() / c[i] - 1) * 100 if k else 0.0
        failing = k > 0 and (above / k < 0.8 or dip < -12)
        status = "Failing" if failing else ("Fresh" if k <= 5 else "Holding")
        lists["break"] = dict(date=iso(d[i]), bars=int(k), level=round(L, 2), break_close=round(float(c[i]), 2), vol_x=round(float(vm[i]), 1), above=above, dip=round(dip, 1),
                              status=status, since=round(float(c[-1] / c[i] - 1) * 100, 1), mark=SPARK - 1 - k if k < SPARK else 0)
    # all-time high cleared in the last 20 bars
    if n >= 1000:
        athprev = np.concatenate([[np.nan], np.maximum.accumulate(h)[:-1]])
        hit = [i for i in range(n - 20, n) if c[i] > athprev[i]]
        if hit:
            i = hit[0]
            lists["ath"] = dict(date=iso(d[i]), bars=int(n - 1 - i), old_high=round(float(athprev[i]), 2), above_pct=round(float(c[-1] / athprev[i] - 1) * 100, 1), mark=SPARK - 1 - (n - 1 - i))
    # base near its ceiling, no breakout yet
    if "break" not in lists and "ath" not in lists and base[-1] and mx[-1] * 0.95 <= c[-1] <= mx[-1] * 1.03:
        yrs = float(mx[-1] / mn[-1])
        lists["base"] = dict(ceiling=round(float(mx[-1]), 2), below_pct=round(float(c[-1] / mx[-1] - 1) * 100, 1), range_x=round(yrs, 2), vol_x=round(float(vm[-1]), 1))
    if not lists:
        return None
    out["lists"] = lists
    return out


results, fails, scanned, t0 = [], 0, 0, time.time()
with ThreadPoolExecutor(max_workers=6) as ex:
    futs = {ex.submit(fetch, s): (s, nm) for s, nm in syms}
    for k, f in enumerate(as_completed(futs)):
        s, nm = futs[f]
        P = f.result()
        if P == "fail":
            fails += 1
        elif P is not None:
            scanned += 1
            try:
                r = analyse(s, nm, P)
            except Exception:
                r = None
            if r:
                results.append(r)
        if (k + 1) % 300 == 0:
            print(f"  {k+1}/{len(syms)} | scanned {scanned} | matches {len(results)} | {time.time()-t0:.0f}s", flush=True)
if fails > 0.5 * len(syms) or scanned < 300:
    sys.exit(f"Too few price downloads succeeded ({scanned} scanned, {fails} failed). Keeping the previous chartscan.json.")

promo = {}
try:
    dj = json.load(open(os.path.join(APP, "data.json"), encoding="utf-8"))
    for s in dj["stocks"]:
        promo[s["sym"]] = dict(score=s["score"], idx=dj["stocks"].index(s))
except Exception:
    pass
for r in results:
    r["promoter"] = promo.get(r["sym"])

def pick(key, sortkey, reverse):
    rows = [dict(r, **r["lists"][key]) for r in results if key in r["lists"]]
    for x in rows:
        x.pop("lists", None)
    rows.sort(key=sortkey, reverse=reverse)
    return rows[: CAP[key]], len(rows)

base_rows, nb = pick("base", lambda r: (r["below_pct"], r["tv_cr"]), True)
brk_rows, nk = pick("break", lambda r: (r["status"] != "Failing", -r["bars"], r["vol_x"]), True)
ath_rows, na = pick("ath", lambda r: (-r["bars"], r["tv_cr"]), True)
last_day = max(r["last"] for r in results)
out = dict(generated=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), price_asof=last_day, scanned=scanned, totals=dict(base=nb, break_=nk, ath=na),
           base=base_rows, break_=brk_rows, ath=ath_rows)
json.dump(out, open(os.path.join(APP, "chartscan.json"), "w"), separators=(",", ":"))
print(f"wrote app/chartscan.json | scanned {scanned} | base {nb} | breakouts {nk} | new highs {na} | failed downloads {fails} | {time.time()-t0:.0f}s")
