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
2. CWA coastal 3-hourly wave forecast for Donghe (`F-D0047-095`), **capped
   at 72 hours ahead** — CWA sends 96h (33 points; the "3-day" dataset
   reliably carries a fourth), trimmed by time rather than count so the
   horizon stays fixed as the day advances —
   wave-height chart (fixed 0–3m scale, 0.5m gridlines) + wind-scale (Beaufort)
   chart, table adds computed wave energy (kJ) and wave direction.
   The same forecast for Chenggong is fetched to
   `data/coastal-chenggong.json` and logged, but deliberately **not**
   displayed — the page is single-spot by choice.
3. Other CWA data:
   - Township forecast (`F-D0047-039`, Donghe)
   - Tide forecast (`F-A0021-001`, Donghe) — interpolated line chart with a
     day pager (‹ › buttons **or a horizontal swipe/drag on the chart**)
     showing exact high/low times, on a **permanently fixed −100…+150cm axis
     with 50cm gridlines and vertical 0600/1200/1800/2400 lines**, so the
     curve's shape means the same thing every day and the chart never
     rescales (Donghe's biggest spring tides in the CWA data run about
     −45…+100cm, well inside that), a
     moon-phase widget (locally computed, no API — icon, waxing/waning
     arrow, next full/new moon date), and a link to CWA's full 30-day tide
     page
   - Station observations (`O-A0001-001` — C0S810 Donghe / C0SA30 Duli /
     C0T9I0 Fengbin), one chart card per station: 16-hour wind-scale
     (Beaufort) history + current speed/direction/scale, plus a 16-hour readings table
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
comparable at a glance. **Wind-scale charts are pinned at Beaufort 1–10 and
never rescale at all** — `clampScale()` holds readings inside that range
rather than letting them stretch the axis, so a force 11 draws on the 10
line. Two consequences worth knowing: a dead-calm Beaufort 0 draws on the
floor at 1, and in light winds (1–2, which is most days here) the line sits
low and flat. The tables and the "Scale" stat always show the true number.
Wave-period charts use 0–10s with 2s gridlines, stepping to 0–20s for a
long-period groundswell.

**Chart conventions** (`lineChartSVG` in `js/app.js`):

- every horizontal gridline is **labelled with its value to the left of the
  y-axis**, and every displayed number is rounded to one decimal (`n1()`)
- forecast charts put their time ticks on the 6-hour clock face starting at
  **now** — now, then 0600/1200/1800/2400 (`sixHourTicks`). Past a 48h span
  the step doubles to 12-hourly so the labels don't collide at phone width,
  and a boundary tick landing within a third of a step of "now" is dropped
  (otherwise the 72h chart printed "now"/"1101" and "1200" seven pixels
  apart). Observation-history charts run the same clock face backwards and
  label the right edge "now" (`historySixHourTicks`). Exception: the 5-day
  Open Wave Model chart uses daily ticks, since 6-hourly would be 20 labels.

## Phase 2: data logger (live)

Every hourly run appends into monthly log files under `data/history/` —
kept forever by design, one small file per month. Lead times tracked:
**6h / 12h / 24h / 48h** (`LEAD_HOURS`).

- `history/forecast/YYYY-MM.json` — forecast snapshots at each lead time,
  tagged `issuedAt`/`targetTime`/`leadHours`/`source`. Four sources:
  - `cwa_coastal_donghe` — `F-D0047-095`, wave height/period/direction +
    wind speed/Beaufort/direction
  - `cwa_coastal_chenggong` — the same dataset for 成功鎮沿海. **Collected
    and logged but deliberately not shown on the page** — the page stays
    single-spot. It's here so a future chart can run observed-up-to-now +
    forecast-into-the-future against the Chenggong buoy.
  - `open_meteo` — wave and swell height/period/direction
  - `cwa_township_wind` — `F-D0047-039` wind for Donghe. This forecast is
    12-hour *periods*, not instants, so a lead time is matched by which
    period contains it (`periodContaining`), not by nearest point.
- `history/buoy/YYYY-MM.json` — actual buoy readings (one record per
  station per run): wave height/period/direction, sea temperature, plus
  wind speed/scale/direction/gust where the station has an anemometer
  (Chenggong 46761F has none — it reports waves, wave direction, period
  and sea temperature only, so its wind fields log as null)
- `history/station/YYYY-MM.json` — actual land-station wind (one record per
  station per run), the ground truth for `cwa_township_wind`. Donghe
  `C0S810` is flagged `isWindForecastTarget`. Separate from
  `data/stations-history.json`, which is trimmed to a rolling 16h for the
  chart — this one is permanent.
- `history/tide/YYYY-MM.json` — tide forecast (interpolated at the time of
  the run) vs. observed, from the Chenggong tide gauge (`C4S02`, looked up
  from `O-B0076-001`'s station directory)

Two things to know when reading the logs back:

- **`cwa_coastal` is a legacy source name.** Records written before
  2026-09-16 use it for what is now `cwa_coastal_donghe`; the old records
  were left as-is rather than rewritten. Treat the two as the same series.
- **Numbers are numbers.** CWA returns buoy readings as strings (`"2.0"`)
  and uses `"None"` for missing ones; `cleanNone()` coerces to a real number
  or `null` at log time, so every log stores the same types. Buoy records
  written before 2026-09-16 still hold strings.

**Directions** are logged two ways. CWA gives forecast directions as Chinese
compass text (`偏北風`, `東北`) while observations give bearings (`28.0`),
so `dirToDegrees()` converts the text to a 16-point bearing at log time and
both `*DirectionText` and `*DirectionDeg` are stored — Phase 3 can subtract
the bearings to get an angular error, and the text stays for display.

This is the ground truth Phase 3's accuracy-comparison charts will read
from — see `scripts/fetch-data.mjs`'s "Phase 2" section (`appendMonthlyHistory`,
`buildTideGaugeActual`, the lead-time snapshot logic in `run()`).

### Two tiers, deliberately — don't merge them

Each hourly run writes to **both** of these, and they serve different jobs:

| | Current files (`data/*.json`) | History logs (`data/history/`) |
| --- | --- | --- |
| Shape | overwritten each run | appended each run, kept forever |
| Span | last 24h observed + forecast ahead | months |
| Size | tens of KB | megabytes and growing |
| Read by | the live page, on every load | accuracy charts, on demand |

**The live Phase 3 chart — observed up to now, forecast extending forward —
must read the current files, not the history logs.** `data/buoy.json`
already holds the last 24h of observations, which is exactly the observed
side of that chart. Pointing it at the monthly logs instead would make the
page download several MB to draw one day. Decided 2026-09-16; keep the
accuracy charts' bulk loading only when that section is opened.

Phase 3 is **live, not a periodic batch**: the chart redraws from the latest
files on every page load. The practical ceiling is hourly — CWA's buoys
report once an hour and the forecast models regenerate every 6–12 hours, so
there is nothing more frequent to show.

## Data freshness (why the page tells you its own age)

The page renders whatever is sitting in `data/*.json`. If the hourly Action
stops working — expired CWA key, a CWA schema change, GitHub disabling the
cron — the page keeps rendering the last good numbers and **looks completely
normal**. That's the dangerous failure: you read two-week-old wave heights
and believe them.

So `renderFreshness()` in `js/app.js` states the age outright, keyed to the
hourly refresh:

| Age | Header | Banner |
| --- | --- | --- |
| < 4h | `Updated 9/16, 10:19 (30 min ago)`, normal colour | none |
| 4–12h | amber, `⚠` prefix | amber — "hasn't run recently, treat with caution" |
| > 12h | red, bold | red — "has stopped, don't use this to judge conditions" |
| `meta.json` won't load | red, "Update status unknown" | red — can't determine age |

A *partial* failure (the run succeeded but a source errored) shows a banner
naming the failed sources even when the data is otherwise current — those
sections alone are stale. Sources that report `ok: false` with no `error`
are ignored here: that means the fetch worked but matched nothing, and it
already writes its raw payload for inspection.

### Testing the stale states locally

They only appear when data is genuinely old, so to see them you need to
stub `meta.json`. There's no build step and no Node on the author's machine,
so serve the folder over HTTP (`file://` breaks relative script loading) —
any static server works, e.g. PowerShell's `System.Net.HttpListener`. Then
load a page that defines a `window.fetch` stub returning a fabricated
`updatedAt` **before** the `<script src="js/app.js">` tag, so the real
`renderFreshness()` runs against it.

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
16-hour station wind history actually fills in with real data points).

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
data/stations-history.json   rolling 16-hour wind history, appended to each run
                              (no DB — just an append-and-trim JSON log)
data/history/{forecast,buoy,station,tide}/YYYY-MM.json
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

GitHub Pages serves everything with `Cache-Control: max-age=600` — and that
includes `index.html` itself. This matters more than it sounds: a `?v=`
cache-buster on the assets only helps if the browser re-fetches
`index.html`. When it doesn't (a tab left open, bfcache, mobile heuristics),
the stale HTML keeps requesting the stale `?v=`, and the visitor runs old
code indefinitely — seeing bugs that were fixed days ago. This bit us
repeatedly before it was diagnosed, most visibly when a fixed buoy section
kept showing `heightSVG is not defined` hours after the fix was live.

Pages doesn't allow custom headers, so the fix is in three parts. **Bump all
three together on any css/js change:**

1. `?v=` on both `<link>` and `<script>` in `index.html`
2. `ASSET_VERSION` at the top of `js/app.js`
3. `"assets"` in `version.json`

`version.json` is fetched with `cache: "no-store"`, so it is always current
even when `index.html` is not. `selfHealStaleAssets()` compares it against
the version compiled into the running `app.js`; if they differ, this page
*is* the stale copy, so it reloads once with a `_v=` query that forces a
fresh `index.html`. A `sessionStorage` guard caps it at one reload per
session — so if you forget to bump one of the three, the cost is a single
wasted reload, never a loop. `index.html` also carries `no-cache`
`http-equiv` meta tags as a first line of defence.

To force a refresh by hand: Ctrl+Shift+R (Cmd+Shift+R on macOS).
