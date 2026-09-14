# 東海岸衝浪天氣 — Taitung Surf Dashboard

A free, mobile-first surf/weather dashboard for the Taitung east coast
(Donghe / Jinzun / Chenggong), hosted on GitHub Pages with a scheduled
GitHub Action that refreshes CWA (Central Weather Administration) data.

**Phase 1** (this build): a single static landing page — 7-day forecast
widgets, CWA coastal/township/tide/station/buoy data, an accuracy-tracking
placeholder, and a live cam embed. No database, no per-spot subpages yet
(see Roadmap below).

## Page layout

1. 7-day forecast widgets — Windguru (spot 218382, Donghe), surf-forecast.com
   (Chengkung, link-out only — they don't offer an embeddable widget), Windy
   (Donghe waves)
2. CWA coastal 3-day / 3-hourly wave forecast for Donghe (`F-D0047-095`)
3. Other CWA data: township forecast (`F-D0047-039`, 東河鄉), tide
   (`F-A0021-001`, 東河鄉), station observations (`O-A0001-001` —
   C0S810 東河 / C0SA30 都歷 / C0T9I0 豐濱), buoy/sea-state (`O-B0075-001` — station 46761F,
   Chenggong)
4. Forecast-accuracy tracking — placeholder only, real charts land in Phase 3
5. Jinzun live cam (YouTube embed)

## One-time setup

### 1. Get a CWA Open Data API key

Register at <https://opendata.cwa.gov.tw/user/authkey> if you don't already
have a key.

### 2. Add it as a GitHub Actions secret

In this repo: **Settings → Secrets and variables → Actions → New repository
secret**

- Name: `CWA_API_KEY`
- Value: your key

The key is never committed to the repo — the scheduled workflow reads it
from this secret at run time.

### 3. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch**,
branch `main`, folder `/ (root)`. Save. The site will publish at
`https://<your-username>.github.io/<repo-name>/`.

### 4. Run the data-fetch workflow once

**Actions → Update CWA Data → Run workflow** (or just wait — it also runs
every 3 hours on its own). This populates `data/*.json` for the first time;
until then the page shows "無法載入" placeholders in the CWA data sections.

## Running the fetch script locally

```bash
export CWA_API_KEY=your-key-here   # PowerShell: $env:CWA_API_KEY = "your-key-here"
node scripts/fetch-data.mjs
```

This writes `data/*.json` + `data/meta.json`. Useful for checking the CWA
response shapes match what `js/app.js` expects — the CWA field names for a
couple of datasets (`F-D0047-095` coastal forecast, `O-B0075-001` buoy) were
inferred from documentation rather than a live response, so double-check
`data/coastal.json` and `data/buoy.json` after the first real run. If a
section renders "資料格式解析失敗", the raw payload is still written to that
file (extraction just didn't find a match) — inspect it and adjust the
corresponding `render*` function in `js/app.js` or `build*` function in
`scripts/fetch-data.mjs`.

## Project structure

```
index.html              single landing page
css/style.css           dark/light theme (default dark), mobile-first
js/app.js               theme toggle, Windguru widget injection, data rendering
scripts/fetch-data.mjs  pulls CWA Open Data, writes data/*.json
data/*.json             latest fetched data (committed by the scheduled Action)
.github/workflows/      update-data.yml — runs the fetch script every 3 hours
```

## Roadmap (not in this build)

- **Phase 2** — database/logger for historical observations
- **Phase 3** — forecast-vs-observed accuracy charts (the placeholder above)
- **Phase 5** — per-spot subpages, Jinzun/Chenggong-specific widgets, blended
  forecast, spot scoring
