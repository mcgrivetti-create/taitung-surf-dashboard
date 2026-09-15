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

1. 7-day forecast widgets:
   - Windguru (spot 218382, Donghe) — two widgets: wind (model 3, GFS 13km)
     and waves (model 84, GFS-Wave 16km — wind-only models don't carry wave
     params, so this needs a separate widget)
   - surf-forecast.com (Chengkung) — their free widget product
     (`surf-forecast.com/pages/configure_widget`, separate from the main
     site's own blocked-from-framing pages), Widget A, metric units.
     (Earlier claim that no embed existed at all was wrong — corrected.)
   - Windy — two interactive maps (wave model and wind model) on the same
     regional view: zoom 5 centred at 24.5N/123E, reaching southern Kyushu
     to the northern tip of Luzon, each with the Donghe spot-forecast panel
1b. **Open Wave Model** — an independent wave forecast from Open-Meteo's
    free Marine API (no key, backed by NOAA NCEP GFS-Wave). Doesn't depend
    on CWA or any of the widgets above, so it's a fallback that keeps
    working if one of those goes down.
2. CWA coastal 3-day / 3-hourly wave forecast for Donghe (`F-D0047-095`) —
   wave-height chart (fixed 0–3m scale, 0.5m gridlines) + wind-scale (Beaufort)
   chart, table adds computed wave energy (kJ) and wave direction
3. Other CWA data:
   - Township forecast (`F-D0047-039`, Donghe)
   - Tide forecast (`F-A0021-001`, Donghe) — interpolated line chart with a
     day pager (today/tomorrow/day-after) showing exact high/low times, a
     moon-phase widget (locally computed, no API — icon, waxing/waning
     arrow, next full/new moon date), and a link to CWA's full 30-day tide
     page
   - Station observations (`O-A0001-001` — C0S810 Donghe / C0SA30 Duli /
     C0T9I0 Fengbin), one chart card per station: 8-hour wind-scale
     (Beaufort) history + current speed/direction/scale, plus an 8-hour readings table
   - Buoy / sea state (`O-B0075-001`) — Chenggong (46761F), Taitung
     (WRA007), Hualien (46699A), Longdong (46694A) — each with 24-hour wave
     height/period charts, computed wave energy (kJ), and an 8-hour
     readings table (station codes looked up from `O-B0076-001`'s full
     station directory)
4. Forecast-accuracy tracking — placeholder; **Phase 2 logging is live**
   (see below), charts land in Phase 3 once enough history accumulates
5. Jinzun live cam (YouTube embed)
6. CWA Quantitative Precipitation Forecast — island-wide 12/24/36/48h
   rainfall accumulation images (not Donghe-specific; CWA doesn't offer a
   point-forecast QPF API, so these are the same map images from
   <https://www.cwa.gov.tw/V8/E/W/analysis.html>)

**Wave energy** (kJ, shown in the Coastal, Open Wave Model, and buoy
sections) is computed client-side from wave height + period (E = 15·H²·T),
calibrated against surf-forecast.com's own kJ figure — see "Known gaps".
**Wave-height charts** all share a fixed y-axis (0–3m with 0.5m gridlines,
stepping to 0–6m / 0–10m only when the swell needs it) so they stay
comparable at a glance.

## Phase 2: data logger (live)

Every hourly run appends into monthly log files under `data/history/` —
kept forever by design, one small file per month:

- `history/forecast/YYYY-MM.json` — CWA coastal (`F-D0047-095`) and
  Open-Meteo snapshots at fixed lead times (6h/24h/72h ahead), tagged with
  `issuedAt`/`targetTime`/`leadHours`/`source`
- `history/buoy/YYYY-MM.json` — actual buoy readings (one record per
  station per run)
- `history/tide/YYYY-MM.json` — tide forecast (interpolated at the time of
  the run) vs. observed, from the Chenggong tide gauge (`C4S02`, looked up
  from `O-B0076-001`'s station directory)

This is the ground truth Phase 3's accuracy-comparison charts will read
from — see `scripts/fetch-data.mjs`'s "Phase 2" section (`appendMonthlyHistory`,
`buildTideGaugeActual`, the lead-time snapshot logic in `run()`).

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
data/history/{forecast,buoy,tide}/YYYY-MM.json
                              Phase 2 logger — kept forever, see "Phase 2" above
.github/workflows/           update-data.yml — runs the fetch script hourly
```

## Known gaps to close

- **CWA tide deep-link**: the "Full 30-day tide forecast on CWA" link goes
  to the general tide page, not a Donghe-specific URL — that page is a
  client-side app with no shareable per-township link that was found.
- **Weather-phrase translation** (`js/app.js` `WEATHER_PHRASES`) is a
  best-effort dictionary of common CWA phrases, not official CWA English
  data — an unrecognized phrase falls back to a rough word-by-word swap
  rather than a polished translation.
- **Windguru wind+wave in one table**: confirmed not possible through
  their embeddable widget — tested directly (a model that has wind data
  silently drops wave params and vice versa) and confirmed by Windguru's
  own widget-distribution docs. The combined "WG" table only exists on
  their full interactive site. Two separate widgets (wind + waves) is the
  closest equivalent; the Coastal and Open Wave Model charts on this page
  are the real substitute.
- **Wave energy (kJ) calibration** (`js/app.js` `wavePowerKw`): fit to
  surf-forecast.com's displayed values for Chengkung (k=15 in E=k·H²·T)
  from six sample rows on 2026-09-14, not their actual internal formula
  (unknown, and doesn't derive cleanly from a single height/period pair —
  likely sums multiple swell components). Same scale and trend, not an
  exact match hour-to-hour. Now that their widget is embedded directly,
  the two can be compared side by side on the page.

## Roadmap (not in this build)

- **Phase 3** — forecast-vs-observed accuracy charts, reading from the
  Phase 2 logs above (the placeholder in the page)
- **Phase 5** — per-spot subpages, Jinzun/Chenggong-specific widgets, blended
  forecast, spot scoring

## Deploying a css/js change

GitHub Pages serves static assets with `Cache-Control: max-age=600`, so a
returning visitor can keep running the old `app.js`/`style.css` for up to
10 minutes after a push — which looks exactly like "the fix didn't work".
`index.html` references both with a `?v=` query string; **bump it when you
change either file** and the new version takes effect immediately.
