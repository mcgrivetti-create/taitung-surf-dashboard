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
   - **Sunrise/sunset, moonrise/moonset and CWA's daily astronomical
     calendar** for Taitung County, under the tide chart — see below
   - Tide forecast (`F-A0021-001`, Donghe) — interpolated line chart with a
     day pager (‹ › buttons **or a horizontal swipe/drag on the chart**)
     showing exact high/low times, on a **permanently fixed −100…+150cm axis
     with 50cm gridlines and vertical 0600/1200/1800/2400 lines**, so the
     curve's shape means the same thing every day and the chart never
     rescales (Donghe's biggest spring tides in the CWA data run about
     −45…+100cm, well inside that), a
     **dawn surf-window line** under the time axis giving the interpolated
     height at 06:00 and 08:00 with a rising/falling read, a
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
  Phase 2 logs above (the placeholder in the page). Live, not a periodic
  batch — see "Two tiers, deliberately" for which files it may read.
- **Copernicus Marine / Mercator wave model — agreed 2026-09-18, to be
  built after Phase 3.** Product `GLOBAL_ANALYSISFORECAST_WAV_001_027`
  (Global Ocean Waves Analysis and Forecast): MFWAM run by Météo-France,
  forced by ECMWF winds, 1/12° (~9km), 3-hourly, 10-day horizon.

  Why it's worth the dependency: it carries **partitioned swell** — wind
  wave, primary swell and secondary swell as separate fields — which is the
  one thing no current source gives us, and the difference between reading
  "1.5m" and reading "1.5m of 13s groundswell under 0.5m of windslop". It's
  also ECMWF-forced, so genuinely independent of NOAA GFS-Wave (which backs
  both Windguru and our Open Wave Model) rather than a correlated fourth
  copy. Building it after Phase 3 means it can be scored against the buoys
  from day one.

  Integration cost, eyes open: Copernicus serves NetCDF through the
  `copernicusmarine` Python toolbox, not JSON over HTTP, so the workflow
  gains a Python step beside the Node one — the project's first real
  dependency, plus credentials (two repo secrets) that can expire and a
  library that can break on a version bump. Subset one grid point at
  Donghe and write a small JSON in the same shape as `openwave.json`;
  everything downstream already takes that shape. The licence requires
  visible attribution on the page.
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

## Direction display

Observations arrive as bearings (`"37.0"`), forecasts as Chinese compass
text (`偏北風`). Both are rendered as **16-point compass letters plus a
rotated arrow** — `degToCompass()` for bearings, `translateDirText()` for
the Chinese. Degrees are no longer shown anywhere: the extra precision
isn't readable at a glance, and "NNE" is the form you think in. The arrow
points the way the wind/swell is *travelling* (bearing + 180°), matching
Windy's convention.

## Sun, moon and astronomical calendar

Under the tide chart, from CWA's own per-year astronomy files
(`buildAstronomy` in `scripts/fetch-data.mjs`) → `data/astronomy.json`:

- `https://www.cwa.gov.tw/Data/js/astronomy/astronomy_TaitungCounty_<year>.js`
  — sunrise/sunset + azimuths, solar noon, civil/nautical/astronomical
  twilight, moonrise/moonset
- `https://www.cwa.gov.tw/Data/js/astronomy/astronomy_day_<year>.js`
  — lunar date, solar term, and the daily astronomical phenomena, with
  CWA's **own English** in `st.E` so nothing needs translating

**Why not the Open Data API:** its astronomy topic carries only two
datasets — `A-B0062-001` (sunrise/sunset) and `A-B0063-001` (moonrise/
moonset). There is no calendar-of-phenomena dataset at all, and neither
carries twilight times. The files above are what the 每日天文現象 page
itself reads, need no API key, and cover everything in one fetch.

**Tradeoff:** they're undocumented internal files and could move or change
shape without notice. Every step fails soft — a bad fetch or parse leaves
the previous `astronomy.json` in place, and the page omits the section
rather than erroring. They're parsed (quote-normalised then `JSON.parse`),
never `eval`'d.

They cover a whole year and change once a year, so `buildAstronomy`
refetches only when the stored 14-day window no longer covers today,
rather than pulling ~140KB an hour for data that hasn't moved. Solar terms
and lunar dates are translated client-side (`SOLAR_TERMS_EN`,
`translateLunarDate`); most days have no solar term and no phenomenon, and
those lines simply don't render.

## "Last update / Next update" per forecast

Neither CWA's saved payloads nor Open-Meteo tell us when a model run was
issued. What is observable is when the *content* changes: `buildUpdateLog`
hashes each dataset every run and records the moment the hash differs —
that is the new run landing. `data/update-log.json` keeps the last few
change times per source, and the median gap between them gives the
cadence, so nothing about CWA's or NOAA's schedule is hardcoded and it
self-corrects if they change it.

The page prints `Last update: HH:MM · Next update: ~HH:MM` under each
forecast. The next time is marked `~` because it's inferred; a prediction
that has already passed shows "due now" rather than a stale time, and a
last-change on an earlier day carries its weekday. Until two changes have
been observed there's no cadence yet and only the last update shows.

## Typhoon News

A panel at the top of the page, rendered **only** when JTWC has an active
Western Pacific system or invest — hidden entirely otherwise, so a quiet
season costs nothing. `buildTyphoon` in `scripts/fetch-data.mjs` →
`data/typhoon.json`.

**Detection is JTWC's RSS feed, not the CWA homepage.** The feed is
machine-readable, lists every active system, and already formats the
headline exactly as we display it — `Tropical Storm 24W (Dujuan)` — so no
designation has to be derived from wind speed and no storm number has to be
guessed. That last point matters: **JTWC's number is its own sequence and
does not reliably equal CWA's 編號** (they happen to both be 24 for Dujuan),
so the warning-graphic URL is taken straight from the feed rather than
constructed.

Per system the panel shows the headline, warning number and issue time, the
**JTWC TC Warning Graphic**, the **CWA 96h track forecast**, and links to
JTWC, the raw warning text and CWA's typhoon page.

- **Scope:** every Western Pacific system, including the South China Sea and
  storms far from Taiwan — a typhoon heading for Japan is exactly what sends
  groundswell to this coast. The feed's NW Pacific item also covers the Bay
  of Bengal and Arabian Sea, so anything whose product file isn't `wp…` is
  dropped.
- **Invests** come from ABPW10 section 1 (`TROPICAL DISTURBANCE SUMMARY`).
  That's a free-text military bulletin, so the parse is best-effort by
  design — it pulls the designators and stated development potential, and
  the full advisory is always linked so nothing depends on it being
  complete.
- **CWA track image** is a best-effort extra: its filename embeds the
  synoptic issue time (`PTA_<YYYYMMDDHHMM>-96_<NAME>_enus.png`), so the last
  five 6-hour slots are probed and the first that exists wins. CWA issues
  ~1.5–2h after synoptic time, which is why probing backwards is necessary.
  A system CWA isn't tracking simply has no track image.
- **Images are hotlinked**, verified loading cross-origin from both sources.
  The JTWC gif URL is stable per storm and rewritten in place each cycle, so
  the issue time is appended as a cache-buster. The CWA filename already
  carries its timestamp.
- **Staleness:** judged on the newest JTWC *issuance*, not on our fetch time
  — a successful fetch of a feed nobody has updated is still stale news.
  JTWC warns every 6h, so past 12h (`TYPHOON_STALE_HOURS`, two missed
  cycles) the panel carries an explicit notice instead of presenting itself
  as current.
- A standing italic line states this is not an official warning source and
  links CWA and JTWC as the authorities.

### Typhoon detail — the deterministic layer

Everything below is **parsed, not generated**. JTWC's warning text is rigidly
structured, so position, movement, intensity, pressure, seas and the forecast
points at every tau are read straight out of it — no language model is
involved anywhere in this feature.

Per cycle, `enrichSystem` pulls:

- **`…web.txt` (warning)** — current position and 6-hour movement, max wind
  and gusts, minimum central pressure, **maximum significant wave height**
  (directly surf-relevant), forecast lat/lon/intensity at +12…+120h, the
  geographic reference ("175 NM EAST OF IWO TO"), any
  DOWNGRADED/UPGRADED note, and the explicit list of next warning times.
- **`…prog.txt` (prognostic reasoning)** — JTWC's own
  **`SIGNIFICANT FORECAST CHANGES`** field, quoted verbatim rather than
  paraphrased; forecast confidence for track and intensity; the forecaster's
  environment assessment (VWS, SST, outflow); and the steering mechanism.

Derived locally:

- **Distance and bearing from Donghe**, plus the **closest approach** across
  the whole forecast track and when it occurs — e.g. Dujuan at 2,363km
  closing to 1,852km at +36h before receding to 4,636km. A storm that only
  ever gets further away is labelled as tracking away rather than being
  given a misleading "closest" figure.
- **Cycle-over-cycle deltas** against the previous archived warning:
  intensity, pressure, seas, closest-approach, and track shift. Track shifts
  compare forecast positions **sharing a valid time**, so a shifting tau
  can't masquerade as the storm moving.

**`data/history/typhoon/YYYY-MM.json` archives every cycle.** JTWC
overwrites its product files in place and keeps no history, so a cycle not
captured is gone permanently — this logs from day one, and it's what makes
the diff possible at all.

**Two honesty mechanisms.** The prognostic reasoning routinely lags the
warning by a cycle (and can still say "Typhoon" after a downgrade), so both
warning numbers are recorded and the page tags the forecaster note with the
warning it came from. And the invest block carries JTWC's basin-wide
advisory satellite image — there's no per-invest graphic — so a disturbance
can be eyeballed for organisation rather than judged from a letter code.

### Track turns

`motionOutlook` derives where the storm changes direction from the forecast
points already parsed — nothing is scraped from JTWC's prose. Each leg's
heading is the bearing between consecutive forecast positions; a leg whose
heading has swung ≥35° from the running reference counts as a turn and
becomes the new reference, so a long recurve reads as a sequence rather
than one blur. 35° is deliberately coarse so 6-hourly wobble doesn't
register.

The reference starts from JTWC's stated past-6h movement where available,
not the first forecast leg — otherwise a storm already mid-turn reads as
travelling straight. Rendered as `Turning NW 24–36h · NNE 48–60h · NE
72–96h`, capped at three turns; a storm that never turns says so instead.

### Swell arrival

A plain reading of the Open-Meteo swell series, rendered as a sentence:

> Swell expected to arrive Sun, Sep 20, 11:00 (0.9m, 10.4s from E) and grow
> to 1.8m, 8.5s by Mon, Sep 21, 08:00

`detectSwellArrival` takes **arrival** as the first point where the swell
period steps clearly above its current baseline (>=2s over the median of the
first 6h, and >=10s so windsea doesn t qualify), and **peak** as the largest
swell height after that. The period used is always whatever the model
actually shows — never a hardcoded figure.

Each height is quoted with **its own** period. They differ (10.4s at arrival
vs 8.5s at the peak) because the long-period forerunner lands first and the
sea shortens as the swell builds; quoting the arrival period against the
peak height would overstate what the peak looks like.

An earlier version also showed a great-circle estimate from deep-water group
velocity. It was dropped: it disagreed with the model by ~34h for Dujuan
(dispersion again — the first energy travels faster than the period
eventually reported), and a second, worse number beside a spectral model s
answer was more confusing than useful.

**Attribution matters with more than one storm.** The swell is credited to a
system only when the swell bearing is within 45 degrees of that storm s
bearing from Donghe, and to the closest match if several qualify. For Dujuan
the offset is 6 degrees. A swell arriving from a direction no active storm
explains is left unattributed rather than pinned on whichever storm happens
to be listed first.

**Times are pinned to Asia/Taipei**, not device-local, so JTWC s Zulu
timestamps and the swell times read as Donghe times even when the page is
opened from elsewhere.

### Invest tracking

Invests — disturbances JTWC is watching but not yet warning on — come from
ABPW10 section 1 (`TROPICAL DISTURBANCE SUMMARY`), scoped to section 1
because section 2 is the South Pacific and carries an identically-named
subsection.

Parsed per invest: designator, position, distance and bearing from Donghe,
JTWC's geographic reference, estimated wind range, minimum pressure, and
the stated 24-hour development potential (LOW / MEDIUM / HIGH). The
basin-wide advisory satellite image is shown alongside, since JTWC publishes
no per-invest graphic.

**The bulletin hard-wraps at ~70 columns, splitting values mid-token** —
`NEAR 5.7N \n146.1E` is one coordinate pair. Whitespace is normalised per
paragraph before any field is matched; without that every regex breaks at a
line end. The parser was written and tested against a real bulletin
containing a live invest (ABPW10 of 2023-05-17, Invest 97W), not against
the empty `NONE` state, since a parser validated only against "nothing here"
is a parser that has never been tested.

**Invests are archived into the same monthly file as the warnings**, tagged
`kind: "invest"` versus `kind: "warning"`, deduped by advisory issue time
since they carry no warning number. That's what records the pre-development
phase: 90W appearing as a disturbance, then the same area becoming 24W once
warnings begin. The designators differ, so lineage is read rather than
joined automatically — but having both series in one place is what makes
reading it possible at all.

### Formation alerts (TCFA)

Between "an area we're watching" and a numbered warning, JTWC issues a
**Tropical Cyclone Formation Alert** when formation looks likely within
12–24h. These appear in the same RSS item as the warnings but in their own
block — headed `Tropical Cyclone Formation Alert WTPN21`, with **no warning
number**, which is exactly why the warning parser skipped them.

`parseTcfaText` reads the alert product (`wp<nn><yy>web.txt`) for: the
invest designator, the corridor where formation is expected (a line plus a
±NM width), the formation window, the circulation centre with distance and
bearing from Donghe, movement, estimated winds, pressure, development
potential, and the **deadline by which the alert is upgraded, reissued or
cancelled** — which is the most actionable field, since it tells you when
the next decision lands.

Correcting an earlier note in this file: an alerted invest **does** get its
own graphics — a TCFA graphic (`wp<nn><yy>.gif`) and a per-system IR image
(`91W_220400sair.jpg`). The basin-wide advisory picture is only the fallback
for a disturbance with no alert.

Alerts archive alongside warnings and invests as `kind: "tcfa"`, deduped by
issue time, completing the lineage: disturbance → formation alert →
numbered warning.

### Two parser bugs live data found

Both were in the invest parser, written against a single 2023 bulletin and
shipped before any real invest existed to test it:

1. **Wrong position.** A first sighting reads `HAS PERSISTED NEAR x`, but a
   follow-up reads `PREVIOUSLY LOCATED NEAR x IS NOW LOCATED NEAR y`. The
   regex matched the first `NEAR` and so reported the **old** position —
   91W was placed 1490nm out on a bearing of 114° when it was actually at
   12.5N 141.9E. `IS NOW LOCATED NEAR` is now tried first.
2. **Potential always null.** The sample said `... HOURS IS LOW`; live text
   said `... HOURS REMAINS HIGH`. Now matches `IS|REMAINS`.

Neither would have surfaced without a live invest. Worth remembering for
the paths still untested against real data — multi-storm layout among them.
