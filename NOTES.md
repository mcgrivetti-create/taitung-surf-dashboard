# Project notes — Formoswell

Decisions and background that aren't obvious from the code. Copied on
2026-11-16 from Claude's per-computer memory so they travel with the repo.
**Claude: read this before changing the site, and treat the decisions here as
settled — ask before reversing one.** Add to it when a new decision is made.

## Working on this project

- Everything lives in GitHub (`mcgrivetti-create/taitung-surf-dashboard`):
  code, `data/` (committed by the data job), and the `CWA_API_KEY` secret.
  The site is GitHub Pages from `main`.
- New computer: install Git, `git clone https://github.com/mcgrivetti-create/taitung-surf-dashboard.git`
  to a folder **outside OneDrive** (OneDrive sync and Git corrupt each other
  when two machines share one folder).
- The bot commits data every ~20 min, so always `git pull --rebase` before
  starting and before pushing.
- The owner prefers questions one at a time, multiple-choice or short answer.

## Data job (`.github/workflows/update-data.yml`, `scripts/fetch-data.mjs`)

- Triggered by **cron-job.org** (job "updates", owner's account) at :13 and
  :33 Asia/Taipei, via `workflow_dispatch`
  (`POST .../actions/workflows/update-data.yml/dispatches`, body `{"ref":"main"}`).
  Set up 2026-10-20 because GitHub's own cron skipped most runs (gaps of
  4–5 h). The GitHub `:05`/`:35` schedule stays as a fallback; it skips itself
  if data is under 40 min old. `workflow_dispatch` always runs.
- Token: fine-grained "cron-job formoswell", this repo only, Actions
  read+write, **expires 2027-10-20**. The `X-GitHub-Api-Version: 2022-11-28`
  header is deprecated, **sunset 2028-03-10** — update it on cron-job.org
  before then.
- CWA timing: land stations post ~10–11 min after the hour; buoys ~30–31 min.
- A failed source keeps its previous file; the job exits 1 (failure email)
  if any source failed. Open-Meteo fetches retry with backoff (`omFetch`)
  since api.open-meteo.com started dropping GitHub-runner connections on
  2026-11-13.

## Dashboard (`index.html`, `js/app.js`, `css/theme.css`)

Reorganised 2026-10-13 after a friend's site, WaveSlave (https://waveslave.tw,
derived from this one), showed this one had "too much info". Don't copy
WaveSlave's code verbatim; build our own versions of its features.

- Top: always-visible **Right now** card (Chenggong buoy, Donghe wind +
  offshore call, Donghe tide now/next, sun) + a **5-day** strip (was 3; rows
  tap open a day detail: Dawn/Midday/Evening, CWA vs ECMWF with ✓ for
  closer-lately from 7-day stats, nearest tide turn, day chart with
  rating-coloured bars, period on each bar, wind arrows — **no colour key**).
- No water temp/wetsuit (declined).
- Every section collapsed on **every** visit (no remembering); each bar shows
  title + a generated summary. Order: Typhoon, Forecasts, Tide, Observations,
  Buoys, Forecast Check, Rain, Live cam. Sticky header buttons: Forecasts ·
  Tide · Observations · Buoys · Forecast Check (open + scroll), plus Map.
- Ratings: WaveSlave's Poor/Fair/Good/Firing rules (period ×1.3 inside
  scoring only). Labels Flat / Poor / Fair / Good / "Drop everything and go
  now!!!". Per-day "Best window" — **never call it "Primo"**. Periods shown
  as "1.2 m @ 7.6 s".
- Typhoon line counts only storms active by **our** retirement definition;
  says swell yes/no + date, tail "· N areas being watched".
- Buoy trend: 12 h, avg first 3 vs last 3 readings; height threshold
  **0.3 m**, period 1 s.
- Observations wind in **knots**: light < 8, moderate 8–16, strong > 16;
  trend ±3 kt vs ~3 h.
- Forecast sentence: tomorrow vs today (20% size, 1 s period) + models
  agree (≤ 0.3 m) / some spread (≤ 0.6) / split.
- Rain line: "Today: X% chance of rain · Tonight: Y%…", amount only when a
  QPF band covers Donghe (no "none expected").
- Offshore-early call: CWA dawn-speed rule (scored 11/14, Oct 16–29); ECMWF
  light-N rule (N–NW < 6 kt likely, NNE–E not) only on days CWA doesn't
  reach (9/14).
- Longer-period tag: avg(Open-Meteo, ECMWF mean period) ≥ 9.5 s "long",
  ≥ 9 s "longer".
- Dawn call (Right now, 20:00–08:00): from Donghe station wind since 19:00.

### Analysis findings (Sep 14 – Oct 29 logs)

- Donghe wind: offshore share 75–80% at 03–06, 62% 07, 46% 08, 26% 09,
  ~0 10–17, rebuilds after 18. On offshore dawns, onshore (≥ 3 kt E-sector)
  arrives median 11:00 (9–14). Calm (< 4 kt) or offshore evening →
  next dawn offshore ~26/30.
- Speed bias at 24 h: CWA +4 kt dawn, +7 midday, +9 evening; ECMWF ±1;
  GFS +2–3. CWA almost never forecasts NW.
- Period: Chenggong buoy mean period runs ~0.8× model mean period. Best
  predictors Open-Meteo and ECMWF mean period (r 0.84); swell-partition
  periods poor; GFS-Wave +4 s, useless.

## Look and name

- Name **Formoswell**; subtitle "Donghe · Taitung". Icon "Peaks & swell"
  (sun behind ridges + swell lines), since 2026-10-21; the old seal logo
  looked too like WaveSlave (kept in `design/logo/retired-seal/`).
- Theme **Mountain Mist** (launched 2026-10-14, `css/theme.css`): light
  default + night mist toggle; the map stays neon. Numbers in sans (mincho
  digits are uneven); day names never wrap.
- Other theme mock-ups (Lantern, Night Session, Endless Summer, Tide Chart,
  Outrun, Coast Weave): https://claude.ai/artifact/TuduKcESfDnmUTrAUnVZpx

## Surf map (`js/map.js`, `css/map.css`, `data/wxgrid.json`)

- Launched 2026-10-13. WaveSlave-style weather map (wind/waves/swell layers,
  animated wind lines, day time bar + play) over 0–45N 100–160E on a 3°
  Open-Meteo grid, refreshed 6-hourly. Opens on Taiwan + the sea to the east;
  no grid lines.
- Opens full screen from the header Map button with an X to close.
  Open/close effect: barrel wave in, whitewater close-out out.

## Forecast Check (`accuracy.html`, `js/accuracy.js`)

Launched 2026-10-07. Tabs Waves / Wind / Tide / Typhoon swells, each Live +
Accuracy history.

- Label Météo-France MFWAM as **"Open-Meteo"** in the UI.
- Groundswell rule-of-thumb overlay = buoy period × **1.3** (not 1.5);
  scoring uses the raw buoy period.
- CWA forecast stays **Donghe only** (Taitung City point rejected). Models
  are also logged at the buoy positions (`site` records, since 2026-10-06).
- Each tab opens with a generated 2–3 sentence summary (templates, no LLM).
  A source needs ≥ 72 matched hours to be called "most accurate".
- Air pressure logged only to explain tide gauge-vs-prediction gaps.
- Bias-corrected forecast: proposed, **skipped** for now.
- Typhoon retirement rule (trial since 2026-10-07): retire after 2
  consecutive warnings that are receding + ≥ 28N + swell verdict "none".
  Owner will report misses.
- Phase 4 = the owner's own surf-session log. Don't backfill past wind
  forecasts.
- Mock-ups: waves https://claude.ai/artifact/TF5Wq5KcUBy3vWpnp7AiSP,
  tide https://claude.ai/artifact/9PxXp7Tz3YUqJnnKwDj14c, offshore mornings
  https://claude.ai/artifact/HSJ8HoBr8hNZ9bNGzagjMA
