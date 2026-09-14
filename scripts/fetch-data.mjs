#!/usr/bin/env node
/**
 * Fetches CWA (Central Weather Administration) Open Data for the
 * Taitung Surf Dashboard and writes trimmed JSON files into data/.
 *
 * Requires the CWA_API_KEY environment variable (see README.md for
 * how to obtain a key and wire it up as a GitHub Actions secret).
 *
 * Datasets used:
 *   F-D0047-039  鄉鎮天氣預報-臺東縣未來1週天氣預報 (township forecast) -> data/township.json
 *   F-D0047-095  鄉鎮沿海3天逐3小時預報 (coastal wave)  -> data/coastal.json
 *   F-A0021-001  潮汐預報 (tide forecast)               -> data/tide.json
 *   O-A0001-001  自動氣象站 (station observations)      -> data/stations.json
 *   O-B0075-001  48小時浮標/潮位站海況監測 (buoy / sea state) -> data/buoy.json
 *                (O-B0076-001 was tried first but is just a station
 *                directory — no live readings — so this replaces it)
 *
 * Each dataset is fetched in full and then trimmed down client-side to
 * just the records relevant to Donghe / Chenggong, so a mismatch in a
 * server-side filter parameter can't silently return an empty result.
 * If extraction finds nothing, the raw payload is kept so it can be
 * inspected later, and the failure is recorded in data/meta.json.
 */

import { writeFile, mkdir } from "node:fs/promises";
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
const BUOY_STATION_ID = "46761F";
const TIDE_LOCATION_NAME = "臺東縣東河鄉";
const TOWNSHIP_LOCATION_NAME = "東河鄉";

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
  return {
    data: { records: { TideForecasts: matches.map((loc) => ({ Location: loc })) } },
    ok: true,
    count: matches.length,
  };
}

async function buildStations() {
  const raw = await fetchDataset("O-A0001-001");
  const matches = findMatches(raw, STATION_ID_KEYS, TOWNSHIP_STATION_IDS);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return { data: { records: { Station: matches } }, ok: true, count: matches.length };
}

async function buildBuoy() {
  // This is a time-series/monitoring dataset — an unfiltered request returns
  // just a bare station index, not readings. Filter server-side by station.
  // Confirmed real shape (rest/datastore, PascalCase throughout):
  //   Records.SeaSurfaceObs.Location[] = {
  //     Station: { StationID },
  //     StationObsTimes: { StationObsTime: [{ DateTime, WeatherElements: {...} }] }
  //   }
  // The station-identifying object is nested separately from the readings,
  // so a generic key/value walk (which returns the *innermost* matching
  // object) grabs just `{ StationID }` and misses the sibling data — this
  // needs to walk explicitly instead.
  const raw = await fetchDataset("O-B0075-001", { StationID: BUOY_STATION_ID });
  const records = raw.Records || raw.records || {};
  const seaSurfaceObs = records.SeaSurfaceObs || records.seaSurfaceObs || {};
  const locations = seaSurfaceObs.Location || seaSurfaceObs.location || [];
  const loc =
    locations.find((l) => l.Station && l.Station.StationID === BUOY_STATION_ID) || locations[0];
  if (!loc) return { data: raw, ok: false, count: 0 };

  const times = (loc.StationObsTimes && loc.StationObsTimes.StationObsTime) || [];
  const valid = times.filter((t) => t.WeatherElements && t.WeatherElements.WaveHeight !== "None");
  const latest = valid.slice().sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))[0];
  if (!latest) return { data: raw, ok: false, count: 0 };

  const station = {
    StationID: BUOY_STATION_ID,
    ObsTime: { DateTime: latest.DateTime },
    WeatherElement: latest.WeatherElements,
  };
  return { data: { records: { Station: [station] } }, ok: true, count: 1 };
}

async function run() {
  await mkdir(DATA_DIR, { recursive: true });

  const jobs = [
    { file: "township.json", name: "F-D0047-039 township forecast", build: buildTownship },
    { file: "coastal.json", name: "F-D0047-095 coastal 3-day forecast", build: buildCoastal },
    { file: "tide.json", name: "F-A0021-001 tide forecast", build: buildTide },
    { file: "stations.json", name: "O-A0001-001 station observations", build: buildStations },
    { file: "buoy.json", name: "O-B0075-001 buoy / sea state", build: buildBuoy },
  ];

  const status = [];

  for (const job of jobs) {
    try {
      const { data, ok, count } = await job.build();
      await writeFile(path.join(DATA_DIR, job.file), JSON.stringify(data, null, 2));
      status.push({ name: job.name, ok, count });
      console.log(`${ok ? "OK" : "WARN (no match, wrote raw payload)"}: ${job.name} (${count} records)`);
    } catch (err) {
      status.push({ name: job.name, ok: false, error: String(err.message || err) });
      console.error(`FAILED: ${job.name} — ${err.message || err}`);
    }
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
