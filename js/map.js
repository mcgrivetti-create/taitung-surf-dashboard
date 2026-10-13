/* Surf map — opened from the "Map" button in the header (launched 2026-10-13).
   West Pacific wind, waves and swell from data/wxgrid.json (Open-Meteo, 3°
   grid, rebuilt every 6 h by scripts/fetch-data.mjs), with live wind lines,
   a 10-day time bar, and our buoys, stations, tide gauge and Donghe on top.
   Opens with a barrel wave and closes with a whitewater close-out.
   Nothing here loads until the Map button is first tapped. */
(function () {
  "use strict";
  var btn = document.getElementById("openMap");
  if (!btn) return;
  var MAP_HTML = [
    '<div id="mapView" hidden role="dialog" aria-modal="true" aria-label="Surf map">',
    '<canvas id="cField"></canvas><canvas id="cFlow"></canvas><canvas id="cTop"></canvas><div id="marks"></div>',
    '<div class="m-top"><div class="layers" role="group" aria-label="Map layer">',
    '<button type="button" data-layer="wind" aria-pressed="true">Wind</button><button type="button" data-layer="waves" aria-pressed="false">Waves</button><button type="button" data-layer="swell" aria-pressed="false">Swell</button></div>',
    '<button type="button" class="m-close" id="closeMap" aria-label="Close map and return to the dashboard">✕</button></div>',
    '<div class="legend-bar" id="legend"></div>',
    '<div class="m-side"><button type="button" id="zin" aria-label="Zoom in">+</button><button type="button" id="zout" aria-label="Zoom out">−</button>',
    '<button type="button" class="txt" id="zTw" aria-label="Show Taiwan">TW</button><button type="button" class="txt" id="zDh" aria-label="Zoom to Donghe">DH</button></div>',
    '<div class="m-bottom"><div class="m-time"><button type="button" class="play" id="play" aria-label="Play">▶</button><span class="clock" id="clock"></span></div>',
    '<div class="days" id="days" aria-label="Map time — tap or drag"></div></div>',
    '<section class="sheet" id="sheet" aria-live="polite"><button type="button" class="sheet-x" id="sheetX" aria-label="Close details">✕</button><div id="sheetBody"></div></section>',
    '</div><canvas id="fx" hidden aria-hidden="true"></canvas>',
  ].join("");
  function fetchJSON(p) { return fetch(p, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function opt(p) { return fetchJSON(p).catch(function () { return null; }); }
  var booted = false, loading = false, label = btn.innerHTML;
  btn.addEventListener("click", function () {
    if (booted || loading) return;
    loading = true; btn.setAttribute("aria-busy", "true"); btn.innerHTML = "Loading…";
    Promise.all([fetchJSON("data/wxgrid.json"), fetchJSON("js/map-coast.json?v=1"), opt("data/buoy.json"), opt("data/stations-history.json"),
      opt("data/openwave.json"), opt("data/coastal.json"), opt("data/tide.json"), opt("data/phase3-live.json")])
      .then(function (r) {
        var D = { buoy: r[2] || {}, stations: r[3] || {}, ow: r[4] || {}, coastal: r[5] || {}, tide: r[6] || {}, live: r[7] || {} };
        var open = boot(D, r[0], r[1]); booted = true; btn.innerHTML = label; btn.removeAttribute("aria-busy"); open();
      })
      .catch(function (e) { btn.innerHTML = label; btn.removeAttribute("aria-busy"); btn.title = "The map couldn't load (" + e.message + "). Try again."; })
      .then(function () { loading = false; });
  });

  function boot(D, G, COAST) {
  document.body.insertAdjacentHTML("beforeend", MAP_HTML);
  var H = 3600000, TZ = "Asia/Taipei";
  var NOW = Date.now();
  var fmt = function (o) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ, hourCycle: "h23" }, o)); };
  var fHM = fmt({ hour: "2-digit", minute: "2-digit" }), fDow = fmt({ weekday: "short" }), fDay = fmt({ day: "numeric" }), fWHM = fmt({ weekday: "short", hour: "2-digit", minute: "2-digit" }), fH = fmt({ hour: "2-digit" });
  function num(v) { if (v === null || v === undefined || v === "" || v === "None") return null; var n = Number(v); return isFinite(n) ? n : null; }
  function r1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function kt(ms) { return ms * 1.94384; }
  var C16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function compass(d) { return C16[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function angDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  var ZH = { "北": 0, "北北東": 22.5, "東北": 45, "東北東": 67.5, "東": 90, "東南東": 112.5, "東南": 135, "南南東": 157.5, "南": 180, "南南西": 202.5, "西南": 225, "西南西": 247.5, "西": 270, "西北西": 292.5, "西北": 315, "北北西": 337.5 };
  function zh(t) { if (!t) return null; var b = String(t).trim().replace(/風$/, "").replace(/^偏/, ""); return ZH[b] === undefined ? null : ZH[b]; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function dayKey(t) { return new Date(t + 8 * H).toISOString().slice(0, 10); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- rating (WaveSlave's rules, as on the dashboard) ---------- */
  function windKind(from) { var d = angDiff(from, 280); return d <= 55 ? "off" : d <= 115 ? "cross" : "on"; }
  function exposure(dir) { if (dir === null || dir === undefined) return 1; var d = angDiff(dir, 100); return d <= 45 ? 1 : d <= 90 ? 0.5 : 0.2; }
  function score(h, p, w) {
    var s = h < 0.4 ? 0 : h < 0.8 ? 1 : h < 1.2 ? 2 : h <= 2.5 ? 3 : h <= 3.5 ? 2 : 1, pp = p === null ? 0 : p * 1.3, hard = false;
    s += pp < 6 ? 0 : pp < 8 ? 1 : pp < 10 ? 2 : 3;
    if (w && w.from !== null && w.from !== undefined) { var k = windKind(w.from), v = w.rain ? w.kt / 2 : w.kt; if (v < 5) s += 2; else if (k === "off") s += v < 20 ? 2 : 1; else if (k === "cross") s += v < 10 ? 0 : -1; else s += v < 10 ? -1 : -2; hard = k === "off" && v >= 10; }
    s = Math.max(0, Math.min(8, s)); return s >= 7 && !hard ? 6 : s;
  }
  var RN = ["Flat", "Poor", "Fair", "Good", "Drop everything and go now!!!"];
  function rating(s) { var r = s <= 1 ? 0 : s <= 3 ? 1 : s <= 5 ? 2 : s <= 6 ? 3 : 4; return '<span class="rt rt-' + ["flat", "poor", "fair", "good", "firing"][r] + '">' + RN[r] + "</span>"; }

  /* ---------- our data (same adapters as the dashboard) ---------- */
  var buoyById = {};
  ((D.buoy.records || {}).Stations || []).forEach(function (s) { buoyById[s.StationID] = (s.Readings || []).filter(function (r) { return num(r.WaveHeight) !== null; }); });
  function stationRows(id) { return ((D.stations[id] || {}).readings || []).filter(function (x) { return num(x.WindSpeed) !== null; }); }
  var ow = (function () { var h = D.ow.hourly || {}; return (h.time || []).map(function (t, i) { return { t: new Date(t + ":00+08:00").getTime(), h: num(h.wave_height[i]), p: num(h.wave_period[i]), d: num(h.wave_direction[i]), sh: num(h.swell_wave_height[i]), sp: num(h.swell_wave_period[i]) }; }); })();
  var cwa = (function () {
    try { var loc = D.coastal.records.locations[0].location[0], els = {}; (loc.WeatherElement || []).forEach(function (w) { els[w.ElementName] = w.Time || []; });
      function val(n, f) { var m = {}; (els[n] || []).forEach(function (t) { var v = t.ElementValue; v = Array.isArray(v) ? v[0] : v; m[t.DataTime] = v ? v[f] : null; }); return m; }
      var s = val("風速", "WindSpeed"), d = val("風向", "WindDirection"), wx = val("天氣現象", "Weather");
      return Object.keys(s).map(function (k) { return { t: Date.parse(k), s: num(s[k]), d: zh(d[k]), rain: /雨/.test(wx[k] || "") }; }).filter(function (p) { return p.s !== null; }).sort(function (a, b) { return a.t - b.t; });
    } catch (e) { return []; }
  })();
  var tideEx = (function () { var out = []; try { D.tide.records.TideForecasts[0].Location.TimePeriods.Daily.forEach(function (day) { (day.Time || []).forEach(function (t) { var h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL); out.push({ t: Date.parse(t.DateTime), h: Number(h), high: t.Tide === "滿潮" }); }); }); } catch (e) {} return out.sort(function (a, b) { return a.t - b.t; }); })();
  function tideAt(t) { for (var i = 0; i < tideEx.length - 1; i++) if (t >= tideEx[i].t && t <= tideEx[i + 1].t) { var f = (t - tideEx[i].t) / (tideEx[i + 1].t - tideEx[i].t), mu = (1 - Math.cos(f * Math.PI)) / 2; return { h: tideEx[i].h * (1 - mu) + tideEx[i + 1].h * mu, rising: tideEx[i + 1].h > tideEx[i].h }; } return null; }
  function nearest(arr, t, maxMs) { var best = null, bd = Infinity; arr.forEach(function (p) { var d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }); return best && bd <= maxMs ? best : null; }
  function donghePoint(t) {
    var wv = nearest(ow.filter(function (p) { return p.h !== null; }), t, 0.6 * H), wn = nearest(cwa, t, 3 * H);
    var w = wn ? { kt: kt(wn.s), from: wn.d, rain: wn.rain } : null;
    return { wv: wv, w: w, s: wv ? score(wv.h * exposure(wv.d), wv.p, w) : null };
  }


  /* ---------- grid ---------- */
  var T0 = new Date(G.t0 + ":00+08:00").getTime(), TEND = T0 + (G.nt - 1) * G.dt * H, NP = G.nlat * G.nlon;
  function gv(arr, pt, k) { var v = arr[pt][k]; return v === null || v === undefined ? null : v; }
  // value at grid point for fractional step; directions interpolated as vectors by the callers
  function fieldAt(lon, lat, t, kind) {
    var fi = (lat - G.lat0) / G.dlat, fj = (lon - G.lon0) / G.dlon;
    if (fi < 0 || fj < 0 || fi > G.nlat - 1 || fj > G.nlon - 1) return null;
    var st = Math.max(0, Math.min(G.nt - 1, (t - T0) / (G.dt * H))), k0 = Math.floor(st), k1 = Math.min(G.nt - 1, k0 + 1), fk = st - k0;
    var i0 = Math.floor(fi), j0 = Math.floor(fj), a = fi - i0, b = fj - j0, sw = 0, acc = { u: 0, v: 0, m: 0, p: 0 };
    for (var di = 0; di < 2; di++) for (var dj = 0; dj < 2; dj++) {
      var ii = Math.min(G.nlat - 1, i0 + di), jj = Math.min(G.nlon - 1, j0 + dj), pt = ii * G.nlon + jj, w = (di ? a : 1 - a) * (dj ? b : 1 - b);
      if (w <= 0) continue;
      for (var kk = 0; kk < 2; kk++) {
        var k = kk ? k1 : k0, wk = w * (kk ? fk : 1 - fk); if (wk <= 0) continue;
        var mag, dir, per = null;
        if (kind === "wind") { mag = gv(G.ws, pt, k); dir = gv(G.wd, pt, k); }
        else if (kind === "waves") { mag = gv(G.wh, pt, k); dir = gv(G.wdir, pt, k); per = gv(G.wp, pt, k); if (mag !== null) mag /= 10; if (per !== null) per /= 10; }
        else { mag = gv(G.sh, pt, k); dir = gv(G.sd, pt, k); per = gv(G.sp, pt, k); if (mag !== null) mag /= 10; if (per !== null) per /= 10; }
        if (mag === null || dir === null) continue;
        var rad = dir * Math.PI / 180; // "from" direction; u,v point where it goes
        acc.u += -Math.sin(rad) * mag * wk; acc.v += -Math.cos(rad) * mag * wk; acc.m += mag * wk; acc.p += (per || 0) * wk; sw += wk;
      }
    }
    if (sw < 0.25) return null;
    var u = acc.u / sw, v = acc.v / sw;
    return { m: acc.m / sw, u: u, v: v, from: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360, p: acc.p / sw };
  }

  /* ---------- view: equirectangular, x stretched by cos(lat0) ---------- */
  var mv = document.getElementById("mapView"), cF = document.getElementById("cField"), cW = document.getElementById("cFlow"), cT = document.getElementById("cTop");
  var gF = cF.getContext("2d"), gW = cW.getContext("2d"), gT = cT.getContext("2d");
  var DPR = 1, W = 0, HH = 0, KX = Math.cos(23.5 * Math.PI / 180);
  var view = { lon: 124, lat: 22, s: 26 }; // s = pixels per degree of latitude
  var layer = "wind", mapT = Math.round(NOW / H) * H, dirty = true;
  function sx(lon) { return W / 2 + (lon - view.lon) * KX * view.s; }
  function sy(lat) { return HH / 2 - (lat - view.lat) * view.s; }
  function lonAt(x) { return view.lon + (x - W / 2) / (KX * view.s); }
  function latAt(y) { return view.lat - (y - HH / 2) / view.s; }
  function clampView() { view.s = Math.max(9, Math.min(900, view.s)); view.lat = Math.max(-2, Math.min(47, view.lat)); view.lon = Math.max(98, Math.min(162, view.lon)); }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = mv.clientWidth; HH = mv.clientHeight;
    [cF, cW, cT].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(HH * DPR); c.getContext("2d").setTransform(DPR, 0, 0, DPR, 0, 0); });
    dirty = true; resetParticles();
  }

  /* ---------- colour ramps ---------- */
  var RAMPS = {
    wind: { max: 40, unit: "kt", stops: [[0, [20, 32, 78]], [5, [24, 74, 130]], [10, [20, 128, 140]], [15, [36, 160, 96]], [20, [180, 176, 40]], [25, [222, 120, 30]], [32, [210, 40, 80]], [40, [190, 40, 200]]] },
    waves: { max: 6, unit: "m", stops: [[0, [16, 30, 70]], [0.5, [22, 70, 130]], [1, [20, 120, 160]], [1.5, [30, 160, 130]], [2, [120, 190, 60]], [3, [230, 170, 40]], [4, [230, 80, 50]], [6, [200, 40, 190]]] },
    swell: { max: 6, unit: "m", stops: [[0, [16, 30, 70]], [0.5, [40, 50, 140]], [1, [80, 70, 190]], [1.5, [120, 90, 210]], [2, [190, 90, 200]], [3, [240, 110, 150]], [4, [250, 160, 90]], [6, [255, 230, 120]]] },
  };
  function ramp(L, v) { var s = RAMPS[L].stops; if (v <= s[0][0]) return s[0][1]; for (var i = 1; i < s.length; i++) if (v <= s[i][0]) { var f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]); return s[i - 1][1].map(function (c, k) { return Math.round(c + (s[i][1][k] - c) * f); }); } return s[s.length - 1][1]; }
  function drawLegend() {
    var R = RAMPS[layer], s = R.stops, css = s.map(function (x) { return "rgb(" + x[1] + ") " + (x[0] / R.max * 100).toFixed(0) + "%"; }).join(",");
    document.getElementById("legend").innerHTML = "<span>" + { wind: "Wind", waves: "Waves (all)", swell: "Swell" }[layer] + "<span>" + R.unit + "</span></span><i style=\"background:linear-gradient(90deg," + css + ")\"></i><span><span>0</span><span>" + (R.max / 2) + "</span><span>" + R.max + "</span></span>";
  }

  /* ---------- field image: one pixel per 0.25 deg, smoothed when drawn ---------- */
  var FX0 = 100, FY1 = 45, FRES = 0.25, FW = 241, FH = 181, fImg = document.createElement("canvas"); fImg.width = FW; fImg.height = FH;
  var fCtx = fImg.getContext("2d"), fData = fCtx.createImageData(FW, FH), fKey = "";
  function buildField() {
    var key = layer + "|" + mapT; if (key === fKey) return; fKey = key;
    var d = fData.data;
    for (var y = 0; y < FH; y++) for (var x = 0; x < FW; x++) {
      var f = fieldAt(FX0 + x * FRES, FY1 - y * FRES, mapT, layer), o = (y * FW + x) * 4;
      if (!f) { d[o + 3] = 0; continue; }
      var c = ramp(layer, f.m); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 235;
    }
    fCtx.putImageData(fData, 0, 0);
  }
  function path(ctx, ring) { ring.forEach(function (p, i) { var x = sx(p[0]), y = sy(p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
  function drawBase() {
    buildField();
    gF.setTransform(DPR, 0, 0, DPR, 0, 0); gF.fillStyle = "#050b18"; gF.fillRect(0, 0, W, HH);
    gF.imageSmoothingEnabled = true; gF.imageSmoothingQuality = "high";
    var x0 = sx(FX0 - FRES / 2), y0 = sy(FY1 + FRES / 2), x1 = sx(FX0 + (FW - 0.5) * FRES), y1 = sy(FY1 - (FH - 0.5) * FRES);
    gF.drawImage(fImg, x0, y0, x1 - x0, y1 - y0);
    // land: dark with a neon coast
    var rings = COAST.land.concat(COAST.tw);
    landPath = new Path2D(); rings.forEach(function (r) { r.forEach(function (p, i) { var x = sx(p[0]), y = sy(p[1]); if (i) landPath.lineTo(x, y); else landPath.moveTo(x, y); }); landPath.closePath(); });
    gF.beginPath(); rings.forEach(function (r) { path(gF, r); });
    gF.fillStyle = layer === "wind" ? "rgba(6,12,30,0.45)" : "rgba(10,18,40,0.96)"; gF.fill("evenodd");
    gF.lineWidth = view.s > 120 ? 1.6 : 1; gF.strokeStyle = "rgba(94,234,255,0.85)"; gF.shadowColor = "rgba(34,211,238,0.8)"; gF.shadowBlur = 6; gF.stroke(); gF.shadowBlur = 0;
    // waves/swell: direction arrows on a screen grid, longer for longer period
    gT.setTransform(DPR, 0, 0, DPR, 0, 0); gT.clearRect(0, 0, W, HH);
    if (layer !== "wind") {
      var sp = 54; gT.lineCap = "round";
      for (var yy = sp / 2 + 60; yy < HH - 90; yy += sp) for (var xx = sp / 2; xx < W; xx += sp) {
        if (gF.isPointInPath(landPath, xx * DPR, yy * DPR, "evenodd")) continue;
        var f = fieldAt(lonAt(xx), latAt(yy), mapT, layer); if (!f || f.m < 0.15) continue;
        var len = Math.max(10, Math.min(30, (f.p || 6) * 2.2)), ux = Math.sin((f.from + 180) * Math.PI / 180), uy = -Math.cos((f.from + 180) * Math.PI / 180);
        var ax = xx - ux * len / 2, ay = yy - uy * len / 2, bx = xx + ux * len / 2, by = yy + uy * len / 2;
        gT.strokeStyle = "rgba(255,255,255,0.8)"; gT.lineWidth = 1.6; gT.beginPath(); gT.moveTo(ax, ay); gT.lineTo(bx, by);
        var a = Math.atan2(uy, ux); gT.moveTo(bx, by); gT.lineTo(bx - Math.cos(a - 0.5) * 6, by - Math.sin(a - 0.5) * 6); gT.moveTo(bx, by); gT.lineTo(bx - Math.cos(a + 0.5) * 6, by - Math.sin(a + 0.5) * 6); gT.stroke();
      }
    }
    placeMarks(); dirty = false;
  }

  /* ---------- wind lines: particles carried by the wind at the map's time ---------- */
  var P = [], NPART = 0, landPath = new Path2D();
  function resetParticles() { NPART = Math.round(Math.min(2600, W * HH / 260)); P = []; for (var i = 0; i < NPART; i++) P.push(spawn({})); gW.clearRect(0, 0, W, HH); }
  function spawn(p) { p.x = Math.random() * W; p.y = Math.random() * HH; p.age = Math.floor(Math.random() * 80); p.max = 60 + Math.random() * 60; return p; }
  var vCache = {}, vKey = "";
  function windVec(x, y) {
    // cache per 12 px cell; cleared on pan/zoom/time change
    var cx = Math.round(x / 12), cy = Math.round(y / 12), k = cx + "," + cy, v = vCache[k];
    if (v === undefined) { var f = fieldAt(lonAt(cx * 12), latAt(cy * 12), mapT, "wind"); v = vCache[k] = f ? [f.u, -f.v, f.m] : null; }
    return v;
  }
  function stepFlow() {
    var key = view.lon.toFixed(3) + view.lat.toFixed(3) + view.s.toFixed(2) + "|" + mapT + W + "x" + HH;
    if (key !== vKey) { vKey = key; vCache = {}; }
    gW.setTransform(DPR, 0, 0, DPR, 0, 0);
    gW.globalCompositeOperation = "destination-in"; gW.fillStyle = "rgba(0,0,0,0.9)"; gW.fillRect(0, 0, W, HH);
    gW.globalCompositeOperation = "source-over";
    if (layer !== "wind") { gW.clearRect(0, 0, W, HH); return; }
    gW.lineWidth = 1.15; gW.strokeStyle = "rgba(255,255,255,0.78)"; gW.beginPath();
    for (var i = 0; i < P.length; i++) {
      var p = P[i], v = windVec(p.x, p.y);
      if (!v || p.age++ > p.max) { spawn(p); continue; }
      var sp = 0.055 * Math.sqrt(view.s / 26) + 0.0; // screen px per frame per kt
      var nx = p.x + v[0] * sp * 1.2, ny = p.y + v[1] * sp * 1.2;
      gW.moveTo(p.x, p.y); gW.lineTo(nx, ny); p.x = nx; p.y = ny;
      if (nx < 0 || ny < 0 || nx > W || ny > HH) spawn(p);
    }
    gW.stroke();
  }

  /* ---------- markers: our buoys, stations, tide gauge and Donghe ---------- */
  var PLACES = [
    { id: "donghe", kind: "spot", name: "Donghe", lat: 22.975, lon: 121.315 },
    { id: "46761F", kind: "buoy", name: "Chenggong buoy", short: "Chenggong", lat: 23.1325, lon: 121.4201, note: "21 km NE of Donghe, ~28 m deep off Sanxiantai" },
    { id: "WRA007", kind: "buoy", name: "Taitung buoy", short: "Taitung", lat: 22.7222, lon: 121.14, note: "33 km SW of Donghe, off Taitung City", left: true },
    { id: "C6S94", kind: "buoy", name: "Lanyu buoy", short: "Lanyu", lat: 22.0739, lon: 121.5822, note: "Off Orchid Island, 0.5 km S of Junjian Rock, ~50 m deep" },
    { id: "46699A", kind: "buoy", name: "Hualien buoy", short: "Hualien", lat: 24.0314, lon: 121.6328, note: "122 km N of Donghe" },
    { id: "46694A", kind: "buoy", name: "Longdong buoy", short: "Longdong", lat: 25.0975, lon: 121.9222, note: "NE coast, 244 km N of Donghe" },
    { id: "C0S810", kind: "station", name: "Donghe station", short: "Donghe stn", lat: 22.9727, lon: 121.304, note: "~1 km inland at 65 m", left: true },
    { id: "C0SA30", kind: "station", name: "Duli station", short: "Duli", lat: 23.0203, lon: 121.3236, note: "5 km N of Donghe at 92 m", left: true },
    { id: "C0T9I0", kind: "station", name: "Fengbin station", short: "Fengbin", lat: 23.5839, lon: 121.5148, note: "70 km N at 152 m", left: true },
    { id: "C4S02", kind: "gauge", name: "Chenggong tide gauge", short: "Tide", lat: 23.0972, lon: 121.3799, note: "Chenggong harbour, 15 km NNE of Donghe", left: true },
  ];
  var marksEl = document.getElementById("marks"), markEls = {}, selected = null;
  PLACES.forEach(function (p) {
    var b = document.createElement("button"); b.type = "button"; b.className = "mk " + p.kind + (p.left ? " left" : ""); b.setAttribute("aria-label", p.name);
    b.innerHTML = '<span class="dot"></span><span class="lab"></span>'; b.dataset.id = p.id;
    b.addEventListener("click", function (e) { e.stopPropagation(); openSheet(p); });
    b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    marksEl.appendChild(b); markEls[p.id] = b;
  });
  function obsAt(rows, t) { // reading nearest the map time if within 90 min, else the latest (marked stale)
    if (!rows || !rows.length) return null;
    var n = nearest(rows.map(function (r) { return { t: Date.parse(r.DateTime), r: r }; }), t, 1.5 * H);
    var lastT = Date.parse(rows[rows.length - 1].DateTime);
    if (t >= lastT && t - lastT <= 3 * H) return { r: rows[rows.length - 1], stale: false }; // the newest reading still counts as "now"
    return n ? { r: n.r, stale: false } : { r: rows[rows.length - 1], stale: true };
  }
  function labelFor(p) {
    if (p.kind === "spot") { var dp = donghePoint(mapT); return "Donghe" + (dp.s !== null ? rating(dp.s) : "") + (dp.wv ? "<small>" + r1(dp.wv.h) + " m @ " + Math.round(dp.wv.p) + " s" + (dp.w ? ' · <span class="' + windKind(dp.w.from) + '">' + Math.round(dp.w.kt) + " kt</span>" : "") + "</small>" : ""); }
    if (p.kind === "buoy") { var o = obsAt(buoyById[p.id], mapT); if (!o) return "<small>" + p.short + "</small>—"; return '<span class="' + (o.stale ? "stale" : "") + '"><small>' + p.short + (o.stale ? " · " + fHM.format(Date.parse(o.r.DateTime)) : "") + "</small>" + r1(num(o.r.WaveHeight)) + " m @ " + r1(num(o.r.WavePeriod)) + " s</span>"; }
    if (p.kind === "station") { var rows = stationRows(p.id), s = obsAt(rows, mapT); if (!s) return ""; var ms = num(s.r.WindSpeed), d = num(s.r.WindDirection);
      return '<span class="' + (s.stale ? "stale" : "") + '"><small>' + p.short + "</small>" + Math.round(kt(ms)) + " kt" + (d !== null && ms >= 0.5 ? " " + compass(d) : "") + "</span>"; }
    var g = (D.live.tide || []).filter(function (r) { return r[1] !== null; }), gl = g[g.length - 1]; return gl ? "<small>Tide gauge</small>" + Math.round(gl[1]) + " cm" : "";
  }
  function placeMarks() {
    mv.classList.toggle("m-hide-labels", view.s < 70);
    mv.classList.toggle("m-far", view.s < 160);
    PLACES.forEach(function (p) {
      var el = markEls[p.id], x = sx(p.lon), y = sy(p.lat);
      el.style.left = x + "px"; el.style.top = y + "px"; el.style.display = x < -40 || y < -40 || x > W + 40 || y > HH + 40 ? "none" : "";
      el.querySelector(".lab").innerHTML = labelFor(p); el.classList.toggle("sel", selected === p.id);
    });
    // close together at Donghe: hide the two inland stations until zoomed right in
    if (view.s < 420) ["C0S810", "C0SA30"].forEach(function (id) { markEls[id].style.display = "none"; });
  }

  /* ---------- time bar ---------- */
  var daysEl = document.getElementById("days"), clock = document.getElementById("clock"), DAYW = 72;
  var dayStarts = []; for (var t = new Date(dayKey(T0) + "T00:00:00+08:00").getTime(); t <= TEND; t += 24 * H) dayStarts.push(t);
  daysEl.innerHTML = dayStarts.map(function (t) { return '<div class="day' + (t >= NOW + 5 * 24 * H ? " far" : "") + '">' + fDow.format(t).toUpperCase() + "<small>" + fDay.format(t) + "</small></div>"; }).join("") + '<span class="nowtick" id="nowtick"></span><span class="cursor" id="cursor"></span>';
  function tToX(t) { return (t - dayStarts[0]) / (24 * H) * DAYW; }
  function xToT(x) { return dayStarts[0] + x / DAYW * 24 * H; }
  document.getElementById("nowtick").style.left = tToX(NOW) + "px";
  function setTime(t, keepScroll) {
    mapT = Math.max(T0, Math.min(TEND, Math.round(t / H) * H));
    document.getElementById("cursor").style.left = tToX(mapT) + "px";
    clock.innerHTML = fDow.format(mapT).toUpperCase() + " " + fHM.format(mapT) + (Math.abs(mapT - NOW) < H ? "<small>now</small>" : mapT < NOW ? "<small>past</small>" : "");
    if (!keepScroll) { var cx = tToX(mapT); if (cx < daysEl.scrollLeft + 30 || cx > daysEl.scrollLeft + daysEl.clientWidth - 30) daysEl.scrollLeft = cx - daysEl.clientWidth / 2; }
    dirty = true; if (selected) refreshSheet();
  }
  var scrub = null;
  daysEl.addEventListener("pointerdown", function (e) { scrub = { x: e.clientX, sl: daysEl.scrollLeft, moved: false }; daysEl.setPointerCapture(e.pointerId); });
  daysEl.addEventListener("pointermove", function (e) {
    if (!scrub) return; var dx = e.clientX - scrub.x; if (Math.abs(dx) > 4) scrub.moved = true;
    // drag on the bar scrubs time; the bar scrolls itself when the cursor nears an edge
    if (scrub.moved) { var r = daysEl.getBoundingClientRect(); setTime(xToT(e.clientX - r.left + daysEl.scrollLeft), true);
      if (e.clientX > r.right - 24) daysEl.scrollLeft += 8; else if (e.clientX < r.left + 24) daysEl.scrollLeft -= 8; }
  });
  daysEl.addEventListener("pointerup", function (e) { if (scrub && !scrub.moved) { var r = daysEl.getBoundingClientRect(); setTime(xToT(e.clientX - r.left + daysEl.scrollLeft), true); } scrub = null; });
  var playing = null, playBtn = document.getElementById("play");
  function stopPlay() { if (playing) { clearInterval(playing); playing = null; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play"); } }
  playBtn.addEventListener("click", function () {
    if (playing) return stopPlay();
    if (mapT >= TEND) setTime(T0);
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    playing = setInterval(function () { if (mapT >= TEND) return stopPlay(); setTime(mapT + 3 * H); }, 260);
  });

  /* ---------- pan, pinch, wheel ---------- */
  var ptrs = {}, gest = null;
  mv.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".m-top, .m-side, .m-bottom, .sheet, .mk")) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; mv.setPointerCapture(e.pointerId);
    gest = { moved: false, view: Object.assign({}, view), pts: JSON.parse(JSON.stringify(ptrs)) };
  });
  mv.addEventListener("pointermove", function (e) {
    if (!ptrs[e.pointerId] || !gest) return; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs), g0 = gest.pts, v0 = gest.view;
    if (ids.length === 1 && g0[ids[0]]) {
      var dx = ptrs[ids[0]].x - g0[ids[0]].x, dy = ptrs[ids[0]].y - g0[ids[0]].y; if (Math.abs(dx) + Math.abs(dy) > 5) gest.moved = true;
      view.lon = v0.lon - dx / (KX * v0.s); view.lat = v0.lat + dy / v0.s;
    } else if (ids.length >= 2 && g0[ids[0]] && g0[ids[1]]) {
      gest.moved = true;
      var a = ptrs[ids[0]], b = ptrs[ids[1]], a0 = g0[ids[0]], b0 = g0[ids[1]];
      var d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a.x - b.x, a.y - b.y), m0x = (a0.x + b0.x) / 2, m0y = (a0.y + b0.y) / 2, m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
      var lon0 = v0.lon + (m0x - W / 2) / (KX * v0.s), lat0 = v0.lat - (m0y - HH / 2) / v0.s;
      view.s = v0.s * d1 / Math.max(20, d0); clampView();
      view.lon = lon0 - (m1x - W / 2) / (KX * view.s); view.lat = lat0 + (m1y - HH / 2) / view.s;
    }
    clampView(); dirty = true; gW.clearRect(0, 0, W, HH);
  });
  function endPtr(e) {
    if (!ptrs[e.pointerId]) return;
    var wasTap = gest && !gest.moved && Object.keys(ptrs).length === 1; delete ptrs[e.pointerId];
    if (wasTap) openPin(lonAt(e.clientX - mv.getBoundingClientRect().left), latAt(e.clientY - mv.getBoundingClientRect().top));
    gest = Object.keys(ptrs).length ? { moved: true, view: Object.assign({}, view), pts: JSON.parse(JSON.stringify(ptrs)) } : null;
  }
  mv.addEventListener("pointerup", endPtr); mv.addEventListener("pointercancel", endPtr);
  function zoomAt(f, x, y) { var lon0 = lonAt(x), lat0 = latAt(y); view.s *= f; clampView(); view.lon = lon0 - (x - W / 2) / (KX * view.s); view.lat = lat0 + (y - HH / 2) / view.s; clampView(); dirty = true; gW.clearRect(0, 0, W, HH); }
  mv.addEventListener("wheel", function (e) { e.preventDefault(); var r = mv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  var flyAnim = null;
  function flyTo(lon, lat, s) {
    var a = Object.assign({}, view), t0 = performance.now(), dur = reduceMotion ? 1 : 900; cancelAnimationFrame(flyAnim);
    (function f(now) { var u = Math.min(1, (now - t0) / dur), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      view.lon = a.lon + (lon - a.lon) * e; view.lat = a.lat + (lat - a.lat) * e; view.s = Math.exp(Math.log(a.s) + (Math.log(s) - Math.log(a.s)) * e); dirty = true; gW.clearRect(0, 0, W, HH);
      if (u < 1) flyAnim = requestAnimationFrame(f); })(t0);
  }
  document.getElementById("zin").onclick = function () { zoomAt(1.6, W / 2, HH / 2); };
  document.getElementById("zout").onclick = function () { zoomAt(1 / 1.6, W / 2, HH / 2); };
  document.getElementById("zTw").onclick = function () { flyTo(121, 23.6, Math.min(W / KX / 7, HH / 6)); };
  document.getElementById("zDh").onclick = function () { flyTo(121.4, 22.75, Math.min(W / KX / 0.9, HH / 1.7)); };
  document.querySelectorAll(".layers button").forEach(function (b) { b.onclick = function () { layer = b.dataset.layer; document.querySelectorAll(".layers button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); drawLegend(); dirty = true; gW.clearRect(0, 0, W, HH); if (selected === "pin") refreshSheet(); }; });

  /* ---------- details sheet ---------- */
  var sheet = document.getElementById("sheet"), sheetBody = document.getElementById("sheetBody"), current = null;
  function spark(points, unit, color, nowT) {
    var pts = points.filter(function (p) { return p.v !== null && p.v !== undefined; }); if (pts.length < 2) return "";
    var w = 320, h = 66, pl = 26, pr = 6, pt = 8, pb = 16, x0 = pts[0].t, x1 = pts[pts.length - 1].t;
    var vMax = Math.max.apply(null, pts.map(function (p) { return p.v; })), vMin = Math.min.apply(null, pts.map(function (p) { return p.v; })); if (vMax - vMin < 0.5) vMax = vMin + 0.5;
    var X = function (t) { return pl + (t - x0) / (x1 - x0) * (w - pl - pr); }, Y = function (v) { return pt + (1 - (v - vMin) / (vMax - vMin)) * (h - pt - pb); };
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1); }).join("");
    var mk = nowT >= x0 && nowT <= x1 ? '<line x1="' + X(nowT) + '" x2="' + X(nowT) + '" y1="' + pt + '" y2="' + (h - pb) + '" stroke="#ff4fe0" stroke-width="1.5"/>' : "";
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '"><text x="2" y="' + (pt + 4) + '">' + (unit === "m" ? r1(vMax) : Math.round(vMax)) + '</text><text x="2" y="' + (h - pb) + '">' + (unit === "m" ? r1(vMin) : Math.round(vMin)) + "</text>" + mk +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/><text x="' + pl + '" y="' + (h - 3) + '">' + fWHM.format(x0) + '</text><text x="' + (w - pr) + '" y="' + (h - 3) + '" text-anchor="end">' + fWHM.format(x1) + "</text></svg>";
  }
  function sheetHTML(p) {
    if (p.kind === "pin") {
      var w = fieldAt(p.lon, p.lat, mapT, "wind"), wv = fieldAt(p.lon, p.lat, mapT, "waves"), sw = fieldAt(p.lon, p.lat, mapT, "swell");
      var html = '<span class="kind">Forecast at ' + p.lat.toFixed(2) + "°N " + p.lon.toFixed(2) + "°E · " + fWHM.format(mapT) + "</span><h3>Open-Meteo model grid</h3>";
      if (!w && !wv) return html + '<p class="line">Outside the forecast grid.</p>';
      html += '<div class="big">' + (w ? "<div><b>" + Math.round(w.m) + " <small>kt</small></b><span>wind from " + compass(w.from) + "</span></div>" : "") +
        (wv ? "<div><b>" + r1(wv.m) + " <small>m @ " + Math.round(wv.p) + " s</small></b><span>waves from " + compass(wv.from) + "</span></div>" : "<div><b>—</b><span>no waves (land)</span></div>") +
        (sw ? "<div><b>" + r1(sw.m) + " <small>m @ " + Math.round(sw.p) + " s</small></b><span>swell from " + compass(sw.from) + "</span></div>" : "") + "</div>";
      var series = []; for (var t = T0; t <= TEND; t += 3 * H) { var f = fieldAt(p.lon, p.lat, t, layer === "wind" ? "wind" : layer); series.push({ t: t, v: f ? f.m : null }); }
      html += '<span class="kind">' + { wind: "Wind (kt)", waves: "Wave height (m)", swell: "Swell height (m)" }[layer] + ", next 10 days</span>" + spark(series, layer === "wind" ? "kt" : "m", "#67e8f9", mapT);
      return html + '<p class="sub">From the 3° grid, so it is a regional picture; near Donghe use the buoys and the Donghe marker.</p>';
    }
    if (p.kind === "spot") {
      var dp = donghePoint(mapT), at = tideAt(mapT), cg = obsAt(buoyById["46761F"], mapT);
      var h2 = '<span class="kind">Surf spot · ' + fWHM.format(mapT) + "</span><h3>Donghe " + (dp.s !== null ? rating(dp.s) : "") + "</h3>";
      h2 += '<div class="big">' + (dp.wv ? "<div><b>" + r1(dp.wv.h) + " <small>m @ " + Math.round(dp.wv.p) + " s</small></b><span>Open-Meteo waves" + (dp.wv.d !== null ? " from " + compass(dp.wv.d) : "") + "</span></div>" : "") +
        (dp.w ? '<div><b class="' + windKind(dp.w.from) + '">' + Math.round(dp.w.kt) + " <small>kt</small></b><span>CWA wind from " + compass(dp.w.from) + "</span></div>" : "") +
        (at ? "<div><b>" + Math.round(at.h) + " <small>cm</small></b><span>tide, " + (at.rising ? "rising" : "falling") + "</span></div>" : "") + "</div>";
      if (cg && !cg.stale) h2 += '<p class="line">Chenggong buoy at the time: <b>' + r1(num(cg.r.WaveHeight)) + " m @ " + r1(num(cg.r.WavePeriod)) + " s</b></p>";
      var slots = []; for (var t2 = Math.ceil(mapT / (3 * H)) * 3 * H; slots.length < 8; t2 += 3 * H) slots.push(t2);
      h2 += '<span class="kind">Next 24 hours from the map time</span><div class="hours">' + slots.map(function (t) { var q = donghePoint(t);
        return '<div><span class="t">' + fH.format(t) + "</span><b>" + (q.wv ? r1(q.wv.h) : "–") + "</b><span>" + (q.wv ? Math.round(q.wv.p) + "s" : "") + '</span><span class="' + (q.w ? windKind(q.w.from) : "") + '">' + (q.w ? Math.round(q.w.kt) + "kt" : "–") + "</span></div>"; }).join("") + "</div>";
      h2 += '<span class="kind">Wave height, 5 days (Open-Meteo)</span>' + spark(ow.filter(function (q) { return q.t >= NOW - 6 * H && q.t <= NOW + 5 * 24 * H; }).map(function (q) { return { t: q.t, v: q.h }; }), "m", "#67e8f9", mapT);
      return h2;
    }
    if (p.kind === "buoy") {
      var rows = buoyById[p.id] || [], o = obsAt(rows, mapT), html2 = '<span class="kind">Buoy · ' + p.id + "</span><h3>" + p.name + '</h3><p class="sub">' + p.note + "</p>";
      if (!o) return html2 + '<p class="line">No recent readings.</p>';
      var r = o.r, an = r.PrimaryAnemometer || {}, ws = num(an.WindSpeed), wd = num(an.WindDirection);
      html2 += '<div class="big"><div><b>' + r1(num(r.WaveHeight)) + " <small>m @ " + r1(num(r.WavePeriod)) + " s</small></b><span>" + (r.WaveDirectionDescription ? "from " + esc(r.WaveDirectionDescription) : "waves") + "</span></div>" +
        (ws !== null ? "<div><b>" + Math.round(kt(ws)) + " <small>kt</small></b><span>wind" + (wd !== null ? " from " + compass(wd) : "") + "</span></div>" : "") +
        (num(r.SeaTemperature) !== null ? "<div><b>" + r1(num(r.SeaTemperature)) + " <small>°C</small></b><span>sea</span></div>" : "") + "</div>";
      html2 += '<p class="sub">' + (o.stale ? "Latest reading " : "Reading ") + fWHM.format(Date.parse(r.DateTime)) + (o.stale && mapT > NOW ? " — buoys only report the past; the map time is in the future" : "") + "</p>";
      return html2 + '<span class="kind">Wave height, last 24 h</span>' + spark(rows.map(function (q) { return { t: Date.parse(q.DateTime), v: num(q.WaveHeight) }; }), "m", "#22d3ee", mapT);
    }
    if (p.kind === "station") {
      var sr = stationRows(p.id), so = obsAt(sr, mapT), h3 = '<span class="kind">Wind station · ' + p.id + "</span><h3>" + p.name + '</h3><p class="sub">' + p.note + "</p>";
      if (!so) return h3 + '<p class="line">No recent readings.</p>';
      var ms = num(so.r.WindSpeed), dd = num(so.r.WindDirection);
      h3 += '<div class="big"><div><b>' + Math.round(kt(ms)) + ' <small>kt</small></b><span>from ' + (dd !== null ? compass(dd) : "—") + "</span></div></div><p class=\"sub\">" + (so.stale ? "Latest reading " : "Reading ") + fWHM.format(Date.parse(so.r.DateTime)) + "</p>";
      return h3 + '<span class="kind">Wind, last 16 h (kt)</span>' + spark(sr.map(function (q) { return { t: Date.parse(q.DateTime), v: kt(num(q.WindSpeed)) }; }), "kt", "#fbbf24", mapT);
    }
    var g = (D.live.tide || []).filter(function (r) { return r[1] !== null; }), gl = g[g.length - 1];
    return '<span class="kind">Tide gauge · C4S02</span><h3>' + p.name + '</h3><p class="sub">' + p.note + "</p>" + (gl ? '<div class="big"><div><b>' + Math.round(gl[1]) + ' <small>cm</small></b><span>measured ' + fHM.format(gl[0]) + "</span></div>" + (gl[2] !== null ? "<div><b>" + Math.round(gl[2]) + " <small>cm</small></b><span>predicted</span></div>" : "") + "</div>" : "") +
      '<span class="kind">Measured, last 72 h (cm)</span>' + spark(g.map(function (r) { return { t: r[0], v: r[1] }; }), "cm", "#a78bfa", mapT);
  }
  function openSheet(p) { current = p; selected = p.id || "pin"; sheetBody.innerHTML = sheetHTML(p); sheet.classList.add("open"); placeMarks(); }
  function refreshSheet() { if (current) sheetBody.innerHTML = sheetHTML(current); }
  function closeSheet() { sheet.classList.remove("open"); current = null; selected = null; pinAt = null; placeMarks(); }
  document.getElementById("sheetX").onclick = closeSheet;
  var pinAt = null;
  function openPin(lon, lat) { if (current) { closeSheet(); return; } pinAt = { lon: lon, lat: lat }; openSheet({ kind: "pin", id: "pin", lon: lon, lat: lat }); }

  /* ---------- render loop ---------- */
  var running = false;
  function frame() {
    if (!running) return;
    if (dirty) drawBase();
    stepFlow();
    if (pinAt) { var x = sx(pinAt.lon), y = sy(pinAt.lat); gW.save(); gW.fillStyle = "#ff4fe0"; gW.shadowColor = "#ff4fe0"; gW.shadowBlur = 10; gW.beginPath(); gW.arc(x, y, 5, 0, 7); gW.fill(); gW.restore(); }
    requestAnimationFrame(frame);
  }
  /* ======================================================================
     Barrel wave, seen side-on. Opening: the face stands up, the lip throws
     out and curls over into a tube, and you are pulled into the barrel,
     where the map is. Closing: you are pulled back out, the lip slams shut
     on the tube, the whitewater explodes over the screen and drains away
     to the dashboard.
     Wave coordinates: the tube's centre is (g.tx, g.ty); R is the wave's
     size. Everything is drawn through view(z, cx, cy): zoom z about the
     tube centre, which is moved to (cx, cy) on screen.
     ====================================================================== */
  var fx = document.getElementById("fx"), gx = fx.getContext("2d"), busy = false;
  function sizeFx() { var d = Math.min(2, devicePixelRatio || 1); fx.width = innerWidth * d; fx.height = innerHeight * d; gx.setTransform(d, 0, 0, d, 0, 0); }
  function ease(u) { u = Math.max(0, Math.min(1, u)); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function smooth(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }
  function clipMap(poly) { var c = poly === null ? "" : poly.length ? "polygon(" + poly.map(function (q) { return q[0].toFixed(1) + "px " + q[1].toFixed(1) + "px"; }).join(",") + ")" : "polygon(0 0, 0 0, 0 0)"; mv.style.clipPath = c; mv.style.webkitClipPath = c; }
  function geom(Wd, Hd) { var R = Math.min(Hd * 0.4, Wd * 0.5); return { R: R, tx: Wd * 0.6, ty: Hd * 0.94 - R * 0.8 }; }

  // Shape of the wave for: size k (0–1, the face standing up), throw λ (0–1,
  // how far the lip has curled over), open o (0–1, how hollow the tube is).
  function shape(g, k, lam, o, tt) {
    var R = g.R * (0.35 + 0.65 * k), rw = R * 0.8 * (0.25 + 0.75 * o) * Math.min(1, 0.3 + lam * 1.4); // tube radius
    var th0 = R - rw, PHI = lam * 1.08 * Math.PI, N = 48, outer = [], inner = [];
    for (var i = 0; i <= N; i++) {
      var s = i / N, ph = -Math.PI / 2 - s * PHI, wob = Math.sin(s * 11 + tt * 7) * R * 0.012 * s;
      var ro = R * (1 - 0.16 * s) + wob, ri = ro - th0 * (1 - 0.88 * s) - R * 0.01;
      outer.push([g.tx + Math.cos(ph) * ro, g.ty + Math.sin(ph) * ro]);
      inner.push([g.tx + Math.cos(ph) * ri, g.ty + Math.sin(ph) * ri]);
    }
    var trough = g.ty + R * 0.8, back = [], wall = [], far = R * 60;
    // back of the wave, sloping from the right edge up to the crest
    for (var j = 12; j >= 0; j--) { var x = g.tx + j / 12 * R * 3.2, u = j / 12; back.push([x, g.ty - R + (R * 1.55) * smooth(u) + Math.sin(u * 8 + tt * 3) * R * 0.015]); }
    // inside wall of the tube, from under the lip round the right side to the bottom
    for (var m = 0; m <= 24; m++) { var a = -Math.PI / 2 + m / 24 * Math.PI; wall.push([g.tx + Math.cos(a) * rw, g.ty + Math.sin(a) * rw]); }
    // the face below the tube: a concave slope down to the flat water ahead of the wave
    var face = [], fb = [g.tx - R * (0.2 + 0.9 * (1 - Math.min(1, lam))), trough], w0 = wall[wall.length - 1];
    for (var q = 1; q <= 12; q++) { var v = q / 12, cx0 = g.tx - R * 0.05, cy0 = trough; face.push([(1 - v) * (1 - v) * w0[0] + 2 * (1 - v) * v * cx0 + v * v * fb[0], (1 - v) * (1 - v) * w0[1] + 2 * (1 - v) * v * cy0 + v * v * fb[1]]); }
    var tip = inner[N];
    return { R: R, rw: rw, face: face, outer: outer, inner: inner, back: back, wall: wall, tip: tip, otip: outer[N], trough: trough, far: far, lam: lam };
  }
  function drawWave(S, map, tt, alpha) {
    var P = map;
    var water = [P([S.back[0][0] + S.far, S.trough + S.far]), P([S.back[0][0] + S.far, S.back[0][1]])]
      .concat(S.back.map(P)).concat(S.outer.map(P)).concat(S.inner.slice().reverse().map(P)).concat(S.wall.map(P))
      .concat(S.face.map(P)).concat([P([S.face[S.face.length - 1][0] - S.far, S.trough]), P([S.wall[S.wall.length - 1][0] - S.far, S.trough + S.far])]);
    var top = P([0, S.wall[0][1] - S.R * 0.3])[1], bot = P([0, S.trough + S.R * 0.2])[1];
    var gr = gx.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, "#7fe9f7"); gr.addColorStop(0.18, "#1bb5cc"); gr.addColorStop(0.55, "#0a6f93"); gr.addColorStop(1, "#042a47");
    gx.save(); gx.globalAlpha = alpha === undefined ? 1 : alpha;
    gx.beginPath(); water.forEach(function (q, i) { if (i) gx.lineTo(q[0], q[1]); else gx.moveTo(q[0], q[1]); }); gx.closePath();
    gx.fillStyle = gr; gx.fill();
    gx.save(); gx.clip();
    // face texture: streaks that follow the curl round the inside of the tube
    var z = Math.hypot(P([1, 0])[0] - P([0, 0])[0], P([1, 0])[1] - P([0, 0])[1]);
    gx.lineCap = "round";
    for (var k = 1; k <= 6; k++) {
      var rr = S.rw + k * S.R * 0.09, c = P([S.wall[0][0], S.wall[0][1] + S.rw]);
      gx.strokeStyle = "rgba(200,250,255," + (0.22 - k * 0.025).toFixed(3) + ")"; gx.lineWidth = Math.max(1, z * S.R * 0.012);
      gx.beginPath(); gx.arc(c[0], c[1], rr * z, -Math.PI / 2 - S.lam * 1.0 * Math.PI + Math.sin(tt * 2 + k) * 0.05, Math.PI / 2.2 + Math.sin(tt * 3 + k) * 0.08); gx.stroke();
    }
    // light falling through the lip onto the face
    var lc = P([S.wall[0][0] + S.R * 0.3, S.wall[0][1]]), lg = gx.createRadialGradient(lc[0], lc[1], 0, lc[0], lc[1], S.R * z * 0.9);
    lg.addColorStop(0, "rgba(160,245,255,0.35)"); lg.addColorStop(1, "rgba(160,245,255,0)"); gx.fillStyle = lg; gx.fillRect(lc[0] - S.R * z, lc[1] - S.R * z, S.R * z * 2, S.R * z * 2);
    gx.restore();
    // the lip: bright feathering edge on its outside, shadow underneath
    gx.lineJoin = "round"; gx.lineCap = "round";
    gx.strokeStyle = "rgba(225,253,255,0.95)"; gx.lineWidth = Math.max(2, z * S.R * 0.03); gx.shadowColor = "#bff7ff"; gx.shadowBlur = 10;
    gx.beginPath(); S.outer.map(P).forEach(function (q, i) { if (i) gx.lineTo(q[0], q[1]); else gx.moveTo(q[0], q[1]); }); gx.stroke(); gx.shadowBlur = 0;
    gx.strokeStyle = "rgba(2,26,46," + (0.55 * smooth((S.lam - 0.25) / 0.3)).toFixed(3) + ")"; gx.lineWidth = Math.max(2, z * S.R * 0.05); // the shadow under the lip appears once it curls
    gx.beginPath(); S.inner.map(P).forEach(function (q, i) { if (i) gx.lineTo(q[0], q[1]); else gx.moveTo(q[0], q[1]); }); gx.stroke();
    // foam curling off the tip and along the crest
    gx.fillStyle = "rgba(255,255,255,0.95)";
    var tp = P(S.otip), ti = P(S.tip);
    for (var f = 0; f < 9; f++) { var u = f / 8, x = tp[0] + (ti[0] - tp[0]) * u, y = tp[1] + (ti[1] - tp[1]) * u; gx.beginPath(); gx.arc(x + Math.sin(f * 2.1 + tt * 9) * z * S.R * 0.02, y + Math.cos(f * 1.7 + tt * 8) * z * S.R * 0.02, z * S.R * (0.025 + 0.02 * Math.abs(Math.sin(f + tt * 6))), 0, 7); gx.fill(); }
    gx.restore();
    // the hollow (tube interior), in screen space, for clipping the map
    var hol = S.inner.map(P), tipS = P([S.tip[0], S.tip[1]]), trS = P([S.tip[0], S.trough]);
    if (S.tip[1] < S.trough) hol.push(trS);
    hol = hol.concat(S.wall.slice().reverse().map(P));
    return { hollow: hol, tip: tipS, otip: tp };
  }
  var spray = [];
  function addSpray(x, y, vx, vy, n, life, size) { for (var i = 0; i < n; i++) spray.push({ x: x + (Math.random() - .5) * 16, y: y + (Math.random() - .5) * 12, vx: vx + (Math.random() - .5) * 4, vy: vy - Math.random() * 3, r: (1 + Math.random() * 2.6) * (size || 1), life: life * (0.6 + Math.random() * 0.6), age: 0 }); }
  function drawSpray(dt) {
    gx.fillStyle = "#ffffff";
    spray = spray.filter(function (s) { s.age += dt; if (s.age > s.life) return false; s.vy += 0.2; s.vx *= 0.99; s.x += s.vx * dt; s.y += s.vy * dt; gx.globalAlpha = Math.max(0, 1 - s.age / s.life) * 0.92; gx.beginPath(); gx.arc(s.x, s.y, s.r, 0, 7); gx.fill(); return true; });
    gx.globalAlpha = 1;
  }
  function mapper(g, z, cx, cy) { return function (q) { return [cx + (q[0] - g.tx) * z, cy + (q[1] - g.ty) * z]; }; }

  function openFx(done) {
    if (reduceMotion) { mv.style.opacity = 0; mv.hidden = false; requestAnimationFrame(function () { mv.style.transition = "opacity .25s"; mv.style.opacity = 1; setTimeout(function () { mv.style.transition = ""; done(); }, 260); }); return; }
    sizeFx(); fx.hidden = false; spray = [];
    var Wd = innerWidth, Hd = innerHeight, g = geom(Wd, Hd), t0 = performance.now(), last = t0, DUR = 2900;
    var zEnd = Math.hypot(Wd, Hd) / (g.R * 0.8) * 1.35;
    mv.hidden = false; clipMap([]);
    (function f(now) {
      var u = Math.min(1, (now - t0) / DUR), dt = Math.min(50, now - last) / 16.7, tt = now / 1000; last = now;
      var k = ease(u / 0.3),                    // 0–0.3   the face stands up out of the bottom of the screen
        lam = ease((u - 0.2) / 0.42),            // 0.2–0.62 the lip throws over into a tube
        o = smooth((u - 0.3) / 0.35),            // the tube hollows out
        zu = Math.pow(smooth((u - 0.64) / 0.36), 2.2), z = 1 + (zEnd - 1) * zu; // 0.64–1 you are pulled into the barrel
      var rise = (1 - k) * Hd * 0.75;            // the wave starts below the screen
      var cx = g.tx + (Wd / 2 - g.tx) * smooth((u - 0.62) / 0.36), cy = g.ty + rise + (Hd / 2 - g.ty) * smooth((u - 0.62) / 0.36);
      gx.clearRect(0, 0, Wd, Hd);
      var S = shape(g, k, lam, o, tt), r = drawWave(S, mapper(g, z, cx, cy), tt);
      if (lam > 0.15) clipMap(r.hollow); else clipMap([]);
      if (lam > 0.05 && lam < 0.995) addSpray(r.otip[0], r.otip[1], -3 - 3 * lam, -2.5, 3, 34, 1 + zu * 3);
      if (k > 0.5 && u < 0.45) addSpray(cx + (Math.random() * 2.6) * g.R * z, cy - S.R * z + Math.random() * 30, 1.5, -3.5, 1, 28);
      if (u > 0.8 && u < 0.95) addSpray(Wd / 2 + (Math.random() - .5) * Wd, Hd / 2 + (Math.random() - .5) * Hd, (Math.random() - .5) * 14, (Math.random() - .5) * 14, 4, 22, 2.5); // spit blowing past as you go in
      drawSpray(dt);
      if (u < 1) requestAnimationFrame(f);
      else { clipMap(null); gx.clearRect(0, 0, Wd, Hd); fx.hidden = true; done(); }
    })(t0);
  }

  function closeFx(done) {
    if (reduceMotion) { mv.style.transition = "opacity .2s"; mv.style.opacity = 0; setTimeout(function () { mv.hidden = true; mv.style.opacity = ""; mv.style.transition = ""; done(); }, 220); return; }
    sizeFx(); fx.hidden = false; spray = [];
    var Wd = innerWidth, Hd = innerHeight, g = geom(Wd, Hd), t0 = performance.now(), last = t0, DUR = 2300;
    var zEnd = Math.hypot(Wd, Hd) / (g.R * 0.8) * 1.35, impact = null, foam = [], bubbles = [];
    (function f(now) {
      var u = Math.min(1, (now - t0) / DUR), dt = Math.min(50, now - last) / 16.7, tt = now / 1000; last = now;
      gx.clearRect(0, 0, Wd, Hd);
      if (u < 0.5) {
        // 0–0.32 pulled back out of the barrel; 0.3–0.5 the lip comes over and the tube closes out
        var zu = 1 - smooth(u / 0.32), z = 1 + (zEnd - 1) * Math.pow(zu, 2.2) + 0.15;
        var cx = g.tx + (Wd / 2 - g.tx) * zu, cy = g.ty + (Hd / 2 - g.ty) * zu;
        var c = smooth((u - 0.3) / 0.2), lam = 1 + c * 0.25, o = 1 - c;     // the lip throws further as the tube collapses
        var S = shape(g, 1, Math.min(1.25, lam), Math.max(0.02, o), tt), r = drawWave(S, mapper(g, z, cx, cy), tt);
        clipMap(c < 0.97 ? r.hollow : []);
        if (c > 0) addSpray(r.otip[0], r.otip[1], -4, -3, 3, 30, 1.4);
        impact = [r.tip[0], mapper(g, z, cx, cy)([0, S.trough])[1]];
      } else {
        // 0.5–0.75 the whitewater explodes out from where the lip landed and smashes over the screen
        mv.hidden = true; clipMap(null);
        if (!foam.length) {
          for (var i = 0; i < 90; i++) { var a = -Math.PI * Math.random(), sp = 0.5 + Math.random(); foam.push({ a: a, sp: sp, r: 30 + Math.random() * 60, ph: Math.random() * 6 }); }
          addSpray(impact[0], impact[1], 0, -9, 140, 60, 2.2);
          for (var b = 0; b < 80; b++) bubbles.push({ x: Math.random() * Wd, y: Math.random() * Hd, r: 2 + Math.random() * 8, v: 0.3 + Math.random() * 1.2, pop: 0.78 + Math.random() * 0.2 });
        }
        var e = smooth((u - 0.5) / 0.22), fade = 1 - smooth((u - 0.74) / 0.26), reach = Math.hypot(Wd, Hd) * 1.25 * e;
        gx.globalAlpha = fade;
        // churning foam: big soft blobs thrown out from the impact
        foam.forEach(function (p) { var d = reach * p.sp, x = impact[0] + Math.cos(p.a) * d * 1.2, y = impact[1] + Math.sin(p.a) * d * 0.9 + reach * 0.25, rr = p.r * (1 + e * 4) * (0.9 + 0.1 * Math.sin(tt * 5 + p.ph));
          var rg = gx.createRadialGradient(x, y, 0, x, y, rr); rg.addColorStop(0, "rgba(255,255,255,0.98)"); rg.addColorStop(0.7, "rgba(230,250,255,0.9)"); rg.addColorStop(1, "rgba(200,240,250,0)");
          gx.fillStyle = rg; gx.beginPath(); gx.arc(x, y, rr, 0, 7); gx.fill(); });
        // a wash of white over everything at the peak of the hit
        gx.fillStyle = "rgba(240,252,255," + (0.85 * Math.min(e, fade)).toFixed(3) + ")"; gx.fillRect(0, 0, Wd, Hd);
        // bubbles left behind, popping as the foam drains
        bubbles.forEach(function (bb) { if (u > bb.pop) return; bb.y -= bb.v * dt; gx.strokeStyle = "rgba(120,190,215,0.8)"; gx.lineWidth = 1.5; gx.beginPath(); gx.arc(bb.x, bb.y, bb.r, 0, 7); gx.stroke(); });
        gx.globalAlpha = 1;
      }
      drawSpray(dt);
      if (u < 1) requestAnimationFrame(f);
      else { clipMap(null); gx.clearRect(0, 0, Wd, Hd); fx.hidden = true; mv.hidden = true; done(); }
    })(t0);
  }

  /* ---------- open / close ---------- */
  var opener = null;
  function openMap() {
    if (busy || !mv.hidden) return; busy = true; opener = document.activeElement;
    document.body.style.overflow = "hidden";
    mv.hidden = false; resize(); setTime(mapT); drawLegend(); running = true; frame(); mv.hidden = true;
    openFx(function () { busy = false; document.getElementById("closeMap").focus({ preventScroll: true }); });
    try { history.pushState({ map: 1 }, ""); } catch (e) {}
  }
  function closeMap(fromHistory) {
    if (busy || mv.hidden) return; busy = true; stopPlay(); closeSheet();
    if (!fromHistory) { try { if (history.state && history.state.map) history.back(); } catch (e) {} }
    closeFx(function () { running = false; busy = false; document.body.style.overflow = ""; if (opener) opener.focus({ preventScroll: true }); });
  }
  btn.addEventListener("click", function () { if (booted) openMap(); });
  document.getElementById("closeMap").addEventListener("click", function () { closeMap(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !mv.hidden) { if (current) closeSheet(); else closeMap(false); } });
  window.addEventListener("popstate", function () { if (!mv.hidden) closeMap(true); });
  window.addEventListener("resize", function () { if (!mv.hidden) resize(); });
  // Opening view (user's choice): Taiwan and the sea to its east, about 7.4° tall; on a narrow phone, Taiwan fits the width.
  view.lon = innerWidth < 600 ? 121.4 : 122.1; view.lat = 23.65;
  view.s = Math.min(innerHeight / 7.4, innerWidth / (KX * (innerWidth < 600 ? 4.2 : 8)));
  return openMap;
  }
})();
