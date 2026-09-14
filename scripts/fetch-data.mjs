#!/usr/bin/env node
/**
 * Fetches CWA (Central Weather Administration) Open Data for the
 * Taitung Surf Dashboard and writes trimmed JSON files into data/.
 *
 * Requires the CWA_API_KEY environment variable (see README.md for
 * how to obtain a key and wire it up as a GitHub Actions secret).
 *
 * Datasets used:
 *   F-D0047-093  鄉鎮天氣預報 (township forecast)      -> data/township.json
 *   F-D0047-095  鄉鎮沿海3天逐3小時預報 (coastal wave)  -> data/coastal.json
 *   F-A0021-001  潮汐預報 (tide forecast)               -> data/tide.json
 *   O-A0001-001  自動氣象站 (station observations)      -> data/stations.json
 *   O-B0076-001  浮標/潮位站海象觀測 (buoy / sea state)  -> data/buoy.json
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

const BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";

const TOWNSHIP_STATION_IDS = ["C0S81", "C0SA3", "C0T9I"];
const BUOY_STATION_ID = "46761F";
const TIDE_LOCATION_NAME = "臺東縣東河鄉";
const TOWNSHIP_LOCATION_NAME = "東河鄉";

async function fetchDataset(id) {
  const url = new URL(`${BASE}/${id}`);
  url.searchParams.set("Authorization", API_KEY);
  url.searchParams.set("format", "JSON");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${id} -> HTTP ${res.status}`);
  }
  return res.json();
}

/** Recursively collects every object where obj[key] is in `values`. */
function findMatches(obj, key, values, results = [], seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return results;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) findMatches(item, key, values, results, seen);
  } else {
    if (obj[key] !== undefined && values.includes(obj[key])) results.push(obj);
    for (const v of Object.values(obj)) findMatches(v, key, values, results, seen);
  }
  return results;
}

/** Recursively collects every object where obj[key] is a string containing `substr`. */
function findMatchesContaining(obj, key, substr, results = [], seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return results;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) findMatchesContaining(item, key, substr, results, seen);
  } else {
    if (typeof obj[key] === "string" && obj[key].includes(substr)) results.push(obj);
    for (const v of Object.values(obj)) findMatchesContaining(v, key, substr, results, seen);
  }
  return results;
}

async function buildTownship() {
  const raw = await fetchDataset("F-D0047-093");
  const matches = findMatchesContaining(raw, "locationName", TOWNSHIP_LOCATION_NAME);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
  };
}

async function buildCoastal() {
  const raw = await fetchDataset("F-D0047-095");
  const matches = findMatchesContaining(raw, "locationName", TOWNSHIP_LOCATION_NAME);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return {
    data: { records: { locations: [{ location: matches }] } },
    ok: true,
    count: matches.length,
  };
}

async function buildTide() {
  const raw = await fetchDataset("F-A0021-001");
  const matches = findMatches(raw, "LocationName", [TIDE_LOCATION_NAME]);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return {
    data: { records: { TideForecasts: matches.map((loc) => ({ Location: loc })) } },
    ok: true,
    count: matches.length,
  };
}

async function buildStations() {
  const raw = await fetchDataset("O-A0001-001");
  const matches = findMatches(raw, "StationId", TOWNSHIP_STATION_IDS);
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return { data: { records: { Station: matches } }, ok: true, count: matches.length };
}

async function buildBuoy() {
  const raw = await fetchDataset("O-B0076-001");
  let matches = findMatches(raw, "StationId", [BUOY_STATION_ID]);
  if (!matches.length) matches = findMatchesContaining(raw, "StationName", "成功");
  if (!matches.length) return { data: raw, ok: false, count: 0 };
  return { data: { records: { Station: matches } }, ok: true, count: matches.length };
}

async function run() {
  await mkdir(DATA_DIR, { recursive: true });

  const jobs = [
    { file: "township.json", name: "F-D0047-093 township forecast", build: buildTownship },
    { file: "coastal.json", name: "F-D0047-095 coastal 3-day forecast", build: buildCoastal },
    { file: "tide.json", name: "F-A0021-001 tide forecast", build: buildTide },
    { file: "stations.json", name: "O-A0001-001 station observations", build: buildStations },
    { file: "buoy.json", name: "O-B0076-001 buoy / sea state", build: buildBuoy },
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
