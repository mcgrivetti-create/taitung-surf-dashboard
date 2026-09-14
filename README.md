# Taitung Surf Dashboard

A free, mobile-first surf/weather dashboard for the Taitung east coast
(Donghe / Jinzun / Chenggong), hosted on GitHub Pages with a scheduled
GitHub Action that refreshes CWA (Central Weather Administration) data.
All-English UI; CWA's Chinese field values (weather descriptions, compass
directions, tide terms) are translated client-side in `js/app.js`.

**Phase 1** (this build): a single static landing page — 7-day forecast
widgets, CWA coastal/township/tide/station/buoy data, an accuracy-tracking
placeholder, and a live cam embed. No database yet (see Roadmap below) — the
station wind history is a small self-maintained rolling log, not a DB.

## Page layout

1. 7-day forecast widgets — Windguru (spot 218382, Donghe), surf-forecast.com
   (Chengkung, link-out only — no embeddable widget available), Windy
   (Donghe forecast table + a link to the full waves/swell/tide view)
2. CWA coastal 3-day / 3-hourly wave forecast for Donghe (`F-D0047-095`)
3. Other CWA data:
   - Township forecast (`F-D0047-039`, Donghe)
   - Tide forecast (`F-A0021-001`, Donghe) — interpolated line chart with a
     day pager (today/tomorrow/day-after), a trimmed table (today +
     tomorrow only), and a link to CWA's full 30-day tide page
   - Station observations (`O-A0001-001` — C0S810 Donghe / C0SA30 Dulih /
     C0T9I0 Fengbin), last 8 hours of wind speed/direction/Beaufort scale
   - Buoy / sea state (`O-B0075-001` — Chenggong station 46761F is
     confirmed working; Taitung, Hualien, and Longdong buoys are wired up
     in the code but still need their station IDs — see `BUOY_STATIONS` in
     `scripts/fetch-data.mjs`), each with 24-hour wave height/period charts
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
hourly on its own; hourly rather than every-few-hours specifically so the
8-hour station wind history actually fills in with real data points).

## Running the fetch script locally

```bash
export CWA_API_KEY=your-key-here   # PowerShell: $env:CWA_API_KEY = "your-key-here"
node scripts/fetch-data.mjs
```

This writes `data/*.json` + `data/meta.json`, and appends into
`data/stations-history.json`. Useful for checking the CWA response shapes
match what `js/app.js` expects. If a section renders "Couldn't parse this
data", the raw payload is still written to that file (extraction just
didn't find a match) — inspect it and adjust the corresponding `render*`
function in `js/app.js` or `build*` function in `scripts/fetch-data.mjs`.

## Project structure

```
index.html                   single landing page
css/style.css                dark/light theme (default dark), mobile-first, SVG charts
js/app.js                    theme toggle, EN translation of CWA's Chinese values,
                              data rendering, tide/buoy SVG line charts
scripts/fetch-data.mjs       pulls CWA Open Data, writes data/*.json
data/*.json                  latest fetched data (committed by the scheduled Action)
data/stations-history.json   rolling 8-hour wind history, appended to each run
                              (no DB — just an append-and-trim JSON log)
.github/workflows/           update-data.yml — runs the fetch script hourly
```

## Known gaps to close

- **Buoy stations**: only Chenggong (46761F) is wired up with a real
  StationID. Taitung/Hualien/Longdong buoys exist in CWA's network (seen on
  <https://www.cwa.gov.tw/V8/C/M/OBS_Marine.html>) but their exact
  `O-B0075-001` station codes still need looking up — add them to
  `BUOY_STATIONS` in `scripts/fetch-data.mjs`.
- **CWA tide deep-link**: the "Full 30-day tide forecast on CWA" link goes
  to the general tide page, not a Donghe-specific URL — that page is a
  client-side app with no shareable per-township link that was found.
- **Weather-phrase translation** (`js/app.js` `WEATHER_PHRASES`) is a
  best-effort dictionary of common CWA phrases, not official CWA English
  data — an unrecognized phrase falls back to a rough word-by-word swap
  rather than a polished translation.

## Roadmap (not in this build)

- **Phase 2** — proper database/logger for historical observations (the
  station wind history here is a stopgap, not this)
- **Phase 3** — forecast-vs-observed accuracy charts (the placeholder above)
- **Phase 5** — per-spot subpages, Jinzun/Chenggong-specific widgets, blended
  forecast, spot scoring
