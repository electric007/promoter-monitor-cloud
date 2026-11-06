# Promoter Monitor (cloud copy)

A phone-friendly page that lists promoter open-market buying flags with charts, insider filings and look-alike history. GitHub's servers rebuild it every day at 7 pm India time, so nothing needs your computer or phone to be on. Research only, not a recommendation to buy or sell.

## One-time setup (about 10 minutes, on a computer)

1. **Publish this folder.** In GitHub Desktop: File, Add local repository, choose this folder, then Publish repository. Name it `promoter-monitor` and **untick "Keep this code private"** (free accounts can only publish a site from a public repository). The page holds only public prices and filings.
2. **Turn on the site.** On github.com open the repository, then Settings, Pages. Under "Build and deployment", set Source to **GitHub Actions**.
3. **Run it once.** Open the Actions tab, choose "Daily refresh", then "Run workflow". If GitHub asks you to enable workflows, enable them. The first run takes about 10 minutes.
4. **Open it on your phone.** When the run shows a green tick, open `https://YOUR-USERNAME.github.io/promoter-monitor/` on your phone. Add it to your home screen (Android Chrome: menu, Install app. iPhone Safari: Share, Add to Home Screen).

From then on it refreshes itself every evening.

## Good to know

- If NSE blocks GitHub's servers, the filings download step fails and the saved snapshot in `pit/` is used. Prices still update, and the page shows a "filings feed is behind" banner.
- If prices cannot be downloaded, the run stops and the site keeps showing the last good version.
- GitHub switches off scheduled runs when a repository has had no activity for 60 days. The daily run saves a tracking log, which normally counts. If the schedule stops, open the Actions tab and click Enable.
- `tracking/flag_log.csv` records every flag so you can see later how they did. Only flags found after setup are a fair test.
- To change the time, edit the `cron` line in `.github/workflows/daily.yml` (it is in UTC).
