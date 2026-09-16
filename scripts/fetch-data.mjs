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
 *   Open-Meteo Marine API (no key, NOAA GFS-Wave)               -> data/openwave.json
 *                Independent of CWA and the commercial widgets —
 *                a fallback wave forecast that isn't tied to any of them.
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
 *                                   open_meteo, cwa_township_wind
 *   history/buoy/YYYY-MM.json      actual buoy readings (one per station
 *                                   per run) — waves, wave direction, and
 *                                   wind where the station has an anemometer
 *   history/station/YYYY-MM.json   actual land-station wind (one per station
 *                                   per run) — ground truth for the township
 *                                   wind forecast, and permanent unlike the
 *                                   rolling 16h data/stations-history.json
 *   history/tide/YYYY-MM.json      tide forecast (interpolated at "now")
 *                                   vs observed (Chenggong gauge C4S02)
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
const LEAD_HOURS = [6, 12, 24, 48];
const TIDE_GAUGE_STATION_ID = "C4S02"; // 成功潮位站 (Chenggong tide gauge), from O-B0076-001's directory
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

async function buildTide() {
  const raw = await fetchDataset("F-A0021-001");
  const matches = findMatches(raw, LOCATION_NAME_KEYS, [TIDE_LOCATION_NAME]);
  if (!matches.length) return { data: raw, ok: false, count: 0, points: [] };
  // The Daily array isn't returned in chronological order — sort it and
  // keep only the next few days so the page doesn't need to guess.
  matches.forEach((loc) => {
    const daily = loc.TimePeriods && loc.TimePeriods.Daily;
    if (Array.isArray(daily)) {
      daily.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
      loc.TimePeriods.Daily = daily.filter((d) => d.Date >= todayISODate()).slice(0, 5);
    }
  });

  // Flat {t, h} extrema points for the Phase 2 logger's tide interpolation.
  const points = [];
  const daily = matches[0].TimePeriods && matches[0].TimePeriods.Daily;
  (daily || []).forEach((day) => {
    (day.Time || []).forEach((t) => {
      const h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL);
      points.push({ t: new Date(t.DateTime).getTime(), h: Number(h) });
    });
  });

  return {
    data: { records: { TideForecasts: matches.map((loc) => ({ Location: loc })) } },
    ok: true,
    count: matches.length,
    points,
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
 * Latest observed tide height at the Chenggong tide gauge (C4S02) — ground
 * truth for the Phase 3 tide forecast-vs-observed comparison. Same
 * O-B0075-001 dataset and response shape as the wave buoys, just a
 * TideHeight field instead of WaveHeight.
 */
async function buildTideGaugeActual() {
  const raw = await fetchDataset("O-B0075-001", { StationID: TIDE_GAUGE_STATION_ID });
  const records = raw.Records || raw.records || {};
  const seaSurfaceObs = records.SeaSurfaceObs || records.seaSurfaceObs || {};
  const locations = seaSurfaceObs.Location || seaSurfaceObs.location || [];
  const loc = locations.find((l) => l.Station && l.Station.StationID === TIDE_GAUGE_STATION_ID) || locations[0];
  if (!loc) return null;
  const times = (loc.StationObsTimes && loc.StationObsTimes.StationObsTime) || [];
  const valid = times.filter((t) => t.WeatherElements && t.WeatherElements.TideHeight !== "None");
  const latest = valid.slice().sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))[0];
  if (!latest) return null;
  return { observedAt: latest.DateTime, tideHeightCm: Number(latest.WeatherElements.TideHeight) };
}

/**
 * Independent wave forecast from Open-Meteo's free Marine API (no key
 * required, backed by NOAA NCEP GFS-Wave) — doesn't depend on CWA or any
 * of the commercial embeds, so it's a fallback source of real wave data.
 */
async function buildOpenWave() {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", "22.975");
  url.searchParams.set("longitude", "121.315");
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
  }));

  return { data, ok: true, count, series };
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
    { file: "openwave.json", name: "Open-Meteo marine (GFS-Wave)", build: buildOpenWave },
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

    // Tide: forecast (interpolated at "now" from this run's extrema) vs
    // observed (Chenggong gauge, closest reading to "now").
    const tidePoints = (results["tide.json"] || {}).points || [];
    const forecastCm = tidePoints.length ? cosineInterpolate(tidePoints, now) : null;
    const gauge = await buildTideGaugeActual().catch(() => null);
    if (forecastCm !== null || gauge) {
      const tideRecord = {
        at: issuedAt,
        forecastCm: forecastCm !== null ? Math.round(forecastCm * 10) / 10 : null,
        observedCm: gauge ? gauge.tideHeightCm : null,
        observedAt: gauge ? gauge.observedAt : null,
        station: TIDE_GAUGE_STATION_ID,
      };
      const addedTide = await appendMonthlyHistory("tide", [tideRecord], (r) => r.at);
      status.push({ name: "history/tide log", ok: true, count: addedTide });
      console.log(`OK: history/tide log (+${addedTide} records)`);
    }
  } catch (err) {
    status.push({ name: "history logging", ok: false, error: String(err.message || err) });
    console.error(`FAILED: history logging — ${err.message || err}`);
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
