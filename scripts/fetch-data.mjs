#!/usr/bin/env node
/**
 * Fetches CWA (Central Weather Administration) Open Data for the
 * Taitung Surf Dashboard and writes trimmed JSON files into data/.
 *
 * Requires the CWA_API_KEY environment variable (see README.md for
 * how to obtain a key and wire it up as a GitHub Actions secret).
 *
 * Datasets used:
 *   F-D0047-039  Township forecast (Taitung County, 1 week)   -> data/township.json
 *   F-D0047-095  Coastal 3-day / 3-hourly forecast             -> data/coastal.json
 *                and, logged but NOT shown on the page, the same forecast
 *                for Chenggong                                 -> data/coastal-chenggong.json
 *                (the page stays single-spot; Chenggong is collected so
 *                Phase 3 can chart it against the Chenggong wave buoy)
 *   F-A0021-001  Tide forecast (next 1 month)                  -> data/tide.json
 *   O-A0001-001  Automatic weather stations (latest snapshot)  -> data/stations.json,
 *                accumulated into a rolling 16-hour history at data/stations-history.json
 *                (this dataset has no history endpoint of its own, so the
 *                Action's own run history builds it up over time — see
 *                buildStationsHistory)
 *   O-B0075-001  48hr buoy/tide-station sea-state monitoring   -> data/buoy.json
 *                (O-B0076-001 was tried first but is just a station
 *                directory — no live readings — so this replaces it)
 *   Open-Meteo Marine API (no key, Météo-France MFWAM)          -> data/openwave.json
 *                Independent of CWA and the commercial widgets —
 *                a fallback wave forecast that isn't tied to any of them.
 *   Open-Meteo ECMWF WAM waves + IFS wind (no key)              -> data/ecmwf.json
 *                The models behind Windy's default layers — logged only,
 *                as the recordable stand-in for Windy (see buildEcmwf).
 *
 * Each dataset is fetched in full and then trimmed down client-side to
 * just the records relevant to Donghe / Chenggong, so a mismatch in a
 * server-side filter parameter can't silently return an empty result.
 * If extraction finds nothing, the raw payload is kept so it can be
 * inspected later, and the failure is recorded in data/meta.json.
 *
 * Phase 2 (data logger): each run also appends into monthly log files
 * under data/history/ — kept forever by design, one small file per month:
 *   history/forecast/YYYY-MM.json  forecast snapshots at fixed lead times
 *                                   (LEAD_HOURS), tagged by `source`:
 *                                   cwa_coastal_donghe, cwa_coastal_chenggong,
 *                                   open_meteo, ecmwf, gfs_wind, gfs_wave,
 *                                   cwa_township_wind
 *   history/buoy/YYYY-MM.json      actual buoy readings (one per station
 *                                   per run) — waves, wave direction, and
 *                                   wind where the station has an anemometer
 *   history/station/YYYY-MM.json   actual land-station wind (one per station
 *                                   per run) — ground truth for the township
 *                                   wind forecast, and permanent unlike the
 *                                   rolling 16h data/stations-history.json
 *   history/tide/YYYY-MM.json      every Chenggong gauge reading (cm) vs the
 *                                   tide prediction at that reading's own time
 *
 * Forecast directions arrive as Chinese compass text and observed ones as
 * bearings, so every logged direction carries both (dirToDegrees).
 * This is the ground truth Phase 3's accuracy-comparison charts read from.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const API_KEY = process.env.CWA_API_KEY;
if (!API_KEY) {
  console.error("Missing CWA_API_KEY environment variable.");
  process.exit(1);
}

// CWA serves some datasets through the newer per-query REST datastore, and
// others — typically large bulk/combined datasets — only through the older
// file-download API. We don't know in advance which one a given dataset
// needs, so try the modern endpoint first and fall back to the classic one.
const BASE_REST = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const BASE_FILEAPI = "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi";

const TOWNSHIP_STATION_IDS = ["C0S810", "C0SA30", "C0T9I0"];
const TIDE_LOCATION_NAME = "臺東縣東河鄉";
const TOWNSHIP_LOCATION_NAME = "東河鄉";

// Coastal forecast points. The page itself stays single-spot (Donghe) —
// Chenggong is fetched and logged only, so that Phase 3 can chart it next to
// the Chenggong wave buoy (46761F) without adding a second panel here.
const COASTAL_POINTS = [
  { townName: "東河鄉", file: "coastal.json", source: "cwa_coastal_donghe", displayed: true },
  { townName: "成功鎮", file: "coastal-chenggong.json", source: "cwa_coastal_chenggong", displayed: false },
];

// Station whose observed wind is scored against the Donghe township forecast.
const WIND_OBS_STATION_ID = "C0S810";

// Buoy stations to show, looked up from O-B0076-001's full station directory.
const BUOY_STATIONS = [
  { id: "46761F", label: "Chenggong" },
  { id: "WRA007", label: "Taitung" },
  { id: "46699A", label: "Hualien" },
  { id: "46694A", label: "Longdong" },
];

const STATION_HISTORY_HOURS = 16;
const BUOY_HISTORY_HOURS = 24;

// Phase 2 (data logger): lead times tracked for Phase 3 accuracy comparison.
// 72h added 2026-10-02 — the horizon the page's coastal chart shows, so it's
// the "3 days out" call worth scoring. CWA coastal stops at 72h; the
// Open-Meteo sources run well past it.
const LEAD_HOURS = [6, 12, 24, 48, 72];
const TIDE_GAUGE_STATION_ID = "C4S02"; // 成功潮位站 (Chenggong tide gauge), from O-B0076-001's directory
// The tide prediction logged against that gauge — the township it sits in.
// (The page's tide chart stays on Donghe, TIDE_LOCATION_NAME.)
const TIDE_GAUGE_FORECAST_LOCATION = "臺東縣成功鎮";
const HISTORY_DIR = path.join(DATA_DIR, "history");

/** Today's date as YYYY-MM-DD in Taiwan local time (UTC+8), matching the tide dataset's Date field. */
function todayISODate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Beaufort wind scale number (0-12) from a wind speed in m/s. */
function beaufort(speedMs) {
  const n = Number(speedMs);
  if (!Number.isFinite(n)) return "";
  const thresholds = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  for (let i = 0; i < thresholds.length; i++) if (n < thresholds[i]) return i;
  return 12;
}

// CWA reports forecast directions as Chinese compass text ("偏北風", "東北",
// "偏東") while the buoys report degrees ("28.0"). Phase 3 needs to subtract
// one from the other, so forecast directions are converted to a bearing here
// at log time — the 16-point compass, with 偏 ("towards") and the 風 ("wind")
// suffix stripped first.
const DIR_ZH_DEG = {
  北: 0, 北北東: 22.5, 東北: 45, 東北東: 67.5, 東: 90, 東南東: 112.5, 東南: 135, 南南東: 157.5,
  南: 180, 南南西: 202.5, 西南: 225, 西西南: 247.5, 西: 270, 西北西: 292.5, 西北: 315, 北北西: 337.5,
};
function dirToDegrees(text) {
  if (!text || typeof text !== "string") return null;
  const base = text.trim().replace(/風$/, "").replace(/^偏/, "");
  const deg = DIR_ZH_DEG[base];
  return deg === undefined ? null : deg;
}

/** YYYY-MM for the current month in Taiwan local time (UTC+8) — monthly log-file naming. */
function monthKey() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/**
 * Half-cosine interpolation between the two points in `points` (each
 * {t: epoch-ms, h: number}, any order) that bracket `t`. Clamps to the
 * nearest endpoint outside the given range. Same method used client-side
 * for the tide chart curve (js/app.js interpolateTide) — kept separate
 * since this runs in Node against a different point shape.
 */
function cosineInterpolate(points, t) {
  const sorted = points.slice().sort((a, b) => a.t - b.t);
  if (!sorted.length) return null;
  if (t <= sorted[0].t) return sorted[0].h;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].h;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      const frac = (t - sorted[i].t) / (sorted[i + 1].t - sorted[i].t);
      const mu = (1 - Math.cos(frac * Math.PI)) / 2;
      return sorted[i].h * (1 - mu) + sorted[i + 1].h * mu;
    }
  }
  return sorted[sorted.length - 1].h;
}

/**
 * Appends `newRecords` to this month's log file under data/history/<subdir>/,
 * deduped by `dedupeKey(record)`, and writes it back. Grows forever by
 * design (Phase 2 scope) — one small file per month keeps any single
 * commit's diff and the per-file size manageable.
 */
async function appendMonthlyHistory(subdir, newRecords, dedupeKey) {
  if (!newRecords.length) return 0;
  const dir = path.join(HISTORY_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${monthKey()}.json`);
  const existing = await readJSONIfExists(filePath, { records: [] });
  const seen = new Set(existing.records.map(dedupeKey));
  let added = 0;
  for (const r of newRecords) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    existing.records.push(r);
    added++;
  }
  if (added) await writeFile(filePath, JSON.stringify(existing, null, 2));
  return added;
}

/**
 * Update tracking. The page wants to say "Last update / Next update" per
 * forecast, but neither CWA's saved payloads nor Open-Meteo tell us when the
 * model run was issued. What we can observe exactly is when the *content*
 * changes: hash each dataset every run, and the first run whose hash differs
 * is the moment that source published something new.
 *
 * From the observed change times we get the source's real cadence for free —
 * no need to hardcode a schedule we'd only be guessing at, and it self-
 * corrects if CWA changes theirs. The predicted next update is explicitly an
 * estimate and the page labels it with "~".
 */
const UPDATE_LOG_KEEP = 8; // recent change timestamps kept per source, for the median gap

function hashPayload(value) {
  // Stable stringify: key order from JSON.stringify is insertion order, which
  // is stable for these payloads since they're rebuilt the same way each run.
  const s = JSON.stringify(value);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Median of the gaps between consecutive change times, in minutes. */
function medianIntervalMinutes(times) {
  if (!times || times.length < 2) return null;
  const ms = times.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ms.length; i++) gaps.push((ms[i] - ms[i - 1]) / 60000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const med = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(med);
}

/**
 * Compares each source's payload against last run's hash and maintains
 * data/update-log.json: when it last changed, the recent change history, and
 * the inferred cadence. Returns the object the page reads.
 */
async function buildUpdateLog(sources, nowISO) {
  const logPath = path.join(DATA_DIR, "update-log.json");
  const log = await readJSONIfExists(logPath, { sources: {} });
  if (!log.sources) log.sources = {};

  for (const [key, payload] of Object.entries(sources)) {
    if (payload === undefined || payload === null) continue;
    const hash = hashPayload(payload);
    const prev = log.sources[key] || {};
    const changed = prev.hash !== hash;
    const changeTimes = (prev.changeTimes || []).slice();
    if (changed) {
      changeTimes.push(nowISO);
      while (changeTimes.length > UPDATE_LOG_KEEP) changeTimes.shift();
    }
    log.sources[key] = {
      hash,
      // On the very first run there is no previous hash, so "changed" is
      // trivially true — that's fine, it just seeds the series.
      lastChangedAt: changed ? nowISO : (prev.lastChangedAt || nowISO),
      lastCheckedAt: nowISO,
      changeTimes,
      intervalMinutes: medianIntervalMinutes(changeTimes),
    };
  }

  await writeFile(logPath, JSON.stringify(log, null, 2));
  return log;
}

/** Nearest series point to `targetMs`, or null if none within `toleranceMs`. */
function nearestPoint(series, targetMs, toleranceMs) {
  let best = null, bestDiff = Infinity;
  for (const p of series) {
    const pt = new Date(p.targetTime).getTime();
    const diff = Math.abs(pt - targetMs);
    if (diff < bestDiff) { best = p; bestDiff = diff; }
  }
  return best && bestDiff <= toleranceMs ? best : null;
}

/**
 * The entry in `series` whose [startTime, endTime) span covers `targetMs`.
 * For period forecasts (the township forecast is 12-hourly) "nearest instant"
 * is the wrong question — a target 5 hours into a 12-hour block belongs to
 * that block, not to whichever boundary happens to be closer.
 */
function periodContaining(series, targetMs) {
  return series.find((p) => {
    const s = new Date(p.startTime).getTime();
    const e = p.endTime ? new Date(p.endTime).getTime() : s + 12 * 60 * 60 * 1000;
    return targetMs >= s && targetMs < e;
  }) || null;
}

// Within a single run the same dataset can be wanted more than once (both
// coastal points come out of one F-D0047-095 payload), so identical requests
// share a response rather than hitting CWA twice.
const datasetCache = new Map();
function fetchDataset(id, extraParams) {
  const key = id + "|" + JSON.stringify(extraParams || {});
  if (!datasetCache.has(key)) datasetCache.set(key, fetchDatasetUncached(id, extraParams));
  return datasetCache.get(key);
}

async function fetchDatasetUncached(id, extraParams) {
  const attempts = [
    () => {
      const url = new URL(`${BASE_REST}/${id}`);
      url.searchParams.set("Authorization", API_KEY);
      url.searchParams.set("format", "JSON");
      for (const [k, v] of Object.entries(extraParams || {})) url.searchParams.set(k, v);
      return url;
    },
    () => {
      const url = new URL(`${BASE_FILEAPI}/${id}`);
      url.searchParams.set("Authorization", API_KEY);
      url.searchParams.set("downloadType", "WEB");
      url.searchParams.set("format", "JSON");
      for (const [k, v] of Object.entries(extraParams || {})) url.searchParams.set(k, v);
      return url;
    },
  ];

  let lastErr;
  for (const build of attempts) {
    const url = build();
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      lastErr = new Error(`${id} -> ${err.message || err} (${url.origin}${url.pathname})`);
      continue;
    }
    if (res.ok) return res.json();
    lastErr = new Error(`${id} -> HTTP ${res.status} (${url.origin}${url.pathname})`);
  }
  throw lastErr;
}

async function readJSONIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

/** Case/variant-insensitive key lookup: returns the first key in `obj` matching any of `keys` (case-insensitively). */
function pickKey(obj, keys) {
  const lower = keys.map((k) => k.toLowerCase());
  return Object.keys(obj).find((k) => lower.includes(k.toLowerCase()));
}

/** Recursively collects every object where any of `keys` has a value in `values`. */
function findMatches(obj, keys, values, results = [], seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return results;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) findMatches(item, keys, values, results, seen);
  } else {
    const k = pickKey(obj, keys);
    if (k !== undefined && values.includes(obj[k])) results.push(obj);
    for (const v of Object.values(obj)) findMatches(v, keys, values, results, seen);
  }
  return results;
}

/** Recursively collects every object where any of `keys` is a string containing `substr`. */
function findMatchesContaining(obj, keys, substr, results = [], seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return results;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) findMatchesContaining(item, keys, substr, results, seen);
  } else {
    const k = pickKey(obj, keys);
    if (k !== undefined && typeof obj[k] === "string" && obj[k].includes(substr)) results.push(obj);
    for (const v of Object.values(obj)) findMatchesContaining(v, keys, substr, results, seen);
  }
  return results;
}

const LOCATION_NAME_KEYS = ["locationName", "LocationName"];
const STATION_ID_KEYS = ["StationId", "StationID", "stationId"];

async function buildTownship() {
  const raw = await fetchDataset("F-D0047-039");
  const matches = findMatchesContaining(raw, LOCATION_NAME_KEYS, TOWNSHIP_LOCATION_NAME);
  if (!matches.length) return { data: raw, ok: false, count: 0, windSeries: [] };

  // Wind series for the Phase 2 logger — this forecast is the counterpart to
  // the Donghe land station's observed wind (C0S810). Unlike the coastal
  // forecast's 3-hourly instants these are 12-hour periods, so each entry
  // carries its own span and is matched by "which period contains the target
  // time" rather than by nearest instant.
  const loc = matches[0];
  const speeds = extractElementSeries(loc, "風速", "WindSpeed");
  const dirs = extractElementSeries(loc, "風向", "WindDirection");
  const scales = extractElementSeries(loc, "風速", "BeaufortScale");
  const windSeries = speeds.map((s, i) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    targetTime: s.startTime,
    windSpeed: Number(s.value),
    windScale: Number((scales[i] || {}).value),
    windDirectionText: (dirs[i] || {}).value,
    windDirectionDeg: dirToDegrees((dirs[i] || {}).value),
  }));

  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
    windSeries,
  };
}

/** Pulls a single element's per-time values out of CWA's WeatherElement array, unwrapping ElementValue (array-or-object). */
function extractElementSeries(location, elementName, field) {
  const el = (location.WeatherElement || []).find((w) => w.ElementName === elementName);
  if (!el) return [];
  return (el.Time || []).map((t) => {
    const ev = t.ElementValue;
    const obj = Array.isArray(ev) ? ev[0] : ev;
    return {
      targetTime: t.DataTime || t.StartTime,
      startTime: t.StartTime || t.DataTime,
      endTime: t.EndTime,
      value: obj && obj[field],
    };
  });
}

async function buildCoastal(point) {
  const raw = await fetchDataset("F-D0047-095");
  const matches = findMatchesContaining(raw, LOCATION_NAME_KEYS, point.townName);
  if (!matches.length) return { data: raw, ok: false, count: 0, series: [] };

  // Flat series for the Phase 2 logger. Wave and wind direction come through
  // as Chinese compass text, so each is logged both ways (text + bearing).
  const loc = matches[0];
  const heights = extractElementSeries(loc, "浪高", "WaveHeight");
  const periods = extractElementSeries(loc, "浪週期", "WavePeriod");
  const waveDirs = extractElementSeries(loc, "浪向", "WaveDirection");
  const winds = extractElementSeries(loc, "風速", "WindSpeed");
  const windScales = extractElementSeries(loc, "風速", "BeaufortScale");
  const windDirs = extractElementSeries(loc, "風向", "WindDirection");
  const series = heights.map((h, i) => ({
    targetTime: h.targetTime,
    waveHeight: Number(h.value),
    wavePeriod: Number((periods[i] || {}).value),
    waveDirectionText: (waveDirs[i] || {}).value,
    waveDirectionDeg: dirToDegrees((waveDirs[i] || {}).value),
    windSpeed: Number((winds[i] || {}).value),
    windScale: Number((windScales[i] || {}).value),
    windDirectionText: (windDirs[i] || {}).value,
    windDirectionDeg: dirToDegrees((windDirs[i] || {}).value),
  }));

  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
    series,
  };
}

/** {t, h} turning points (ms, TWVD cm) from one F-A0021-001 location, all days it carries. */
function tideTurningPoints(loc) {
  const points = [];
  for (const day of (loc && loc.TimePeriods && loc.TimePeriods.Daily) || []) {
    for (const t of day.Time || []) {
      const h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL);
      if (isFinite(Number(h))) points.push({ t: new Date(t.DateTime).getTime(), h: Number(h) });
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

async function buildTide() {
  const raw = await fetchDataset("F-A0021-001");

  // The logger's prediction comes from the township the gauge is IN
  // (Chenggong), not Donghe — forecast and observation have to describe the
  // same water. Read before the Donghe trim below mutates anything.
  const gaugeLoc = findMatches(raw, LOCATION_NAME_KEYS, [TIDE_GAUGE_FORECAST_LOCATION])[0];
  const gaugePoints = tideTurningPoints(gaugeLoc);
  if (!gaugeLoc) {
    const names = new Set();
    findMatchesContaining(raw, LOCATION_NAME_KEYS, "臺東").forEach((l) => names.add(l.LocationName || l.locationName));
    console.error(`WARN: tide forecast location ${TIDE_GAUGE_FORECAST_LOCATION} not found; Taitung locations: ${[...names].join(", ")}`);
  }

  const matches = findMatches(raw, LOCATION_NAME_KEYS, [TIDE_LOCATION_NAME]);
  if (!matches.length) return { data: raw, ok: false, count: 0, gaugePoints };
  // The Daily array isn't returned in chronological order — sort it and
  // keep only the next few days so the page doesn't need to guess.
  matches.forEach((loc) => {
    const daily = loc.TimePeriods && loc.TimePeriods.Daily;
    if (Array.isArray(daily)) {
      daily.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
      loc.TimePeriods.Daily = daily.filter((d) => d.Date >= todayISODate()).slice(0, 5);
    }
  });

  return {
    data: { records: { TideForecasts: matches.map((loc) => ({ Location: loc })) } },
    ok: true,
    count: matches.length,
    gaugePoints,
  };
}

async function buildStations() {
  const raw = await fetchDataset("O-A0001-001");
  const matches = findMatches(raw, STATION_ID_KEYS, TOWNSHIP_STATION_IDS);
  if (!matches.length) return { data: raw, ok: false, count: 0, matches: [] };
  return { data: { records: { Station: matches } }, ok: true, count: matches.length, matches };
}

/**
 * O-A0001-001 only ever returns the latest snapshot — there's no CWA
 * endpoint for station history. So each run appends the just-fetched
 * reading for each station into a small rolling log file and trims it to
 * the last STATION_HISTORY_HOURS, giving the page real history over time
 * without needing a database (matches this project's "no DB yet" scope —
 * it's just an append-and-trim JSON log, not a query engine).
 */
async function buildStationsHistory(stationMatches) {
  const historyPath = path.join(DATA_DIR, "stations-history.json");
  const existing = await readJSONIfExists(historyPath, {});
  const cutoff = Date.now() - STATION_HISTORY_HOURS * 60 * 60 * 1000;

  for (const s of stationMatches) {
    const id = s.StationId || s.StationID;
    const name = s.StationName;
    const we = s.WeatherElement || {};
    const dateTime = s.ObsTime && s.ObsTime.DateTime;
    if (!id || !dateTime) continue;

    if (!existing[id]) existing[id] = { name, readings: [] };
    existing[id].name = name;
    const readings = existing[id].readings;
    if (!readings.some((r) => r.DateTime === dateTime)) {
      readings.push({
        DateTime: dateTime,
        WindSpeed: we.WindSpeed,
        WindDirection: we.WindDirection,
        WindScale: beaufort(we.WindSpeed),
      });
    }
    existing[id].readings = readings
      .filter((r) => new Date(r.DateTime).getTime() >= cutoff)
      .sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime));
  }

  await writeFile(historyPath, JSON.stringify(existing, null, 2));
  return existing;
}

async function buildBuoyStation(station) {
  // Confirmed real shape (rest/datastore, PascalCase throughout):
  //   Records.SeaSurfaceObs.Location[] = {
  //     Station: { StationID },
  //     StationObsTimes: { StationObsTime: [{ DateTime, WeatherElements: {...} }] }
  //   }
  // An unfiltered request returns just a bare station index (no readings),
  // and the station-identifying object is nested separately from the
  // readings — so this walks the confirmed shape explicitly rather than
  // using the generic key/value matcher.
  const raw = await fetchDataset("O-B0075-001", { StationID: station.id });
  const records = raw.Records || raw.records || {};
  const seaSurfaceObs = records.SeaSurfaceObs || records.seaSurfaceObs || {};
  const locations = seaSurfaceObs.Location || seaSurfaceObs.location || [];
  const loc = locations.find((l) => l.Station && l.Station.StationID === station.id) || locations[0];
  if (!loc) return null;

  const times = (loc.StationObsTimes && loc.StationObsTimes.StationObsTime) || [];
  const cutoff = Date.now() - BUOY_HISTORY_HOURS * 60 * 60 * 1000;
  const readings = times
    .filter((t) => t.WeatherElements && t.WeatherElements.WaveHeight !== "None")
    .filter((t) => new Date(t.DateTime).getTime() >= cutoff)
    .sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime))
    .map((t) => ({ DateTime: t.DateTime, ...t.WeatherElements }));
  if (!readings.length) return null;

  return { StationID: station.id, Label: station.label, Readings: readings };
}

/**
 * Every reading the Chenggong tide gauge (C4S02) has in O-B0075-001 right
 * now (~48h), not just the latest — logging them all backfills any hour a
 * run missed. Same dataset and response shape as the wave buoys, with a
 * TideHeight field instead of WaveHeight. TideHeight is in METRES.
 */
async function buildTideGaugeReadings() {
  const raw = await fetchDataset("O-B0075-001", { StationID: TIDE_GAUGE_STATION_ID });
  const records = raw.Records || raw.records || {};
  const seaSurfaceObs = records.SeaSurfaceObs || records.seaSurfaceObs || {};
  const locations = seaSurfaceObs.Location || seaSurfaceObs.location || [];
  const loc = locations.find((l) => l.Station && l.Station.StationID === TIDE_GAUGE_STATION_ID) || locations[0];
  if (!loc) return [];
  const times = (loc.StationObsTimes && loc.StationObsTimes.StationObsTime) || [];
  return times
    .filter((t) => t.WeatherElements && t.WeatherElements.TideHeight !== "None" &&
      isFinite(Number(t.WeatherElements.TideHeight)))
    .map((t) => ({ observedAt: t.DateTime, observedCm: Math.round(Number(t.WeatherElements.TideHeight) * 1000) / 10 }))
    .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
}

/* --- Tide log: gauge vs prediction for the SAME place --------------------
 * The prediction is CWA's F-A0021-001 forecast for Chenggong township
 * (TIDE_GAUGE_FORECAST_LOCATION), where the gauge sits — not Donghe, which
 * the page shows. The log was restarted on 2026-10-02 on this basis; the
 * earlier Donghe-forecast-vs-Chenggong-gauge records are kept, untouched,
 * in data/history/tide-legacy/ (see README).
 *
 * The prediction is read at the gauge reading's OWN timestamp, never at
 * the time the script ran (that offset was up to ~1.5h — 30cm+ of fake
 * error at mid-tide). Reading at the gauge's time needs yesterday's turning
 * points, and CWA's product starts at today, so they're kept in a small
 * rolling store. The store is tagged with its location and discarded if
 * that ever changes, so points from two places can't mix.
 */
const TIDE_EXTREMA_FILE = path.join(DATA_DIR, "tide-extrema.json");
const TIDE_EXTREMA_KEEP_DAYS = 3;

/** Merge this run's turning points into the rolling store; returns all known points (ms, sorted). */
async function updateTideExtrema(newPoints, location) {
  const store = await readJSONIfExists(TIDE_EXTREMA_FILE, { points: [] });
  const byT = {};
  if (store.location === location) {
    for (const p of store.points || []) byT[new Date(p.t).getTime()] = p.h;
  }
  for (const p of newPoints || []) if (isFinite(p.h)) byT[p.t] = p.h; // latest issue wins
  const all = Object.keys(byT).map(Number).sort((a, b) => a - b).map((t) => ({ t, h: byT[t] }));
  const cutoff = Date.now() - TIDE_EXTREMA_KEEP_DAYS * 86400000;
  await writeFile(TIDE_EXTREMA_FILE, JSON.stringify({
    note: "Rolling tide turning points (TWVD2001, cm) for the Phase 2 tide logger - see updateTideExtrema.",
    location,
    points: all.filter((p) => p.t >= cutoff).map((p) => ({ t: new Date(p.t).toISOString(), h: p.h })),
  }, null, 2));
  return all;
}

/** One tide log record: gauge vs prediction at the gauge's own timestamp. */
function tideRecord(observedAt, observedCm, points) {
  const t = new Date(observedAt).getTime();
  // Outside the known turning points cosineInterpolate would clamp to the
  // end value — a made-up number, so leave the forecast empty instead.
  const covered = points.length && t >= points[0].t && t <= points[points.length - 1].t;
  return {
    v: 2, observedAt, station: TIDE_GAUGE_STATION_ID, observedCm,
    forecastCm: covered ? Math.round(cosineInterpolate(points, t) * 10) / 10 : null,
    forecastLocation: TIDE_GAUGE_FORECAST_LOCATION,
  };
}

/**
 * Independent wave forecast from Open-Meteo's free Marine API (no key) —
 * doesn't depend on CWA or any of the commercial embeds, so it's a fallback
 * source of real wave data.
 *
 * The model is Météo-France MFWAM (1/12°, ~9km; ECMWF-forced; the same
 * model as Copernicus Marine's global wave product), at grid point
 * 22.958N 121.375E — ~6km ESE of Donghe, offshore. It was documented as
 * NOAA GFS-Wave until 2026-10-02, which was wrong: with no `models` set,
 * Open-Meteo's best_match picks MFWAM here, and every run since 2026-09-14
 * came from that same grid point. It's now pinned explicitly, so a change
 * in Open-Meteo's best_match can't silently swap the model under the log.
 */
async function buildOpenWave() {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", "22.975");
  url.searchParams.set("longitude", "121.315");
  url.searchParams.set("models", "meteofrance_wave");
  url.searchParams.set("hourly", [
    "wave_height", "wave_period", "wave_direction",
    "swell_wave_height", "swell_wave_period", "swell_wave_direction",
    "wind_wave_height", "wind_wave_period",
  ].join(","));
  url.searchParams.set("timezone", "Asia/Taipei");
  url.searchParams.set("forecast_days", "5");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo marine -> HTTP ${res.status}`);
  const data = await res.json();
  const h = data.hourly;
  const count = (h && h.time && h.time.length) || 0;
  if (!count) return { data, ok: false, count: 0, series: [] };

  // Flat series for the Phase 2 logger. Timestamps have no timezone suffix
  // (already Asia/Taipei per the request param) — add it explicitly.
  // Direction is already a bearing here, so no dirToDegrees() needed.
  const series = h.time.map((t, i) => ({
    targetTime: new Date(t + ":00+08:00").toISOString(),
    waveHeight: Number(h.wave_height[i]),
    wavePeriod: Number(h.wave_period[i]),
    waveDirectionDeg: Number(h.wave_direction[i]),
    swellHeight: Number(h.swell_wave_height[i]),
    swellPeriod: Number(h.swell_wave_period[i]),
    swellDirectionDeg: Number(h.swell_wave_direction[i]),
    windWaveHeight: Number(h.wind_wave_height[i]),
    windWavePeriod: Number(h.wind_wave_period[i]),
  }));

  return { data, ok: true, count, series };
}

/**
 * ECMWF — the model family behind Windy's default wave and wind layers
 * (ECMWF WAM and ECMWF IFS). Windy's own numbers can't be recorded: its
 * embed is a cross-origin iframe and its point API is paid. Open-Meteo
 * serves the same models free, so logging them keeps a record of roughly
 * what Windy was showing, scoreable against the buoys in Phase 3.
 *
 * Coarser than Windy's ~9km: these are the 0.25-degree grids, and the
 * nearest wave cell to Donghe is 23.0N 121.5E, ~20km offshore. Unlike
 * MFWAM (our open_meteo feed), WAM here carries no swell partitions — only total sea — but it
 * does give PEAK period (Tp), the same measure a surf buoy like Harvest
 * reports, which our MFWAM feed doesn't.
 *
 * Logged, not displayed — the page still shows Windy itself.
 */
const OM_POINT = { latitude: "22.975", longitude: "121.315", timezone: "Asia/Taipei", forecast_days: "10" };
const omNum = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Number(v);

/** Hourly 10m wind for one Open-Meteo model, keyed by its local timestamp. */
async function fetchModelWind(model) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  for (const [k, v] of Object.entries(OM_POINT)) url.searchParams.set(k, v);
  url.searchParams.set("models", model);
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "ms");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${model} -> HTTP ${res.status}`);
  const h = (await res.json()).hourly || {};
  const byTime = {};
  (h.time || []).forEach((t, i) => {
    const speed = omNum(h.wind_speed_10m[i]);
    byTime[t] = {
      windSpeed: speed,
      windScale: speed === null ? null : beaufort(speed),
      windDirectionDeg: omNum(h.wind_direction_10m[i]),
      windGust: omNum(h.wind_gusts_10m[i]),
    };
  });
  return byTime;
}

async function buildEcmwf() {
  const waveUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
  for (const [k, v] of Object.entries(OM_POINT)) waveUrl.searchParams.set(k, v);
  waveUrl.searchParams.set("models", "ecmwf_wam025");
  waveUrl.searchParams.set("hourly", "wave_height,wave_period,wave_peak_period,wave_direction");

  const [waveRes, windAt] = await Promise.all([fetch(waveUrl), fetchModelWind("ecmwf_ifs025")]);
  if (!waveRes.ok) throw new Error(`open-meteo ecmwf_wam025 -> HTTP ${waveRes.status}`);
  const wave = (await waveRes.json()).hourly || {};

  // Joined on the timestamp, not the index, so the two can't drift apart
  // if one response is shorter than the other.
  const noWind = { windSpeed: null, windScale: null, windDirectionDeg: null, windGust: null };
  const series = (wave.time || []).map((t, i) => Object.assign({
    targetTime: new Date(t + ":00+08:00").toISOString(),
    waveHeight: omNum(wave.wave_height[i]),
    wavePeriod: omNum(wave.wave_period[i]),
    wavePeakPeriod: omNum(wave.wave_peak_period[i]),
    waveDirectionDeg: omNum(wave.wave_direction[i]),
  }, windAt[t] || noWind)).filter((p) => p.waveHeight !== null || p.windSpeed !== null);

  return {
    data: { models: { wave: "ecmwf_wam025", wind: "ecmwf_ifs025" }, series },
    ok: series.length > 0,
    count: series.length,
    series,
  };
}

/**
 * NOAA GFS-Wave 16km — the model behind the page's Windguru waves widget
 * (Windguru model 84), logged as its recordable stand-in. Total sea, swell
 * and wind-sea partitions; no peak period on this model. Logged, not shown.
 *
 * Grid point 23.0N 121.333E, ~3km NNE of Donghe and right at the coast —
 * much closer inshore than MFWAM (~6km out) or ECMWF WAM (~19km out), so
 * expect it to read lower in a coastal cell; that's geography, not error.
 */
async function buildGfsWave() {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  for (const [k, v] of Object.entries(OM_POINT)) url.searchParams.set(k, v);
  url.searchParams.set("models", "ncep_gfswave016");
  url.searchParams.set("hourly", [
    "wave_height", "wave_period", "wave_direction",
    "swell_wave_height", "swell_wave_period", "swell_wave_direction",
    "wind_wave_height", "wind_wave_period",
  ].join(","));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ncep_gfswave016 -> HTTP ${res.status}`);
  const h = (await res.json()).hourly || {};
  const series = (h.time || []).map((t, i) => ({
    targetTime: new Date(t + ":00+08:00").toISOString(),
    waveHeight: omNum(h.wave_height[i]),
    wavePeriod: omNum(h.wave_period[i]),
    waveDirectionDeg: omNum(h.wave_direction[i]),
    swellHeight: omNum(h.swell_wave_height[i]),
    swellPeriod: omNum(h.swell_wave_period[i]),
    swellDirectionDeg: omNum(h.swell_wave_direction[i]),
    windWaveHeight: omNum(h.wind_wave_height[i]),
    windWavePeriod: omNum(h.wind_wave_period[i]),
  })).filter((p) => p.waveHeight !== null);
  return { data: { model: "ncep_gfswave016", series }, ok: series.length > 0, count: series.length, series };
}

/**
 * GFS wind — the model behind the page's Windguru wind widget (GFS 13km),
 * logged as its recordable stand-in the way buildEcmwf stands in for Windy.
 * Wind only — waves are logged separately (`open_meteo`). Logged, not shown.
 */
async function buildGfsWind() {
  const windAt = await fetchModelWind("gfs_seamless");
  const series = Object.keys(windAt).sort().map((t) => Object.assign(
    { targetTime: new Date(t + ":00+08:00").toISOString() }, windAt[t]))
    .filter((p) => p.windSpeed !== null);
  return { data: { model: "gfs_seamless", series }, ok: series.length > 0, count: series.length, series };
}

/**
 * Sunrise/sunset/twilight/moon times plus the daily astronomical calendar,
 * from the static per-year data files behind CWA's 每日天文現象 page
 * (cwa.gov.tw/V8/C/K/astronomy_day.html). These are not Open Data API
 * datasets — the API's astronomy topic only carries sunrise/sunset
 * (A-B0062-001) and moonrise/moonset (A-B0063-001), with no calendar of
 * phenomena at all — but they are public static files, need no API key, and
 * carry an official English translation of each phenomenon (`st.E`), so no
 * translation guesswork is needed.
 *
 * Tradeoff worth knowing: being undocumented internal files, they could be
 * moved or reshaped without notice. Everything here fails soft — a bad fetch
 * or parse leaves the previous data in place and the page simply omits the
 * section.
 *
 * The files cover a whole calendar year and change once a year, so this
 * refetches only when the stored window no longer covers today rather than
 * pulling ~140KB from CWA every hour for data that hasn't moved.
 */
const ASTRO_COUNTY = "TaitungCounty";
const ASTRO_WINDOW_DAYS = 14;

function parseAstroYearFile(text, varName) {
  // These files are `var X={...};` with single-quoted keys — valid JSON once
  // the assignment is stripped and the quotes normalised. Parsed rather than
  // eval'd: it's third-party text and must never be executed.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`${varName}: no object literal found`);
  const body = text.slice(start, end + 1).replace(/'/g, '"');
  return JSON.parse(body);
}

async function fetchAstroYear(year) {
  const base = "https://www.cwa.gov.tw/Data/js/astronomy";
  const [timesRes, dayRes] = await Promise.all([
    fetch(`${base}/astronomy_${ASTRO_COUNTY}_${year}.js`),
    fetch(`${base}/astronomy_day_${year}.js`),
  ]);
  if (!timesRes.ok || !dayRes.ok) {
    throw new Error(`astronomy ${year} -> HTTP ${timesRes.status}/${dayRes.status}`);
  }
  return {
    times: parseAstroYearFile(await timesRes.text(), "sun_moon_twi_data"),
    day: parseAstroYearFile(await dayRes.text(), "astronomy_day"),
  };
}

/** CWA writes "-" for "no data" / "nothing today"; normalise that to null. */
function astroVal(v) {
  return v === undefined || v === null || v === "-" || v === "" ? null : v;
}

async function buildAstronomy() {
  const outPath = path.join(DATA_DIR, "astronomy.json");
  const existing = await readJSONIfExists(outPath, null);
  const today = todayISODate();
  if (existing && existing.days && existing.days[today]) {
    // Still covered — don't hit CWA for a file that changes once a year.
    return { data: existing, ok: true, count: Object.keys(existing.days).length, skipped: true };
  }

  // Taipei midnight is 16:00 UTC the previous day, so shift by +8h before
  // slicing an ISO string or every date comes out one day early.
  const startMs = new Date(today + "T00:00:00+08:00").getTime();
  const wanted = [];
  for (let i = 0; i < ASTRO_WINDOW_DAYS; i++) {
    wanted.push(new Date(startMs + i * 86400000 + 8 * 3600000).toISOString().slice(0, 10));
  }

  // The window can straddle New Year; next year's file may not be published
  // yet, so a miss there is tolerated rather than fatal.
  const years = [...new Set(wanted.map((d) => d.slice(0, 4)))];
  const loaded = {};
  for (const y of years) {
    try {
      loaded[y] = await fetchAstroYear(y);
    } catch (err) {
      if (y === years[0]) throw err;
      console.error(`WARN: astronomy ${y} unavailable (${err.message}) — window truncated`);
    }
  }

  const days = {};
  for (const date of wanted) {
    const y = date.slice(0, 4);
    const src = loaded[y];
    if (!src) continue;
    const t = src.times[date] || {};
    const d = src.day[date] || {};
    days[date] = {
      sunrise: astroVal(t.sr), sunriseAzimuth: astroVal(t.srAz),
      solarNoon: astroVal(t.sT), sunset: astroVal(t.ss), sunsetAzimuth: astroVal(t.ssAz),
      civilTwilightBegin: astroVal(t.lCr), civilTwilightEnd: astroVal(t.lCs),
      moonrise: astroVal(t.mr), moonset: astroVal(t.ms),
      lunarDate: astroVal(d.l),
      solarTerm: astroVal(d.se),
      // st.E is CWA's own English; multiple events are joined with a
      // full-width semicolon, split here so the page can list them.
      phenomena: astroVal(d.st && d.st.E) ? String(d.st.E).split(/[；;]/).map((s) => s.trim()).filter(Boolean) : [],
      phenomenaZh: astroVal(d.st && d.st.C) ? String(d.st.C).split(/[；;]/).map((s) => s.trim()).filter(Boolean) : [],
    };
  }
  if (!Object.keys(days).length) throw new Error("no dates extracted");
  return { data: { county: ASTRO_COUNTY, days }, ok: true, count: Object.keys(days).length };
}

/* ---------------------------------------------------------------------
 * Typhoon News
 *
 * Detection comes from JTWC's RSS feed rather than the CWA homepage: it is
 * machine-readable, lists every active system, and already formats the
 * headline exactly as we want to show it ("Tropical Storm 24W (Dujuan)"),
 * so no designation has to be derived from wind speed. JTWC's storm number
 * is its own sequence and does NOT reliably equal CWA's 編號, so taking the
 * graphic URL straight from the feed avoids guessing at it.
 *
 * Scope is every Western Pacific system — the feed's NW Pacific item also
 * covers the Bay of Bengal and Arabian Sea, so anything whose product file
 * isn't `wp…` is dropped. Distant storms are kept deliberately: a typhoon
 * heading for Japan is exactly what sends groundswell to this coast.
 *
 * The CWA track map is a best-effort extra — its filename embeds the
 * synoptic issue time, so the most recent few are probed and the first one
 * that exists wins. A system CWA isn't tracking (or hasn't drawn yet)
 * simply has no track image.
 * ------------------------------------------------------------------- */
const JTWC_RSS = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss";
const JTWC_ABPW = "https://www.metoc.navy.mil/jtwc/products/abpwweb.txt";
const CWA_TRACK_BASE = "https://www.cwa.gov.tw/Data/typhoon/TY_NEWS";

/** "18/0300Z" -> absolute ISO. The day-of-month is all JTWC gives, so the
 *  month is inferred from now, stepping back one if that lands in the future. */
function zuluToISO(dz, nowMs) {
  const m = String(dz || "").match(/^(\d{2})\/(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const now = new Date(nowMs);
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +m[1], +m[2], +m[3]));
  if (d.getTime() - nowMs > 2 * 86400000) {
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, +m[1], +m[2], +m[3]));
  }
  return d.toISOString();
}

function decodeEntities(s) {
  return String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseJtwcRss(xml, nowMs) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const out = { systems: [], alerts: [], advisory: null };
  for (const it of items) {
    const title = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const cdata = (it.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || "";

    if (/Northwest Pacific/i.test(title)) {
      const blocks = cdata.split(/<p>/i).filter((b) => /Warning\s*#/i.test(b));
      for (const b of blocks) {
        const head = (b.match(/<b>\s*([\s\S]*?)\s*<\/b>/) || [])[1] || "";
        const hm = head.replace(/\s+/g, " ")
          .match(/^(.*?)\s+(\d{2}[A-Z])\s+\(([^)]*)\)\s+Warning\s*#\s*(\d+)/i);
        const gif = b.match(/href='([^']*products\/([a-z]{2})\d{4}\.gif)'/i);
        if (!hm || !gif) continue;
        if (gif[2].toLowerCase() !== "wp") continue; // Indian Ocean systems aren't ours
        const issuedZ = (b.match(/Issued at\s*(\d{2}\/\d{4}Z)/i) || [])[1] || null;
        out.systems.push({
          designation: hm[1].trim(),
          id: hm[2],
          name: hm[3],
          headline: hm[1].trim() + " " + hm[2] + " (" + hm[3] + ")",
          warningNumber: hm[4],
          issuedZ,
          issuedAt: zuluToISO(issuedZ, nowMs),
          graphic: decodeEntities(gif[1]),
          warningText: decodeEntities((b.match(/href='([^']*web\.txt)'/i) || [])[1] || ""),
        });
      }
    }

    if (/Northwest Pacific/i.test(title)) {
      // TCFA blocks sit in the same item but carry no warning number, so the
      // loop above skips them. Same wp-only basin filter applies.
      const alertBlocks = cdata.split(/<p>/i).filter((b) => /Tropical Cyclone Formation Alert/i.test(b));
      for (const b of alertBlocks) {
        const txtUrl = (b.match(/href='([^']*wp\d{4}web\.txt)'/i) || [])[1];
        if (!txtUrl) continue;
        const alertId = (b.replace(/\s+/g, " ").match(/Tropical Cyclone Formation Alert\s+(\w+)/i) || [])[1] || null;
        // The filename alone isn't enough: 92W kept its wp-numbered files
        // after drifting into the Andaman Sea, but JTWC reissued the alert
        // under the Indian Ocean header WTIO21. The WMO header says which
        // basin the alert is for; WTPN is the Western Pacific.
        if (alertId && !/^WTPN/i.test(alertId)) continue;
        out.alerts.push({
          alertId,
          issuedZ: (b.match(/Issued at\s*(\d{2}\/\d{4}Z)/i) || [])[1] || null,
          issuedAt: zuluToISO((b.match(/Issued at\s*(\d{2}\/\d{4}Z)/i) || [])[1], nowMs),
          textUrl: decodeEntities(txtUrl),
          graphic: decodeEntities((b.match(/href='([^']*wp\d{4}\.gif)'/i) || [])[1] || ""),
          // Unlike a bare disturbance, an alerted invest DOES get its own
          // satellite image — better than the basin-wide advisory picture.
          satellite: decodeEntities((b.match(/href='([^']*\d{2}[WSEPC]_\d{6}sair\.jpg)'/i) || [])[1] || ""),
        });
      }
    }

    if (/Significant Tropical Weather Advisories/i.test(title)) {
      const z = (cdata.match(/abpwweb\.txt[\s\S]*?(?:Re)?issued at\s*(\d{2}\/\d{4}Z)/i) || [])[1] || null;
      out.advisory = {
        issuedZ: z,
        issuedAt: zuluToISO(z, nowMs),
        url: JTWC_ABPW,
        reissued: /abpwweb\.txt[\s\S]{0,200}?Reissued/i.test(cdata),
      };
    }
  }
  return out;
}

/**
 * Invests from ABPW10 section 1 (Western North Pacific, 180 to the Malay
 * Peninsula — which includes the South China Sea). Free-text military
 * bulletin, so this is best-effort by design: it pulls the invest
 * designators and the stated development potential, and the page always
 * links the full advisory so nothing depends on the parse being complete.
 */
function parseInvests(txt) {
  // Section 1 only — "WESTERN NORTH PACIFIC AREA (180 TO MALAY PENINSULA)",
  // which includes the South China Sea. Section 2 is the South Pacific and
  // has an identically-named subsection, so scoping first is essential.
  const sec1 = (txt.match(/1\.\s*WESTERN NORTH PACIFIC AREA[\s\S]*?(?=\n\s*2\.\s|$)/i) || [])[0] || "";
  const dist = (sec1.match(/B\.\s*TROPICAL DISTURBANCE SUMMARY:?([\s\S]*?)(?=\n\s*C\.\s|$)/i) || [])[1] || "";
  if (!dist || /^\s*NONE/i.test(dist.trim())) return [];

  const out = [];
  for (const m of dist.matchAll(/\((\d+)\)\s([\s\S]*?)(?=\n\s*\(\d+\)|$)/g)) {
    // The bulletin hard-wraps at ~70 columns, splitting values mid-token —
    // "NEAR 5.7N \n146.1E" is one coordinate pair. Normalise whitespace
    // before matching anything or every field breaks at a line end.
    const p = m[2].replace(/\s+/g, " ").trim();
    if (!p || /NO OTHER SUSPECT AREAS/i.test(p)) continue;

    const id = (p.match(/INVEST\s+(\d{2}[WSEPC])/i) || [])[1] || null;
    // Two observed phrasings, and picking the wrong one puts the system
    // hundreds of miles off: a first sighting reads "HAS PERSISTED NEAR x",
    // while a follow-up reads "PREVIOUSLY LOCATED NEAR x IS NOW LOCATED
    // NEAR y". Matching the first NEAR in the second case returns the OLD
    // position — so the current-position phrasing is tried first.
    const pos = p.match(/IS NOW LOCATED NEAR\s+([\d.]+)\s*([NS])\s+([\d.]+)\s*([EW])/i) ||
      p.match(/NEAR\s+([\d.]+)\s*([NS])\s+([\d.]+)\s*([EW])/i);
    const geo = p.match(/APPROXIMATELY\s+(\d+)\s*NM\s+([A-Z\- ]+?)\s+OF\s+([A-Z\- .']+?)[.,]/i);
    const wind = p.match(/MAXIMUM SUSTAINED SURFACE WINDS ARE ESTIMATED AT\s+(\d+)\s*TO\s*(\d+)\s*KNOTS/i);
    const pres = p.match(/MINIMUM SEA LEVEL PRESSURE IS (?:ESTIMATED TO BE\s+)?NEAR\s+(\d+)\s*MB/i);
    // "IS HIGH" on a first mention, "REMAINS HIGH" once it's been assessed
    // before — the second form silently yielded null until live data showed it.
    const pot = p.match(/POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT TROPICAL CYCLONE WITHIN THE NEXT\s+\d+\s+HOURS\s+(?:IS|REMAINS)\s+(LOW|MEDIUM|HIGH)/i);

    const rec = {
      id,
      potential: pot ? pot[1].toUpperCase() : null,
      geoReference: geo ? `${geo[1]} NM ${geo[2].trim()} OF ${geo[3].trim()}` : null,
      windKtLow: wind ? +wind[1] : null,
      windKtHigh: wind ? +wind[2] : null,
      pressureMb: pres ? +pres[1] : null,
    };
    if (pos) {
      rec.lat = signedLatLon(pos[1], pos[2]);
      rec.lon = signedLatLon(pos[3], pos[4]);
      rec.distanceNm = Math.round(distanceNm(SPOT_LAT, SPOT_LON, rec.lat, rec.lon));
      rec.bearingDeg = Math.round(bearingDeg(SPOT_LAT, SPOT_LON, rec.lat, rec.lon));
    }
    out.push(rec);
  }
  return out;
}

/**
 * Tropical Cyclone Formation Alert — the step between "an area we're
 * watching" and a numbered warning. JTWC issues one when formation looks
 * likely within 12-24h, and it carries more than the disturbance summary
 * does: a corridor where formation is expected, the circulation centre,
 * movement, and a hard deadline by which the alert is upgraded, reissued
 * or cancelled.
 *
 * These appear in the same RSS item as the warnings but in their own block,
 * headed "Tropical Cyclone Formation Alert WTPN21" with no warning number —
 * which is why the warning parser skipped them entirely.
 */
function parseTcfaText(t) {
  const n = t.replace(/\s+/g, " ");
  const o = {};
  o.investId = (n.match(/FORMATION ALERT \(INVEST\s+(\d{2}[WSEPC])\)/i) || [])[1] || null;
  const area = n.match(/POSSIBLE WITHIN\s+(\d+)\s*NM EITHER SIDE OF A LINE FROM\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s+TO\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s+WITHIN THE NEXT\s+(\d+)\s+TO\s+(\d+)\s+HOURS/i);
  if (area) {
    o.corridorNm = +area[1];
    o.lineFrom = { lat: signedLatLon(area[2], area[3]), lon: signedLatLon(area[4], area[5]) };
    o.lineTo = { lat: signedLatLon(area[6], area[7]), lon: signedLatLon(area[8], area[9]) };
    o.windowLowH = +area[10];
    o.windowHighH = +area[11];
  }
  const c = n.match(/CIRCULATION CENTER IS LOCATED NEAR\s+([\d.]+)([NS])\s+([\d.]+)([EW])/i);
  if (c) {
    o.lat = signedLatLon(c[1], c[2]);
    o.lon = signedLatLon(c[3], c[4]);
    o.distanceNm = Math.round(distanceNm(SPOT_LAT, SPOT_LON, o.lat, o.lon));
    o.bearingDeg = Math.round(bearingDeg(SPOT_LAT, SPOT_LON, o.lat, o.lon));
  }
  const mv = n.match(/THE SYSTEM IS MOVING\s+([A-Z\- ]+?)\s+AT\s+(\d+)\s*KNOTS/i);
  if (mv) { o.movingText = mv[1].trim(); o.movingKt = +mv[2]; }
  const w = n.match(/WINDS IN THE AREA ARE ESTIMATED TO BE\s+(\d+)\s*TO\s*(\d+)\s*KNOTS/i);
  if (w) { o.areaWindKtLow = +w[1]; o.areaWindKtHigh = +w[2]; }
  const mw = n.match(/MAXIMUM SUSTAINED SURFACE WINDS ARE ESTIMATED AT\s+(\d+)\s*TO\s*(\d+)\s*KNOTS/i);
  if (mw) { o.maxWindKtLow = +mw[1]; o.maxWindKtHigh = +mw[2]; }
  const pr = n.match(/MINIMUM SEA LEVEL PRESSURE IS (?:ESTIMATED TO BE\s+)?NEAR\s+(\d+)\s*MB/i);
  if (pr) o.pressureMb = +pr[1];
  const pot = n.match(/POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT TROPICAL CYCLONE WITHIN THE NEXT\s+\d+\s+HOURS\s+(?:IS|REMAINS)\s+(LOW|MEDIUM|HIGH)/i);
  if (pot) o.potential = pot[1].toUpperCase();
  o.decisionByZ = (n.match(/REISSUED,?\s*UPGRADED TO WARNING OR CANCELLED BY\s+(\d{6}Z)/i) || [])[1] || null;
  return o;
}

/** Most recent existing CWA 96h track image for a named storm, or null. */
async function resolveCwaTrackImage(name, nowMs) {
  if (!name) return null;
  const upper = String(name).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!upper) return null;
  const sixH = 6 * 3600000;
  let slot = Math.floor(nowMs / sixH) * sixH;
  for (let i = 0; i < 5; i++, slot -= sixH) {
    const d = new Date(slot);
    const ts = d.toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const url = `${CWA_TRACK_BASE}/PTA_${ts}-96_${upper}_enus.png`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch (err) { /* try the next slot back */ }
  }
  return null;
}

/* --- Warning-text parsing (the "free layer") ---------------------------
 * JTWC's warning is rigidly structured — position, movement, intensity and
 * forecast points at every tau are all machine-readable, so none of it
 * needs a language model. The prognostic reasoning is mostly prose, but it
 * carries several structured fields including JTWC's own
 * SIGNIFICANT FORECAST CHANGES, which is the "what changed since last
 * time" summary written by the forecaster. Quoting that verbatim beats
 * generating one.
 *
 * Note the two products are NOT in lockstep: the reasoning usually lags the
 * warning by a cycle (and can still say "Typhoon" after a downgrade), so
 * both warning numbers are recorded and the page can say so.
 */
const SPOT_LAT = 22.975, SPOT_LON = 121.315; // Donghe
const NM_PER_RAD = 3440.065;

function toRad(d) { return (d * Math.PI) / 180; }

/** Great-circle distance in nautical miles. */
function distanceNm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * NM_PER_RAD;
}

/** Initial great-circle bearing in degrees. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function signedLatLon(v, hemi) {
  const n = parseFloat(v);
  return (hemi === "S" || hemi === "W") ? -n : n;
}

function parseWarningText(t) {
  const o = { forecasts: [] };
  o.warningNumber = (t.match(/WARNING NR\s*(\d+)/) || [])[1] || null;
  const dg = t.match(/\b(DOWNGRADED|UPGRADED)\s+(?:FROM|TO)\s+([A-Z][A-Z\s]*?\d{2}[A-Z])/);
  if (dg) o.intensityChangeNote = dg[0].trim();
  const wp = t.match(/WARNING POSITION:\s*\n\s*(\d{6}Z)\s*---\s*NEAR\s*([\d.]+)([NS])\s+([\d.]+)([EW])/);
  if (wp) { o.positionZ = wp[1]; o.lat = signedLatLon(wp[2], wp[3]); o.lon = signedLatLon(wp[4], wp[5]); }
  const mv = t.match(/MOVEMENT PAST SIX HOURS\s*-\s*(\d+)\s*DEGREES AT\s*(\d+)\s*KTS/);
  if (mv) { o.movingToward = +mv[1]; o.movingKt = +mv[2]; }
  const cw = t.match(/PRESENT WIND DISTRIBUTION:[\s\S]*?MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT,\s*GUSTS\s*(\d+)\s*KT/);
  if (cw) { o.maxWindKt = +cw[1]; o.gustKt = +cw[2]; }
  const fc = /(\d+)\s*HRS,\s*VALID AT:\s*\n\s*(\d{6}Z)\s*---\s*([\d.]+)([NS])\s+([\d.]+)([EW])\s*\n\s*MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT,\s*GUSTS\s*(\d+)\s*KT/g;
  let m;
  while ((m = fc.exec(t))) {
    o.forecasts.push({
      tau: +m[1], validZ: m[2],
      lat: signedLatLon(m[3], m[4]), lon: signedLatLon(m[5], m[6]),
      maxWindKt: +m[7], gustKt: +m[8],
    });
  }
  const pr = t.match(/MINIMUM CENTRAL PRESSURE AT \d{6}Z IS\s*(\d+)\s*MB/); if (pr) o.pressureMb = +pr[1];
  const sw = t.match(/MAXIMUM\s+SIGNIFICANT WAVE HEIGHT AT \d{6}Z IS\s*(\d+)\s*FEET/); if (sw) o.seasFt = +sw[1];
  const nx = t.match(/NEXT WARNINGS? AT\s*([\s\S]*?)\.\s*\/\//);
  if (nx) o.nextWarnings = nx[1].replace(/\s+/g, " ").split(/,\s*|\s+AND\s+/).map((s) => s.trim()).filter(Boolean);
  const geo = t.match(/LOCATED APPROXIMATELY\s*([\s\S]*?),\s*HAS TRACKED/);
  if (geo) o.geoReference = geo[1].replace(/\s+/g, " ").trim();
  return o;
}

function parseProgReasoning(t) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const o = {};
  o.warningNumber = (t.match(/WARNING NR\s*(\d+)/) || [])[1] || null;
  o.significantForecastChanges =
    clean((t.match(/SIGNIFICANT FORECAST CHANGES:\s*([\s\S]*?)(?=\n\s*\n|FORECAST DISCUSSION:)/i) || [])[1]) || null;
  const sw = t.match(/SIGNIFICANT WAVE HEIGHT:\s*(\d+)\s*FEET/i); if (sw) o.seasFt = +sw[1];
  const env = t.match(/FORECASTER ASSESSMENT OF CURRENT ENVIRONMENT:\s*([A-Z ]+)/i); if (env) o.environment = clean(env[1]);
  const vws = t.match(/VWS:\s*([^\n]+)/i); if (vws) o.vws = clean(vws[1]);
  const sst = t.match(/SST:\s*([^\n]+)/i); if (sst) o.sst = clean(sst[1]);
  const out = t.match(/OUTFLOW:\s*([^\n]+)/i); if (out) o.outflow = clean(out[1]);
  const steer = t.match(/CURRENT STEERING MECHANISM:\s*([\s\S]*?)(?=\n\s*\n)/i); if (steer) o.steering = clean(steer[1]);
  const fcB = t.match(/FORECAST CONFIDENCE:\s*([\s\S]*?)(?=\/\/|$)/i);
  if (fcB) {
    const b = fcB[1];
    o.confidence = {
      track0072: (b.match(/TRACK 00-72 HR:\s*(\w+)/i) || [])[1] || null,
      track72120: (b.match(/TRACK 72-120 HR:\s*(\w+)/i) || [])[1] || null,
      intensity0072: (b.match(/INTENSITY 00-72 HR:\s*(\w+)/i) || [])[1] || null,
      intensity72120: (b.match(/INTENSITY 72-120 HR:\s*(\w+)/i) || [])[1] || null,
    };
  }
  return o;
}

/** Smallest angle between two bearings, 0-180. */
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Where the track turns, derived from the forecast points rather than
 * scraped from JTWC's prose. Each leg's heading is the bearing between
 * consecutive forecast positions; a leg whose heading has swung far enough
 * from the last reference counts as a turn, and becomes the new reference,
 * so a long recurve reads as a sequence of turns instead of one blur.
 *
 * 35 degrees is deliberately coarse: wobble between 6-hourly points
 * shouldn't register, only a genuine change of direction.
 */
const TURN_THRESHOLD_DEG = 35;

function motionOutlook(w) {
  if (!w.forecasts || !w.forecasts.length || typeof w.lat !== "number") return null;
  const pts = [{ tau: 0, lat: w.lat, lon: w.lon }, ...w.forecasts];
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    legs.push({
      fromTau: pts[i].tau,
      toTau: pts[i + 1].tau,
      heading: Math.round(bearingDeg(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon)),
    });
  }
  if (!legs.length) return null;

  // Reference from JTWC's stated past-6h movement when we have it, else the
  // first forecast leg — otherwise a storm already mid-turn reads as straight.
  let ref = typeof w.movingToward === "number" ? w.movingToward : legs[0].heading;
  const turns = [];
  for (const l of legs) {
    if (angleDiff(l.heading, ref) >= TURN_THRESHOLD_DEG) {
      turns.push({ fromTau: l.fromTau, toTau: l.toTau, headingDeg: l.heading, deltaDeg: Math.round(angleDiff(l.heading, ref)) });
      ref = l.heading;
    }
  }
  return { currentHeadingDeg: ref === undefined ? null : (typeof w.movingToward === "number" ? w.movingToward : legs[0].heading), legs, turns };
}

/** Distance/bearing from Donghe now, and the closest the forecast track comes. */
function spotGeometry(w) {
  const g = {};
  if (typeof w.lat === "number" && typeof w.lon === "number") {
    g.distanceNm = Math.round(distanceNm(SPOT_LAT, SPOT_LON, w.lat, w.lon));
    g.bearingDeg = Math.round(bearingDeg(SPOT_LAT, SPOT_LON, w.lat, w.lon));
  }
  let best = null;
  for (const f of w.forecasts || []) {
    const d = Math.round(distanceNm(SPOT_LAT, SPOT_LON, f.lat, f.lon));
    if (!best || d < best.distanceNm) best = { distanceNm: d, tau: f.tau, validZ: f.validZ, maxWindKt: f.maxWindKt };
  }
  if (best && g.distanceNm !== undefined && best.distanceNm >= g.distanceNm) {
    // Never closer than it is now — say so rather than implying an approach.
    best.recedingOnly = true;
  }
  if (best) g.closestApproach = best;
  return g;
}

/** What changed since the previous archived cycle for this storm. */
function diffCycles(cur, prev) {
  if (!prev) return null;
  const d = { previousWarningNumber: prev.warningNumber, previousIssuedAt: prev.issuedAt };
  if (typeof cur.maxWindKt === "number" && typeof prev.maxWindKt === "number") d.maxWindKtDelta = cur.maxWindKt - prev.maxWindKt;
  if (typeof cur.pressureMb === "number" && typeof prev.pressureMb === "number") d.pressureMbDelta = cur.pressureMb - prev.pressureMb;
  if (typeof cur.seasFt === "number" && typeof prev.seasFt === "number") d.seasFtDelta = cur.seasFt - prev.seasFt;
  const curCa = cur.spot && cur.spot.closestApproach, prevCa = prev.spot && prev.spot.closestApproach;
  if (curCa && prevCa) d.closestApproachNmDelta = curCa.distanceNm - prevCa.distanceNm;
  // Track shift: compare forecast positions that share a valid time, so a
  // shifting tau doesn't masquerade as the storm moving.
  const prevByZ = {};
  (prev.forecasts || []).forEach((f) => { prevByZ[f.validZ] = f; });
  const shifts = [];
  for (const f of cur.forecasts || []) {
    const p = prevByZ[f.validZ];
    if (!p) continue;
    shifts.push({
      validZ: f.validZ, tau: f.tau,
      shiftNm: Math.round(distanceNm(p.lat, p.lon, f.lat, f.lon)),
      shiftToward: Math.round(bearingDeg(p.lat, p.lon, f.lat, f.lon)),
      maxWindKtDelta: f.maxWindKt - p.maxWindKt,
    });
  }
  if (shifts.length) {
    d.trackShifts = shifts;
    d.maxTrackShiftNm = Math.max(...shifts.map((s) => s.shiftNm));
  }
  return d;
}

async function enrichSystem(s, nowMs) {
  if (!s.warningText) return;
  try {
    const res = await fetch(s.warningText);
    if (res.ok) Object.assign(s, parseWarningText(await res.text()));
  } catch (err) { console.error(`WARN: warning text for ${s.id} (${err.message})`); }

  const progUrl = s.warningText.replace(/web\.txt$/, "prog.txt");
  try {
    const res = await fetch(progUrl);
    if (res.ok) {
      const progText = await res.text();
      const prog = parseProgReasoning(progText);
      prog.summaryCandidate = summarizeReasoning(progText);
      s.reasoning = prog;
      s.reasoningUrl = progUrl;
      // The reasoning routinely lags the warning by a cycle; flagged so the
      // page never presents a stale assessment as current.
      s.reasoningLagsWarning = !!(prog.warningNumber && s.warningNumber && prog.warningNumber !== s.warningNumber);
    }
  } catch (err) { console.error(`WARN: prog reasoning for ${s.id} (${err.message})`); }

  s.spot = spotGeometry(s);
  s.motion = motionOutlook(s);
}

/* --- Swell arrival, per storm -------------------------------------------
 * A plain reading of the Open-Meteo swell series for each active storm:
 * when its swell arrives, what it looks like then, and when and how big it
 * peaks. Every storm gets a verdict, including an explicit "no meaningful
 * swell" rather than silence.
 *
 * The biggest storm-aligned swell in the window is the peak; the arrival is
 * where that build starts, found by walking back from the peak to its
 * trough. It counts only if the height climbs clearly off that trough OR
 * the period steps up into groundswell range on the way. The first
 * version keyed on period alone (>=10s) and so missed
 * Surigae entirely: it passed ~300nm away and its swell came in on height —
 * 0.5m to 1.3m at Chenggong on Sep 26 — at only ~8s in both the model and
 * the buoy. A close storm's short fetch makes shorter-period swell; the
 * 10s rule only suited distant storms.
 *
 * Arrival is dated from where the build begins, not where it crosses the
 * threshold, since that's when the first of it shows at the beach. The peak
 * is the largest height in the aligned run that follows, quoted with its
 * own period (the forerunner lands long-period; the sea shortens as it
 * builds, so the arrival period would overstate the peak).
 *
 * Direction matching uses the storm's recent, current and forecast (to
 * 72h) positions, since the swell reaching Donghe was generated wherever
 * the storm was a day or two ago, not where it is now.
 *
 * The state carries between runs: once a swell has arrived its baseline is
 * gone from the series, so "arrived" is remembered from the previous run's
 * typhoon.json rather than re-detected.
 */
const SWELL_DIR_TOLERANCE = 45;  // how close the swell bearing must be to blame a storm
const SWELL_RISE_M = 0.3;        // height gain over the lowest point so far that counts as a new train
const SWELL_RISE_FRAC = 0.3;     // ...and at least this fraction, so 0.3m on a 3m sea doesn't count
const SWELL_BUILD_START_M = 0.1; // arrival is dated from the first step of the build
const SWELL_LONG_PERIOD_S = 10;  // a period jump into groundswell range also counts...
const SWELL_PERIOD_RISE_S = 2;   // ...if it's at least this far above the lowest period so far
const SWELL_MEANINGFUL_M = 0.4;  // a storm swell peaking below this isn't worth announcing
const WPAC_WEST_LON = 100;       // west of here is the Bay of Bengal / Andaman Sea

function stormBearings(s, history) {
  const pts = [];
  for (const r of history || []) if (typeof r.lat === "number") pts.push(r);
  if (typeof s.lat === "number") pts.push(s);
  for (const f of s.forecasts || []) if (f.tau <= 72) pts.push(f);
  return pts.map((p) => bearingDeg(SPOT_LAT, SPOT_LON, p.lat, p.lon));
}

function swellPoint(p) {
  return { targetTime: p.targetTime, heightM: p.swellHeight, periodS: p.swellPeriod, dirDeg: p.swellDirectionDeg };
}

function detectStormSwell(series, bearings, nowMs, prevSwell) {
  if (!series || !bearings.length) return null;
  const pts = series.filter((p) => isFinite(p.swellHeight) &&
    new Date(p.targetTime).getTime() >= nowMs - 3600000);
  if (pts.length < 8) return null;
  const windowEnd = pts[pts.length - 1].targetTime;
  const offset = (p) => isFinite(p.swellDirectionDeg)
    ? Math.min(...bearings.map((b) => angleDiff(p.swellDirectionDeg, b))) : 999;
  const aligned = (p) => offset(p) <= SWELL_DIR_TOLERANCE;

  // Largest height in the aligned run starting at `from`, allowing a couple
  // of hours' directional wobble before calling the run over.
  function peakFrom(from) {
    let peak = null, gap = 0;
    for (let j = from; j < pts.length; j++) {
      if (!aligned(pts[j])) { if (++gap > 3) break; continue; }
      gap = 0;
      if (!peak || pts[j].swellHeight > peak.heightM) peak = swellPoint(pts[j]);
    }
    return peak;
  }

  // Anchor on the biggest storm-aligned swell in the window, then walk back
  // to the trough it built from. Scanning forward for the first rise
  // instead was fooled by short model bumps — Dujuan's run of Sep 18 had a
  // 6-hour 0.3m blip on the 19th that it called the arrival, a day early.
  let peakI = -1;
  for (let i = 0; i < pts.length; i++) {
    if (aligned(pts[i]) && (peakI < 0 || pts[i].swellHeight > pts[peakI].swellHeight)) peakI = i;
  }
  let arrivalI = -1;
  if (peakI > 0) {
    let lo = peakI;
    // Small upticks (model noise) don't end the walk back; a real
    // earlier hump does.
    for (let j = peakI - 1; j >= 0; j--) {
      if (pts[j].swellHeight > pts[lo].swellHeight + 0.05) break;
      if (pts[j].swellHeight <= pts[lo].swellHeight) lo = j;
    }
    const loH = pts[lo].swellHeight, loP = pts[lo].swellPeriod;
    const peakH = pts[peakI].swellHeight;
    const periodJump = (q) => q.swellPeriod >= SWELL_LONG_PERIOD_S && q.swellPeriod - loP >= SWELL_PERIOD_RISE_S;
    const built = peakH - loH >= SWELL_RISE_M && peakH >= loH * (1 + SWELL_RISE_FRAC);
    if (built || pts.slice(lo, peakI + 1).some(periodJump)) {
      let a = lo + 1;
      while (a < peakI && pts[a].swellHeight < loH + SWELL_BUILD_START_M && !periodJump(pts[a])) a++;
      arrivalI = a;
    }
  }

  const base = { windowEnd };
  const prevArrivedAt = prevSwell && prevSwell.arrival && prevSwell.arrival.targetTime;
  const alreadyIn = prevArrivedAt && new Date(prevArrivedAt).getTime() <= nowMs && aligned(pts[0]);

  if (alreadyIn) {
    // Arrived on an earlier run and still lined up — keep the arrival that
    // was seen then and follow the peak from here.
    const peak = peakFrom(0);
    if (peak && peak.heightM >= SWELL_MEANINGFUL_M) {
      return Object.assign(base, {
        status: "in-water", arrival: prevSwell.arrival, now: swellPoint(pts[0]), peak,
        easing: peak.targetTime === pts[0].targetTime,
      });
    }
  }
  if (arrivalI >= 0) {
    const peak = swellPoint(pts[peakI]);
    if (peak && peak.heightM >= SWELL_MEANINGFUL_M) {
      const arrival = swellPoint(pts[arrivalI]);
      return Object.assign(base, {
        status: new Date(arrival.targetTime).getTime() <= nowMs + 3600000 ? "arriving" : "incoming",
        arrival, hoursAhead: Math.round((new Date(arrival.targetTime).getTime() - nowMs) / 3600000),
        bearingOffsetDeg: Math.round(offset(pts[arrivalI])), peak,
      });
    }
  }
  return Object.assign(base, { status: "none" });
}

/* --- Forecaster summary -------------------------------------------------
 * A 2-3 sentence digest of JTWC's prognostic reasoning, EXTRACTED rather
 * than written: the opening line of the satellite analysis (what the storm
 * is doing now), the opening line of the forecast discussion (where it's
 * going and why), and the first later line about intensity. JTWC writes
 * those openings as topic sentences, so they carry the gist.
 *
 * The all-caps teletype text is recased for reading — JTWC's own
 * abbreviations and a list of regional place names are kept capitalised,
 * and "TAU 48" becomes "+48h". Anything the list misses comes out lower
 * case; that's the known cost of recasing without a language model.
 *
 * Refreshed at most every SUMMARY_EVERY_HOURS (twice a day) even though the
 * reasoning is reissued every 6h — the digest is a daily-read overview, not
 * a feed of every revision.
 */
const SUMMARY_EVERY_HOURS = 12;
const SUMMARY_MAX_SENTENCE = 260;
const KEEP_UPPER = new Set(("TY STY TS TD STS VWS SST SSTS LLCC LLC STR JTWC TUTT ETT NM AB " +
  "ECMWF GFS CONW AI OHC EIR MSI JMA CWA NE NW SE SW NNE ENE ESE SSE SSW WSW WNW NNW").split(" "));
const PLACE_NAMES = ["Taiwan", "Luzon Strait", "Luzon", "Bashi Channel", "Philippine Sea", "Philippines",
  "Okinawa", "Kadena", "Japan", "Honshu", "Kyushu", "Shikoku", "Hokkaido", "Sea of Japan",
  "East China Sea", "South China Sea", "Yellow Sea", "China", "Hong Kong", "Hainan", "Vietnam",
  "Korean Peninsula", "Korea", "Guam", "Saipan", "Iwo To", "Yap", "Palau", "Manila", "Shanghai",
  "Minamidaito", "Ogasawara", "Chichi Jima", "Marcus Island", "Wake Island", "Kwajalein", "Pohnpei",
  "Chuuk", "Tokyo", "Busan", "Ryukyu", "Amami", "Andersen", "Celsius", "Dvorak", "Google DeepMind"];

function recase(s) {
  let out = s.replace(/\bTAU\s+(\d+)/g, "+$1h").replace(/\bKTS\b/g, "kt").toLowerCase();
  out = out.replace(/\b[a-z0-9]+\b/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) || /\d/.test(w)) && !/^\+?\d+h$/.test(w) ? w.toUpperCase() : w);
  for (const name of PLACE_NAMES) out = out.replace(new RegExp("\\b" + name + "\\b", "gi"), name);
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
}

function summarizeReasoning(t) {
  const section = (re) => ((t.match(re) || [])[1] || "").replace(/\s+/g, " ").trim();
  const sentences = (s) => s.split(/(?<=\.)\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
  const sat = sentences(section(/SATELLITE ANALYSIS[^:]*:\s*([\s\S]*?)(?=\n\s*\n)/i));
  const fc = sentences(section(/FORECAST DISCUSSION:\s*([\s\S]*?)(?=\n\s*\n|MODEL DISCUSSION:)/i));
  const picks = [];
  if (sat[0]) picks.push(sat[0]);
  if (fc[0]) picks.push(fc[0]);
  const inten = fc.slice(1).find((x) => /INTENSIF|WEAKEN|PEAK|DISSIPAT|EXTRATROPICAL|LANDFALL/i.test(x));
  if (inten) picks.push(inten);
  const kept = picks.filter((x) => x.length <= SUMMARY_MAX_SENTENCE);
  return kept.length ? kept.map(recase).join(" ") : null;
}

async function buildTyphoon(results) {
  const nowMs = Date.now();
  const [rssRes, abpwRes] = await Promise.all([fetch(JTWC_RSS), fetch(JTWC_ABPW)]);
  if (!rssRes.ok) throw new Error(`JTWC rss -> HTTP ${rssRes.status}`);
  const parsed = parseJtwcRss(await rssRes.text(), nowMs);

  // Fetch each alert's text for the detail the RSS block doesn't carry.
  for (const a of parsed.alerts) {
    try {
      const res = await fetch(a.textUrl);
      if (res.ok) Object.assign(a, parseTcfaText(await res.text()));
    } catch (err) { console.error(`WARN: TCFA text ${a.alertId} (${err.message})`); }
  }
  // Second basin check, on position: anything west of WPAC_WEST_LON is in
  // the Bay of Bengal / Andaman Sea whatever its product is called.
  parsed.alerts = parsed.alerts.filter((a) => !(typeof a.lon === "number" && a.lon < WPAC_WEST_LON));

  const prevData = await readJSONIfExists(path.join(DATA_DIR, "typhoon.json"), {});
  const prevById = {};
  for (const p of prevData.systems || []) prevById[p.id] = p;

  let invests = [];
  if (abpwRes.ok) {
    try { invests = parseInvests(await abpwRes.text()); }
    catch (err) { console.error(`WARN: invest parse failed (${err.message})`); }
  }

  for (const s of parsed.systems) {
    s.cwaTrackImage = await resolveCwaTrackImage(s.name, nowMs).catch(() => null);
    await enrichSystem(s, nowMs);
  }
  parsed.systems = parsed.systems.filter((s) => !(typeof s.lon === "number" && s.lon < WPAC_WEST_LON));

  // Archive every cycle. JTWC overwrites these files in place and keeps no
  // history, so a cycle not captured here is gone for good — which is why
  // this logs from day one rather than waiting for a reason to need it.
  // It's also what makes the cycle-over-cycle diff possible at all.
  let archive = { records: [] };
  const archivePath = path.join(HISTORY_DIR, "typhoon", `${monthKey()}.json`);
  try {
    archive = await readJSONIfExists(archivePath, { records: [] });
  } catch (err) { /* start fresh */ }

  // Every storm gets its own swell verdict — see detectStormSwell.
  const swellSeries = ((results || {})["openwave.json"] || {}).series;
  for (const s of parsed.systems) {
    const recent = archive.records.filter((r) => r.kind === "warning" && r.id === s.id &&
      r.issuedAt && nowMs - new Date(r.issuedAt).getTime() <= 72 * 3600000);
    const prev = prevById[s.id];
    s.swell = detectStormSwell(swellSeries, stormBearings(s, recent), nowMs, prev && prev.swell);
  }

  // Forecaster summary, refreshed twice a day — kept from the previous run
  // until 12h have passed and a newer reasoning is available.
  for (const s of parsed.systems) {
    const prev = (prevById[s.id] || {}).summary;
    const cand = s.reasoning && s.reasoning.summaryCandidate;
    const due = !prev || nowMs - new Date(prev.generatedAt).getTime() >= (SUMMARY_EVERY_HOURS - 0.5) * 3600000;
    if (cand && due && (!prev || prev.warningNumber !== s.reasoning.warningNumber)) {
      s.summary = { text: cand, warningNumber: s.reasoning.warningNumber, generatedAt: new Date(nowMs).toISOString() };
    } else if (prev) {
      s.summary = prev;
    }
    if (s.reasoning) delete s.reasoning.summaryCandidate;
  }

  for (const s of parsed.systems) {
    const prior = archive.records
      .filter((r) => r.id === s.id && r.warningNumber !== s.warningNumber)
      .sort((a, b) => String(a.warningNumber).localeCompare(String(b.warningNumber)));
    s.changes = diffCycles(s, prior[prior.length - 1] || null);
  }

  const newRecords = parsed.systems.map((s) => ({
    id: s.id, name: s.name, designation: s.designation,
    warningNumber: s.warningNumber, issuedAt: s.issuedAt, positionZ: s.positionZ,
    lat: s.lat, lon: s.lon, maxWindKt: s.maxWindKt, gustKt: s.gustKt,
    pressureMb: s.pressureMb, seasFt: s.seasFt,
    movingToward: s.movingToward, movingKt: s.movingKt,
    forecasts: s.forecasts, spot: s.spot,
    motion: s.motion,
    swell: s.swell || null,
    summary: s.summary || null,
    reasoningWarningNumber: s.reasoning ? s.reasoning.warningNumber : null,
    significantForecastChanges: s.reasoning ? s.reasoning.significantForecastChanges : null,
    confidence: s.reasoning ? s.reasoning.confidence : null,
  }));
  // Invests go into the same monthly file as the storms, tagged by kind, so
  // a system's whole life is visible in one place — 90W appearing as a
  // disturbance, then the same area becoming 24W once JTWC starts warning.
  // The IDs differ, so the lineage is read rather than joined automatically;
  // having both series side by side is what makes that possible at all.
  // Dedupe is by advisory issue time, since invests carry no warning number.
  const investIssuedAt = (parsed.advisory && parsed.advisory.issuedAt) || new Date(nowMs).toISOString();
  const alertRecords = parsed.alerts.map((a) => ({
    kind: "tcfa",
    id: a.investId || a.alertId, alertId: a.alertId, issuedAt: a.issuedAt,
    lat: a.lat, lon: a.lon, potential: a.potential,
    maxWindKtLow: a.maxWindKtLow, maxWindKtHigh: a.maxWindKtHigh, pressureMb: a.pressureMb,
    movingText: a.movingText, movingKt: a.movingKt,
    windowLowH: a.windowLowH, windowHighH: a.windowHighH, decisionByZ: a.decisionByZ,
    spot: (a.distanceNm !== undefined) ? { distanceNm: a.distanceNm, bearingDeg: a.bearingDeg } : null,
  }));

  const investRecords = invests.map((iv) => ({
    kind: "invest",
    id: iv.id, issuedAt: investIssuedAt,
    lat: iv.lat, lon: iv.lon,
    potential: iv.potential, geoReference: iv.geoReference,
    windKtLow: iv.windKtLow, windKtHigh: iv.windKtHigh, pressureMb: iv.pressureMb,
    spot: (iv.distanceNm !== undefined)
      ? { distanceNm: iv.distanceNm, bearingDeg: iv.bearingDeg }
      : null,
  }));

  const addedTyphoon = await appendMonthlyHistory(
    "typhoon",
    [
      ...newRecords.map((r) => Object.assign({ kind: "warning" }, r)),
      ...alertRecords,
      ...investRecords,
    ],
    (r) => {
      if (r.kind === "invest") return `invest|${r.id}|${r.issuedAt}`;
      if (r.kind === "tcfa") return `tcfa|${r.id}|${r.issuedAt}`;
      return `${r.id}|${r.warningNumber}`;
    }
  );

  return {
    data: {
      fetchedAt: new Date(nowMs).toISOString(),
      systems: parsed.systems,
      alerts: parsed.alerts,
      invests,
      // The basin-wide advisory satellite image — there's no per-invest
      // graphic, so this is how you eyeball whether a disturbance is worth
      // watching. Only carried when there's actually an invest.
      investSatellite: invests.length ? "https://www.metoc.navy.mil/jtwc/products/abpwsair.jpg" : null,
      advisory: parsed.advisory,
    },
    ok: true,
    count: parsed.systems.length + invests.length + parsed.alerts.length,
    archived: addedTyphoon,
  };
}

/**
 * Directory entries (position, name, type) for the buoys and the tide gauge
 * from O-B0076-001 — O-B0075-001's readings carry no coordinates, and
 * Phase 3 needs to know how far each observation is from Donghe and from
 * each model's grid point. Whole matched entries are kept as CWA sends
 * them rather than picking fields, since the shape hasn't been inspected.
 */
async function buildMarineStations() {
  const ids = [...BUOY_STATIONS.map((s) => s.id), TIDE_GAUGE_STATION_ID];
  const raw = await fetchDataset("O-B0076-001");
  const matches = findMatches(raw, STATION_ID_KEYS, ids);
  const byId = {};
  for (const m of matches) {
    const id = m[pickKey(m, STATION_ID_KEYS)];
    if (!byId[id]) byId[id] = m;
  }
  return { data: { stations: byId }, ok: Object.keys(byId).length > 0, count: Object.keys(byId).length };
}

async function buildBuoy() {
  const results = await Promise.all(BUOY_STATIONS.map((s) => buildBuoyStation(s).catch(() => null)));
  const stations = results.filter(Boolean);
  if (!stations.length) return { data: { records: { Stations: [] } }, ok: false, count: 0 };
  return { data: { records: { Stations: stations } }, ok: true, count: stations.length };
}

async function run() {
  await mkdir(DATA_DIR, { recursive: true });

  const jobs = [
    { file: "township.json", name: "F-D0047-039 township forecast", build: buildTownship },
    ...COASTAL_POINTS.map((p) => ({
      file: p.file,
      name: `F-D0047-095 coastal 3-day forecast (${p.townName}${p.displayed ? "" : ", logged only"})`,
      build: () => buildCoastal(p),
    })),
    { file: "tide.json", name: "F-A0021-001 tide forecast", build: buildTide },
    { file: "stations.json", name: "O-A0001-001 station observations", build: buildStations },
    { file: "buoy.json", name: "O-B0075-001 buoy / sea state", build: buildBuoy },
    { file: "marine-stations.json", name: "O-B0076-001 buoy + tide gauge positions", build: buildMarineStations },
    { file: "openwave.json", name: "Open-Meteo marine (Météo-France MFWAM)", build: buildOpenWave },
    { file: "ecmwf.json", name: "Open-Meteo ECMWF WAM + IFS (logged only)", build: buildEcmwf },
    { file: "gfs-wind.json", name: "Open-Meteo GFS wind (logged only)", build: buildGfsWind },
    { file: "gfs-wave.json", name: "Open-Meteo GFS-Wave 16km (logged only)", build: buildGfsWave },
    { file: "astronomy.json", name: "CWA astronomy (sun/moon/calendar)", build: buildAstronomy },
    { file: "typhoon.json", name: "JTWC typhoon news (W Pacific)", build: () => buildTyphoon(results) },
  ];

  const status = [];
  let stationMatches = [];
  const results = {}; // job.file -> full build() result, for Phase 2 logging below

  for (const job of jobs) {
    try {
      const result = await job.build();
      const { data, ok, count } = result;
      results[job.file] = result;
      if (job.file === "stations.json") stationMatches = result.matches || [];
      await writeFile(path.join(DATA_DIR, job.file), JSON.stringify(data, null, 2));
      status.push({ name: job.name, ok, count });
      console.log(`${ok ? "OK" : "WARN (no match, wrote raw payload)"}: ${job.name} (${count} records)`);
    } catch (err) {
      status.push({ name: job.name, ok: false, error: String(err.message || err) });
      console.error(`FAILED: ${job.name} — ${err.message || err}`);
    }
  }

  try {
    const history = await buildStationsHistory(stationMatches);
    const totalReadings = Object.values(history).reduce((n, s) => n + s.readings.length, 0);
    status.push({ name: "stations-history rolling log", ok: true, count: totalReadings });
    console.log(`OK: stations-history rolling log (${totalReadings} total readings across ${Object.keys(history).length} stations)`);
  } catch (err) {
    status.push({ name: "stations-history rolling log", ok: false, error: String(err.message || err) });
    console.error(`FAILED: stations-history rolling log — ${err.message || err}`);
  }

  // --- Phase 2: append this run's forecast/observation snapshots to the
  // monthly history logs, for Phase 3's accuracy comparison. ---
  try {
    const issuedAt = new Date().toISOString();
    const now = Date.now();
    const toleranceMs = 90 * 60 * 1000; // accept a nearest point within 90min of the target lead time

    // Forecast snapshots at each tracked lead time, per source. Wave sources
    // are 3-hourly/hourly instants matched to the nearest point; the township
    // wind forecast is 12-hour periods, matched by containment instead.
    const forecastRecords = [];
    const waveSources = [
      ...COASTAL_POINTS.map((p) => ({ name: p.source, series: (results[p.file] || {}).series || [] })),
      { name: "open_meteo", series: (results["openwave.json"] || {}).series || [] },
      { name: "ecmwf", series: (results["ecmwf.json"] || {}).series || [] },
      { name: "gfs_wind", series: (results["gfs-wind.json"] || {}).series || [] },
      { name: "gfs_wave", series: (results["gfs-wave.json"] || {}).series || [] },
    ];
    for (const src of waveSources) {
      for (const lead of LEAD_HOURS) {
        const targetMs = now + lead * 60 * 60 * 1000;
        const pt = nearestPoint(src.series, targetMs, toleranceMs);
        if (!pt) continue;
        forecastRecords.push({
          issuedAt, targetTime: pt.targetTime, leadHours: lead, source: src.name,
          waveHeight: pt.waveHeight, wavePeriod: pt.wavePeriod,
          waveDirectionDeg: pt.waveDirectionDeg !== undefined ? pt.waveDirectionDeg : null,
          waveDirectionText: pt.waveDirectionText || null,
          windSpeed: pt.windSpeed !== undefined ? pt.windSpeed : null,
          windScale: pt.windScale !== undefined ? pt.windScale : null,
          windDirectionDeg: pt.windDirectionDeg !== undefined ? pt.windDirectionDeg : null,
          windDirectionText: pt.windDirectionText || null,
          swellHeight: pt.swellHeight !== undefined ? pt.swellHeight : null,
          swellPeriod: pt.swellPeriod !== undefined ? pt.swellPeriod : null,
          swellDirectionDeg: pt.swellDirectionDeg !== undefined ? pt.swellDirectionDeg : null,
          // Only some sources carry these: peak period (ECMWF), gusts
          // (ECMWF, GFS), and the wind-sea partition (MFWAM, GFS-Wave).
          ...(pt.wavePeakPeriod !== undefined ? { wavePeakPeriod: pt.wavePeakPeriod } : {}),
          ...(pt.windGust !== undefined ? { windGust: pt.windGust } : {}),
          ...(pt.windWaveHeight !== undefined ? { windWaveHeight: pt.windWaveHeight } : {}),
          ...(pt.windWavePeriod !== undefined ? { windWavePeriod: pt.windWavePeriod } : {}),
        });
      }
    }

    // Township wind forecast for Donghe — scored in Phase 3 against station
    // C0S810's observed wind (logged below). Direction matters more than
    // speed here, hence both text and bearing.
    const townshipWind = (results["township.json"] || {}).windSeries || [];
    for (const lead of LEAD_HOURS) {
      const period = periodContaining(townshipWind, now + lead * 60 * 60 * 1000);
      if (!period) continue;
      forecastRecords.push({
        issuedAt, targetTime: period.startTime, endTime: period.endTime,
        leadHours: lead, source: "cwa_township_wind",
        windSpeed: period.windSpeed, windScale: period.windScale,
        windDirectionDeg: period.windDirectionDeg, windDirectionText: period.windDirectionText,
      });
    }
    const addedForecast = await appendMonthlyHistory("forecast", forecastRecords, (r) => `${r.issuedAt}|${r.leadHours}|${r.source}`);
    status.push({ name: "history/forecast log", ok: true, count: addedForecast });
    console.log(`OK: history/forecast log (+${addedForecast} records)`);

    // Buoy actuals (one record per station using its latest reading this run).
    // CWA uses the literal string "None" for a missing reading — normalize to null.
    // CWA returns every buoy reading as a string ("2.0") and uses the literal
    // "None" for a missing one. The forecast and station logs store real
    // numbers, and Phase 3 subtracts one from the other, so normalize here
    // rather than making every future consumer remember to coerce.
    const cleanNone = (v) => {
      if (v === "None" || v === undefined || v === null || v === "" || v === "-") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    };
    const buoyStations = ((results["buoy.json"] || {}).data || {}).records || {};
    // Chenggong (46761F) reports waves + sea temperature but has no
    // anemometer, so its wind fields stay null; the other three carry a
    // PrimaryAnemometer block.
    const buoyRecords = (buoyStations.Stations || []).map((st) => {
      const latest = (st.Readings || [])[st.Readings.length - 1];
      if (!latest) return null;
      const anem = latest.PrimaryAnemometer || {};
      return {
        observedAt: latest.DateTime, station: st.StationID, label: st.Label,
        waveHeight: cleanNone(latest.WaveHeight),
        wavePeriod: cleanNone(latest.WavePeriod),
        waveDirectionDeg: cleanNone(latest.WaveDirection),
        waveDirectionText: cleanNone(latest.WaveDirectionDescription),
        seaTemperature: cleanNone(latest.SeaTemperature),
        // No `|| null` fallbacks here: cleanNone already returns null for a
        // missing reading, and `0 || null` would turn a dead-calm 0 m/s into
        // "no data".
        windSpeed: cleanNone(anem.WindSpeed),
        windScale: cleanNone(anem.WindScale),
        windDirectionDeg: cleanNone(anem.WindDirection),
        windDirectionText: cleanNone(anem.WindDirectionDescription),
        windGust: cleanNone(anem.MaximumWindSpeed),
      };
    }).filter(Boolean);
    const addedBuoy = await appendMonthlyHistory("buoy", buoyRecords, (r) => `${r.observedAt}|${r.station}`);
    status.push({ name: "history/buoy log", ok: true, count: addedBuoy });
    console.log(`OK: history/buoy log (+${addedBuoy} records)`);

    // Land-station observed wind — the ground truth for the township wind
    // forecast above. data/stations-history.json only keeps a rolling 16h, so
    // this permanent log is what Phase 3 actually scores against.
    const stationRecords = stationMatches.map((s) => {
      const id = s.StationId || s.StationID;
      const we = s.WeatherElement || {};
      const observedAt = s.ObsTime && s.ObsTime.DateTime;
      if (!id || !observedAt) return null;
      // CWA uses -99 as its missing-value sentinel across this dataset (seen
      // on gusts, but it can appear on any element), so anything at or below
      // it is dropped rather than logged as a real reading.
      const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > -90 ? n : null;
      };
      const speed = num(we.WindSpeed);
      return {
        observedAt, station: id, name: s.StationName,
        windSpeed: speed,
        windScale: speed === null ? null : beaufort(speed),
        windDirectionDeg: num(we.WindDirection),
        windGust: num((we.GustInfo || {}).PeakGustSpeed),
        isWindForecastTarget: id === WIND_OBS_STATION_ID,
      };
    }).filter(Boolean);
    const addedStation = await appendMonthlyHistory("station", stationRecords, (r) => `${r.observedAt}|${r.station}`);
    status.push({ name: "history/station log", ok: true, count: addedStation });
    console.log(`OK: history/station log (+${addedStation} records)`);

    // Tide: every Chenggong gauge reading CWA returns, each against the
    // Chenggong prediction at that reading's own time — see tideRecord.
    const tidePoints = await updateTideExtrema(
      (results["tide.json"] || {}).gaugePoints || [], TIDE_GAUGE_FORECAST_LOCATION);
    // Only this month's readings: appendMonthlyHistory dedupes within the
    // current month's file, so a reading from the last hours of the
    // previous month would otherwise be logged twice across the boundary.
    const taipeiMonth = (iso) => new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 7);
    const readings = (await buildTideGaugeReadings().catch(() => []))
      .filter((r) => taipeiMonth(r.observedAt) === monthKey());
    const addedTide = await appendMonthlyHistory("tide",
      readings.map((r) => tideRecord(r.observedAt, r.observedCm, tidePoints)),
      (r) => `${r.observedAt}|${r.station}`);
    status.push({ name: "history/tide log", ok: true, count: addedTide });
    console.log(`OK: history/tide log (+${addedTide} records)`);
  } catch (err) {
    status.push({ name: "history logging", ok: false, error: String(err.message || err) });
    console.error(`FAILED: history logging — ${err.message || err}`);
  }

  // Update tracking — hash each displayed dataset so the page can show when
  // that source last actually published something new, and roughly when the
  // next one is due. Keyed to the element IDs the page renders into.
  try {
    const payloadOf = (file) => ((results[file] || {}).data);
    const updateLog = await buildUpdateLog({
      coastal: payloadOf("coastal.json"),
      openwave: payloadOf("openwave.json"),
      ecmwf: payloadOf("ecmwf.json"),
      township: payloadOf("township.json"),
      tide: payloadOf("tide.json"),
      stations: payloadOf("stations.json"),
      buoy: payloadOf("buoy.json"),
    }, new Date().toISOString());
    const changedNow = Object.entries(updateLog.sources)
      .filter(([, s]) => s.lastChangedAt === s.lastCheckedAt)
      .map(([k]) => k);
    status.push({ name: "update log", ok: true, count: changedNow.length });
    console.log(`OK: update log (${changedNow.length} source(s) changed: ${changedNow.join(", ") || "none"})`);
  } catch (err) {
    status.push({ name: "update log", ok: false, error: String(err.message || err) });
    console.error(`FAILED: update log — ${err.message || err}`);
  }

  const meta = {
    updatedAt: new Date().toISOString(),
    sources: status,
  };
  await writeFile(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  const anyFailed = status.some((s) => s.ok === false && s.error);
  if (anyFailed) process.exitCode = 1;
}

run();
