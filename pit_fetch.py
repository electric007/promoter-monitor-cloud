"""Download NSE insider-trading (SEBI PIT Reg 7) disclosures month by month and combine them into pit/pit_all.csv.
usage: python pit_fetch.py [start YYYY-MM] [end YYYY-MM]      default 2015-05 to the current month
Source: https://www.nseindia.com/api/corporates-pit (public disclosures filed by promoters, directors, KMP, employees)."""
import os, sys, json, time, gzip, datetime, calendar
import urllib.request, http.cookiejar
import pandas as pd

SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, "pit")
RAW = os.path.join(OUT, "raw")
os.makedirs(RAW, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
REF = "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading"


class Sess:
    def __init__(self):
        self.n = 0
        self.open()

    def open(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.get(REF, html=True)
        self.n = 0

    def get(self, url, html=False):
        h = {"User-Agent": UA, "Accept": "text/html" if html else "application/json, text/plain, */*", "Referer": REF}
        r = self.op.open(urllib.request.Request(url, headers=h), timeout=60)
        b = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            b = gzip.decompress(b)
        self.n += 1
        return b


def month_list(a, b):
    y, m = int(a[:4]), int(a[5:7])
    ye, me = int(b[:4]), int(b[5:7])
    while (y, m) <= (ye, me):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


today = datetime.date.today()
start = sys.argv[1] if len(sys.argv) > 1 else "2015-05"   # existing months are skipped, so this is fast after the first run
end = sys.argv[2] if len(sys.argv) > 2 else today.strftime("%Y-%m")
s = Sess()
for y, m in month_list(start, end):
    p = os.path.join(RAW, f"{y}-{m:02d}.json")
    last_day = calendar.monthrange(y, m)[1]
    recent = (y, m) >= ((today - datetime.timedelta(days=40)).year, (today - datetime.timedelta(days=40)).month)
    if os.path.exists(p) and not recent:   # months older than about 40 days are final; re-download the recent ones
        continue
    a, b = f"01-{m:02d}-{y}", f"{last_day:02d}-{m:02d}-{y}"
    url = f"https://www.nseindia.com/api/corporates-pit?index=equities&from_date={a}&to_date={b}"
    for attempt in range(6):
        try:
            if s.n >= 15:
                s.open()
            d = json.loads(s.get(url))
            rows = d.get("data", d) if isinstance(d, dict) else d
            json.dump(rows, open(p, "w"))
            print(y, m, len(rows), flush=True)
            break
        except Exception as e:
            print("retry", y, m, repr(e)[:100], flush=True)
            time.sleep(3 + attempt * 3)
            try:
                s.open()
            except Exception:
                pass
    time.sleep(1.0)

keep = ["symbol", "company", "personCategory", "acqName", "tdpTransactionType", "acqMode", "secType", "secAcq", "secVal",
        "befAcqSharesNo", "befAcqSharesPer", "afterAcqSharesNo", "afterAcqSharesPer", "acqfromDt", "acqtoDt", "intimDt", "date", "did", "derivativeType", "exchange"]
frames = []
for f in sorted(os.listdir(RAW)):
    rows = json.load(open(os.path.join(RAW, f)))
    if rows:
        frames.append(pd.DataFrame(rows).reindex(columns=keep))
if not frames:
    sys.exit("No insider filings were downloaded (NSE may be blocking this machine).")
df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["did"])
df.to_csv(os.path.join(OUT, "pit_all.csv"), index=False)
print("DONE rows", len(df), "months", len(frames))
