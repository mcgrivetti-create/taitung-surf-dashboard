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
 *   F-A0021-001  Tide forecast (next 1 month)                  -> data/tide.json
 *   O-A0001-001  Automatic weather stations (latest snapshot)  -> data/stations.json,
 *                accumulated into a rolling 8-hour history at data/stations-history.json
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

// Buoy stations to show, looked up from O-B0076-001's full station directory.
const BUOY_STATIONS = [
  { id: "46761F", label: "Chenggong" },
  { id: "WRA007", label: "Taitung" },
  { id: "46699A", label: "Hualien" },
  { id: "46694A", label: "Longdong" },
];

const STATION_HISTORY_HOURS = 8;
const BUOY_HISTORY_HOURS = 24;

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

async function fetchDataset(id, extraParams) {
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
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
  };
}

async function buildCoastal() {
  const raw = await fetchDataset("F-D0047-095");
  const matches = findMatchesContaining(raw, LOCATION_NAME_KEYS, TOWNSHIP_LOCATION_NAME);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
  };
}

async function buildTide() {
  const raw = await fetchDataset("F-A0021-001");
  const matches = findMatches(raw, LOCATION_NAME_KEYS, [TIDE_LOCATION_NAME]);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
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
  const count = (data.hourly && data.hourly.time && data.hourly.time.length) || 0;
  if (!count) return { data, ok: false, count: 0 };
  return { data, ok: true, count };
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
    { file: "coastal.json", name: "F-D0047-095 coastal 3-day forecast", build: buildCoastal },
    { file: "tide.json", name: "F-A0021-001 tide forecast", build: buildTide },
    { file: "stations.json", name: "O-A0001-001 station observations", build: buildStations },
    { file: "buoy.json", name: "O-B0075-001 buoy / sea state", build: buildBuoy },
    { file: "openwave.json", name: "Open-Meteo marine (GFS-Wave)", build: buildOpenWave },
  ];

  const status = [];
  let stationMatches = [];

  for (const job of jobs) {
    try {
      const result = await job.build();
      const { data, ok, count } = result;
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

  const meta = {
    updatedAt: new Date().toISOString(),
    sources: status,
  };
  await writeFile(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  const anyFailed = status.some((s) => s.ok === false && s.error);
  if (anyFailed) process.exitCode = 1;
}

run();
