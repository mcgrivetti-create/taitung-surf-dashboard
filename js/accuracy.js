/* Forecast Check (Phase 3) — accuracy.html.
 *
 * Reads only current-tier files (never the monthly logs — see "Two tiers"
 * in the README):
 *   data/phase3-live.json      last 72h: observations + each source's
 *                              forecast as made 6h ahead
 *   data/phase3-stats.json     7-day / 30-day scores, typhoon swell events
 *   data/phase3-history.json   last 7 days, every lead — loaded only when an
 *                              Accuracy history tab is opened
 *   data/buoy-site-forecasts.json, ecmwf.json, gfs-wind.json, coastal.json,
 *   tide-extrema.json, tide.json   the forecast side of the Live charts
 *
 * Every summary sentence is template text built from the same numbers the
 * charts draw — no language model, same as the typhoon summary.
 */
(function () {
  "use strict";

  var ASSET_VERSION = "2026-10-07a";
  var RELOAD_GUARD = "surf-asset-reload";
  (function selfHealStaleAssets() {
    var tried = false;
    try { tried = sessionStorage.getItem(RELOAD_GUARD) === ASSET_VERSION; } catch (e) { tried = true; }
    if (tried) return;
    fetch("version.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      if (!v || !v.assets || v.assets === ASSET_VERSION) return;
      try { sessionStorage.setItem(RELOAD_GUARD, ASSET_VERSION); } catch (e) { return; }
      var u = location.href.split("#")[0];
      location.replace(u + (u.indexOf("?") === -1 ? "?" : "&") + "_v=" + encodeURIComponent(v.assets) + location.hash);
    }).catch(function () {});
  })();

  /* ---------- theme (same key and default as the dashboard) ---------- */
  var root = document.documentElement, themeBtn = document.getElementById("themeToggle");
  function applyTheme(t) { root.setAttribute("data-theme", t === "light" ? "light" : "dark"); themeBtn.textContent = t === "light" ? "☀️" : "🌙"; }
  var theme = "dark"; try { theme = localStorage.getItem("surf-theme") || "dark"; } catch (e) {}
  applyTheme(theme);
  themeBtn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next); try { localStorage.setItem("surf-theme", next); } catch (e) {}
  });

  /* ---------- helpers ---------- */
  var H = 3600000, TZ = "Asia/Taipei";
  function fmt(o) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, o)); }
  var fmtFull = fmt({ weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  var fmtTick = fmt({ weekday: "short", day: "numeric" });
  var fmtDay = fmt({ month: "short", day: "numeric" });
  var fmtHM = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  var fmtWHM = fmt({ weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  function f0(v) { return Math.round(v).toString(); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function f2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function sgn(v, fmtFn) { var s = (fmtFn || f0)(Math.abs(v)); return (v > 0 && +s !== 0 ? "+" : v < 0 && +s !== 0 ? "−" : "") + s; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function svgEl(tag, attrs, text) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function compass(d) { return COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function angleDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  var ZH_DEG = { "北": 0, "北北東": 22.5, "東北": 45, "東北東": 67.5, "東": 90, "東南東": 112.5, "東南": 135, "南南東": 157.5, "南": 180, "南南西": 202.5, "西南": 225, "西南西": 247.5, "西西南": 247.5, "西": 270, "西北西": 292.5, "西北": 315, "北北西": 337.5 };
  function zhDeg(t) { if (!t) return null; var b = String(t).trim().replace(/風$/, "").replace(/^偏/, ""); return ZH_DEG[b] === undefined ? null : ZH_DEG[b]; }
  function nameList(n) { return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; }
  // Donghe's beach faces ~ESE: same rule as the logger (buildPhase3Files).
  function windCall(s, d) { if (s === null || s === undefined) return null; if (s < 2) return "light"; if (d === null || d === undefined) return null; if (angleDiff(d, 285) <= 60) return "offshore"; if (angleDiff(d, 105) <= 60) return "onshore"; return "cross-shore"; }

  function getJSON(p) { return fetch(p, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }

  /* ---------- sources ---------- */
  var SRC = {
    cwa_coastal_donghe: { name: "CWA coastal", c: "var(--fc-s1)", sub: "CWA's forecast for Donghe's coastal waters" },
    open_meteo: { name: "Open-Meteo", c: "var(--fc-s2)", sub: "Open-Meteo marine forecast" },
    ecmwf: { name: "ECMWF", c: "var(--fc-s3)", sub: "Windy's model" },
    gfs_wave: { name: "GFS-Wave", c: "var(--fc-s4)", sub: "Windguru's wave model" },
    gfs_wind: { name: "GFS", c: "var(--fc-s4)", sub: "Windguru's wind model" },
    cwa_township_wind: { name: "CWA township", c: "var(--fc-s5)", sub: "CWA's 12-hour Donghe township forecast" }
  };
  var BUOYS = { WRA007: { name: "Taitung", dist: "33 km SW of Donghe" }, "46761F": { name: "Chenggong", dist: "21 km NE of Donghe" } };
  var LEADS = [6, 12, 24, 48, 72];
  var ENOUGH = 72; // matched hours before a source can be called "most accurate"
  var OBS_C = "var(--text)";

  /* ---------- state (per viewer, remembered) ---------- */
  var S = {
    tab: "waves", sub: { waves: "live", wind: "live", tide: "live" },
    wl: { buoy: "WRA007", model: "open_meteo", rule: false },
    wh: { buoy: "46761F", point: null, win: "7d", lead: 24 },
    nl: {}, nh: { win: "7d", lead: 24 },
    tl: { ahead: 3, dh: true }, th: { win: "7d" }
  };
  try { var saved = JSON.parse(localStorage.getItem("fc-state") || "null"); if (saved) Object.keys(saved).forEach(function (k) { if (typeof saved[k] === "object" && S[k]) Object.assign(S[k], saved[k]); else S[k] = saved[k]; }); } catch (e) {}
  function save() { try { localStorage.setItem("fc-state", JSON.stringify(S)); } catch (e) {} }

  /* ---------- data ---------- */
  var D = {};
  var historyPromise = null;
  function loadHistory() { if (!historyPromise) historyPromise = getJSON("data/phase3-history.json").then(function (h) { D.history = h; return h; }); return historyPromise; }

  /* ---------- small UI builders ---------- */
  function seg(box, items, cur, onPick) {
    box.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = it.label;
      b.setAttribute("aria-pressed", String(String(it.value) === String(cur)));
      b.addEventListener("click", function () { onPick(it.value); }); box.appendChild(b);
    });
  }
  function legendHtml(items) { return items.map(function (L) { return '<span><span class="fc-sw" style="background:' + L.c + (L.dash ? ";opacity:.6" : "") + (L.w > 2 ? ";height:4px" : "") + '"></span>' + esc(L.label) + "</span>"; }).join(""); }
  function syn(key, text) { return '<div class="fc-syn" aria-live="polite"><span class="k">' + esc(key) + "</span><p>" + text + "</p></div>"; }
  function placeTip(tip, box, svg, W, x, y) {
    var r = svg.getBoundingClientRect(), px = x * (r.width / W), bw = box.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(bw - tw, px + 14 > bw - tw ? px - tw - 14 : px + 14)) + "px";
    tip.style.top = (y === undefined ? 4 : Math.max(0, y)) + "px";
  }

  /* ---------- time chart (Live + hour-by-hour) ----------
     cfg: xMin, xMax (ms), now (ms or null), yMin, yMax|auto, step, h, tick(v),
     fmt(v), lines:[{label,c,w,dash,op,dots,r,pts:[{t,v}],noTip}],
     bands:[{from,to,c,label}] (horizontal), areas:[{c,pts}], marks:[{t,v,high,label}] */
  function timeChart(box, cfg) {
    box.innerHTML = "";
    var W = Math.max(300, box.clientWidth), Hh = cfg.h || (W < 500 ? 180 : 200), pad = { l: 42, r: 10, t: 18, b: 24 };
    var xMin = cfg.xMin, xMax = cfg.xMax, yMin = cfg.yMin || 0, yMax = cfg.yMax;
    if (cfg.auto) {
      yMax = cfg.yFloor || cfg.step;
      cfg.lines.forEach(function (ln) { ln.pts.forEach(function (p) { if (p.t >= xMin && p.t <= xMax && p.v !== null && p.v > yMax) yMax = p.v; }); });
      yMax = Math.ceil(yMax / cfg.step) * cfg.step;
    }
    function sx(t) { return pad.l + (t - xMin) / (xMax - xMin) * (W - pad.l - pad.r); }
    function sy(v) { return pad.t + (1 - (v - yMin) / (yMax - yMin)) * (Hh - pad.t - pad.b); }
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": cfg.aria || "" });
    (cfg.bands || []).forEach(function (b) {
      svg.appendChild(svgEl("rect", { x: pad.l, y: sy(b.to), width: W - pad.l - pad.r, height: sy(b.from) - sy(b.to), style: "fill:" + b.c + ";opacity:.12" }));
      if (b.label) svg.appendChild(svgEl("text", { x: W - pad.r - 4, y: sy(b.to) + 12, "text-anchor": "end", class: "fc-exlabel" }, b.label));
    });
    if (cfg.now && cfg.now < xMax) svg.appendChild(svgEl("rect", { x: sx(Math.max(cfg.now, xMin)), y: pad.t, width: W - pad.r - sx(Math.max(cfg.now, xMin)), height: Hh - pad.t - pad.b, style: "fill:var(--fc-band);opacity:.6" }));
    var g = svgEl("g", { class: "fc-grid" }), ax = svgEl("g", { class: "fc-axis" });
    for (var v = yMin; v <= yMax + 1e-9; v += cfg.step) {
      g.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), style: v === 0 && yMin < 0 ? "stroke:var(--fc-ink-3)" : "" }));
      ax.appendChild(svgEl("text", { x: pad.l - 6, y: sy(v) + 4, "text-anchor": "end" }, cfg.tick(v)));
    }
    var off = 8 * H, d0 = Math.ceil((xMin + off) / (24 * H)) * 24 * H - off, span = (xMax - xMin) / (24 * H), every = Math.max(1, Math.ceil(span / Math.max(2, Math.floor((W - pad.l) / 70)))), k = 0;
    for (var d = d0; d <= xMax; d += 24 * H, k++) {
      g.appendChild(svgEl("line", { x1: sx(d), x2: sx(d), y1: pad.t, y2: Hh - pad.b, style: "stroke-dasharray:2 4" }));
      if (k % every === 0 && d + 12 * H <= xMax) ax.appendChild(svgEl("text", { x: sx(d + 12 * H), y: Hh - 7, "text-anchor": "middle" }, fmtTick.format(d + 12 * H)));
    }
    svg.appendChild(g); svg.appendChild(ax);
    if (cfg.now && cfg.now >= xMin && cfg.now <= xMax) {
      svg.appendChild(svgEl("line", { x1: sx(cfg.now), x2: sx(cfg.now), y1: pad.t - 8, y2: Hh - pad.b, style: "stroke:var(--text);stroke-width:1.5" }));
      svg.appendChild(svgEl("text", { x: sx(cfg.now) + 4, y: pad.t - 6, style: "font:600 11px var(--fc-mono);fill:var(--text)" }, "now"));
    }
    (cfg.areas || []).forEach(function (a) {
      var pts = a.pts.filter(function (p) { return p.t >= xMin && p.t <= xMax && p.v !== null; }); if (!pts.length) return;
      var dd = "M" + sx(pts[0].t) + " " + sy(0); pts.forEach(function (p) { dd += "L" + sx(p.t).toFixed(1) + " " + sy(p.v).toFixed(1); }); dd += "L" + sx(pts[pts.length - 1].t) + " " + sy(0) + "Z";
      svg.appendChild(svgEl("path", { d: dd, style: "fill:" + a.c + ";opacity:.18" }));
    });
    cfg.lines.forEach(function (ln) {
      var pts = ln.pts.filter(function (p) { return p.t >= xMin && p.t <= xMax && p.v !== null && p.v !== undefined; });
      if (ln.dots) { pts.forEach(function (p) { svg.appendChild(svgEl("circle", { cx: sx(p.t), cy: sy(p.v), r: ln.r || 2.5, style: "fill:" + ln.c + (ln.op ? ";opacity:" + ln.op : "") })); }); return; }
      var path = "", prev = null;
      pts.forEach(function (p) { path += (prev !== null && p.t - prev <= (ln.gap || 3) * H ? "L" : "M") + sx(p.t).toFixed(1) + " " + sy(p.v).toFixed(1); prev = p.t; });
      if (path) svg.appendChild(svgEl("path", { d: path, fill: "none", style: "stroke:" + ln.c + ";stroke-width:" + ln.w + ";stroke-linejoin:round;stroke-linecap:round" + (ln.dash ? ";stroke-dasharray:" + ln.dash : "") + (ln.op ? ";opacity:" + ln.op : "") }));
    });
    (cfg.marks || []).forEach(function (m) {
      if (m.t < xMin || m.t > xMax) return;
      svg.appendChild(svgEl("circle", { cx: sx(m.t), cy: sy(m.v), r: 4, style: "fill:var(--fc-s1);stroke:var(--bg-card);stroke-width:2" }));
      if (m.label) svg.appendChild(svgEl("text", { x: sx(m.t), y: m.high ? sy(m.v) - 9 : sy(m.v) + 17, "text-anchor": "middle", class: "fc-exlabel" }, m.label));
    });
    var cross = svgEl("line", { y1: pad.t, y2: Hh - pad.b, style: "stroke:var(--fc-ink-3);stroke-width:1", visibility: "hidden" });
    var dots = svgEl("g", { visibility: "hidden" }); svg.appendChild(cross); svg.appendChild(dots);
    var hit = svgEl("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: Hh - pad.t - pad.b, fill: "transparent", style: "cursor:crosshair" });
    svg.appendChild(hit); box.appendChild(svg);
    var tip = document.createElement("div"); tip.className = "fc-tip"; tip.hidden = true; box.appendChild(tip);
    function near(pts, t) { var best = null, bd = 1.6 * H; pts.forEach(function (p) { var x = Math.abs(p.t - t); if (p.v !== null && p.v !== undefined && x <= bd) { bd = x; best = p; } }); return best; }
    function move(cx) {
      var r = svg.getBoundingClientRect(), x = (cx - r.left) * (W / r.width), t = Math.round((xMin + (x - pad.l) / (W - pad.l - pad.r) * (xMax - xMin)) / H) * H;
      cross.setAttribute("x1", sx(t)); cross.setAttribute("x2", sx(t)); cross.setAttribute("visibility", "visible");
      dots.innerHTML = ""; var rows = "";
      cfg.lines.forEach(function (ln) {
        if (ln.noTip) return;
        var p = near(ln.pts, t);
        if (p) dots.appendChild(svgEl("circle", { cx: sx(p.t), cy: sy(p.v), r: 4, style: "fill:" + ln.c + ";stroke:var(--bg-card);stroke-width:2" }));
        rows += '<div class="r"><span><span class="fc-sw" style="background:' + ln.c + '"></span>' + esc(ln.label) + '</span><span class="v">' + (p ? cfg.fmt(p.v) : "—") + "</span></div>";
      });
      dots.setAttribute("visibility", "visible");
      tip.innerHTML = '<div class="t">' + fmtFull.format(t) + (cfg.now && t > cfg.now ? " · forecast" : "") + "</div>" + rows; tip.hidden = false;
      placeTip(tip, box, svg, W, sx(t));
    }
    hit.addEventListener("pointermove", function (e) { move(e.clientX); });
    hit.addEventListener("pointerdown", function (e) { move(e.clientX); });
    hit.addEventListener("pointerleave", function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.setAttribute("visibility", "hidden"); });
  }

  /* ---------- lead chart: typical miss by how far ahead ----------
     series: [{label, c, dash, pts:[{lead, st:{n,mae,bias}}]}]; sel = selected lead */
  function leadChart(box, series, sel, unit, fmtFn, step) {
    box.innerHTML = "";
    var W = Math.max(300, box.clientWidth), Hh = W < 500 ? 200 : 220, pad = { l: 44, r: 14, t: 12, b: 28 };
    var yMax = step; series.forEach(function (s) { s.pts.forEach(function (p) { if (p.st && p.st.n && p.st.mae > yMax) yMax = p.st.mae; }); });
    yMax = Math.ceil(yMax / step) * step;
    var colW = (W - pad.l - pad.r) / LEADS.length;
    function sx(k) { return pad.l + colW * (k + 0.5); }
    function sy(v) { return pad.t + (1 - v / yMax) * (Hh - pad.t - pad.b); }
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": "Typical miss by forecast lead time" });
    var si = LEADS.indexOf(sel);
    if (si >= 0) svg.appendChild(svgEl("rect", { x: pad.l + colW * si + 2, y: pad.t, width: colW - 4, height: Hh - pad.t - pad.b, rx: 6, style: "fill:var(--fc-band)" }));
    var g = svgEl("g", { class: "fc-grid" }), ax = svgEl("g", { class: "fc-axis" });
    for (var v = 0; v <= yMax + 1e-9; v += step) { g.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v) })); ax.appendChild(svgEl("text", { x: pad.l - 6, y: sy(v) + 4, "text-anchor": "end" }, fmtFn(v))); }
    LEADS.forEach(function (l, k) { ax.appendChild(svgEl("text", { x: sx(k), y: Hh - 9, "text-anchor": "middle", style: k === si ? "fill:var(--text);font-weight:500" : "" }, l + "h ahead")); });
    svg.appendChild(g); svg.appendChild(ax);
    var tip = document.createElement("div"); tip.className = "fc-tip"; tip.hidden = true;
    series.forEach(function (s) {
      var path = "", on = false;
      s.pts.forEach(function (p, k) { if (!p.st || !p.st.n) { on = false; return; } path += (on ? "L" : "M") + sx(k) + " " + sy(p.st.mae); on = true; });
      if (path) svg.appendChild(svgEl("path", { d: path, fill: "none", style: "stroke:" + s.c + ";stroke-width:2;stroke-linejoin:round" + (s.dash ? ";stroke-dasharray:" + s.dash : "") }));
    });
    series.forEach(function (s) {
      s.pts.forEach(function (p, k) {
        if (!p.st || !p.st.n) return;
        var thin = p.st.n < ENOUGH;
        svg.appendChild(svgEl("circle", { cx: sx(k), cy: sy(p.st.mae), r: 5, style: thin || s.dash ? "fill:var(--bg-card);stroke:" + s.c + ";stroke-width:2" : "fill:" + s.c + ";stroke:var(--bg-card);stroke-width:2" }));
        var hit = svgEl("circle", { cx: sx(k), cy: sy(p.st.mae), r: 13, fill: "transparent", style: "cursor:pointer" });
        function show() {
          tip.innerHTML = '<div class="t">' + esc(s.label) + " · " + p.lead + "h ahead</div>" +
            '<div class="r"><span>Typical miss</span><span class="v">' + fmtFn(p.st.mae) + " " + unit + "</span></div>" +
            (p.st.bias !== undefined && !s.dash ? '<div class="r"><span>Bias</span><span class="v">' + sgn(p.st.bias, fmtFn) + " " + unit + "</span></div>" : "") +
            '<div class="r"><span>Matched hours</span><span class="v">' + p.st.n + (thin ? " (thin)" : "") + "</span></div>";
          tip.hidden = false; placeTip(tip, box, svg, W, sx(k), sy(p.st.mae) * (svg.getBoundingClientRect().height / Hh) - 30);
        }
        hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", function () { tip.hidden = true; });
        svg.appendChild(hit);
      });
    });
    box.appendChild(svg); box.appendChild(tip);
  }

  /* ---------- scorecard ---------- */
  function scoreTable(rows, unit, fmtFn, okBand, baseline) {
    var h = "<table><thead><tr><th>Source</th><th>Typical miss</th><th>Bias</th><th>Matched hours</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      var st = r.st || { n: 0 }, s = SRC[r.id];
      var cells = !st.n ? '<td class="num fc-thin">no data yet</td><td class="num fc-thin">—</td><td class="num fc-thin">0</td>'
        : '<td class="num">' + fmtFn(st.mae) + " " + unit + '</td><td class="num">' + sgn(st.bias, fmtFn) + " " + unit + ' <span class="fc-dir">' + (Math.abs(st.bias) < okBand ? "about right" : st.bias > 0 ? "reads high" : "reads low") + "</span></td>" +
          '<td class="num' + (st.n < ENOUGH ? " fc-thin" : "") + '">' + st.n + (st.n < ENOUGH ? " · thin" : "") + "</td>";
      h += '<tr><td><span class="fc-src"><span class="fc-sw" style="background:' + s.c + '"></span>' + s.name + '</span><span class="fc-sub">' + esc(r.sub || s.sub) + "</span></td>" + cells + "</tr>";
    });
    if (baseline && baseline.n) {
      h += '<tr class="fc-baseline"><td><span class="fc-src" style="font-weight:400"><span class="fc-sw" style="background:var(--fc-ink-3)"></span>No change</span><span class="fc-sub">The buoy reading from that many hours earlier, as a benchmark</span></td><td class="num">' + fmtFn(baseline.mae) + " " + unit + '</td><td class="num">—</td><td class="num">' + baseline.n + "</td></tr>";
    }
    return h + "</tbody></table>";
  }

  /* =================== WAVES =================== */
  function waveModelLine(buoy, id, field) {
    var past = ((D.live.buoys[buoy] || {}).asForecast || {})[id] || [];
    var fut = (((D.site.sites || {})[buoy] || {}).models || {})[id];
    var pts = past.map(function (r) { return { t: r[0], v: r[field] === undefined ? null : r[field] }; });
    var key = ["", "waveHeight", "wavePeriod", "waveDirectionDeg", "windSpeed", "windDirectionDeg"][field];
    ((fut && fut.series) || []).forEach(function (p) { var t = Date.parse(p.targetTime); if (t > D.now) pts.push({ t: t, v: p[key] === undefined ? null : p[key] }); });
    return pts;
  }
  function renderWavesLive(box) {
    var L = S.wl, b = BUOYS[L.buoy], obs = (D.live.buoys[L.buoy] || {}).obs || [];
    var models = L.model === "all" ? ["open_meteo", "ecmwf", "gfs_wave"] : [L.model];
    box.innerHTML = syn("Summary · " + b.name + " buoy · last 72 hours and next 3 days", wavesLiveSynopsis(L.buoy, obs)) +
      '<div class="fc-controls"><div class="fc-ctl"><span class="fc-ctl-label">Buoy</span><div class="fc-seg" id="wl-buoy"></div></div>' +
      '<div class="fc-ctl"><span class="fc-ctl-label">Model</span><div class="fc-seg" id="wl-model"></div></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>' + b.name + ' buoy · measured + forecast</h3><span class="fc-note">' + b.dist + " · each model read at its nearest grid point to the buoy</span></div>" +
      '<div class="fc-now" id="wl-now"></div><div class="fc-legend" id="wl-legend"></div><div class="fc-stack">' +
      '<div class="fc-row"><h4>Wave height</h4><div class="fc-chart" id="wl-h"></div></div>' +
      '<div class="fc-row"><h4>Wave period</h4><label class="fc-toggle"><input type="checkbox" id="wl-rule"' + (L.rule ? " checked" : "") + '><span class="fc-tg"></span>Buoy × 1.3 (groundswell rule of thumb)</label><div class="fc-chart" id="wl-p"></div></div>' +
      '<div class="fc-row"><h4>Wave direction <span class="fc-note">(coming from)</span></h4><div class="fc-chart" id="wl-d"></div></div>' +
      (L.buoy === "WRA007" ? '<div class="fc-row"><h4>Wind speed at the buoy</h4><div class="fc-chart" id="wl-w"></div></div>' : "") +
      '</div><p class="fc-note">Left of "now", each model line is what that model forecast for the hour 6 hours ahead, at the buoy\'s position. These forecasts have been logged since Oct 6, so the line is short until three days have built up.</p></div>';
    seg(document.getElementById("wl-buoy"), Object.keys(BUOYS).map(function (k) { return { label: BUOYS[k].name, value: k }; }), L.buoy, function (v) { L.buoy = v; save(); render(); });
    seg(document.getElementById("wl-model"), ["open_meteo", "ecmwf", "gfs_wave"].map(function (k) { return { label: SRC[k].name, value: k }; }).concat([{ label: "All", value: "all" }]), L.model, function (v) { L.model = v; save(); render(); });
    document.getElementById("wl-rule").addEventListener("change", function (e) { L.rule = e.target.checked; save(); render(); });
    var last = obs[obs.length - 1], now = "";
    if (last) {
      now += '<span><span class="k">Measured ' + fmtWHM.format(last[0]) + "</span><b>" + f1(last[1]) + " m</b>" + (last[2] !== null && last[2] !== undefined ? " · " + f1(last[2]) + " s" : "") + (last[3] !== null && last[3] !== undefined ? " · from " + compass(last[3]) : "") + "</span>";
      if (last[4] !== null && last[4] !== undefined) now += '<span><span class="k">Wind</span><b>' + f1(last[4]) + " m/s</b>" + (last[5] !== null && last[5] !== undefined ? " from " + compass(last[5]) : "") + "</span>";
    }
    document.getElementById("wl-now").innerHTML = now;
    var OBS = { label: b.name + " buoy (measured)", c: OBS_C, w: 2.5 };
    var leg = [OBS].concat(models.map(function (m) { return { label: SRC[m].name + " forecast", c: SRC[m].c, w: 2 }; }));
    if (L.buoy === "WRA007") leg = leg.concat([{ label: "ECMWF wind", c: SRC.ecmwf.c, w: 2 }, { label: "GFS wind", c: SRC.gfs_wind.c, w: 2 }]);
    document.getElementById("wl-legend").innerHTML = legendHtml(leg.filter(function (x, i, a) { return a.findIndex(function (y) { return y.label === x.label; }) === i; }));
    var x0 = D.now - 72 * H, x1 = D.now + 144 * H;
    function obsPts(i) { return obs.map(function (o) { return { t: o[0], v: o[i] === undefined ? null : o[i] }; }); }
    function mLines(i) { return models.map(function (m) { return { label: SRC[m].name, c: SRC[m].c, w: 2, pts: waveModelLine(L.buoy, m, i) }; }); }
    timeChart(document.getElementById("wl-h"), { xMin: x0, xMax: x1, now: D.now, auto: true, yFloor: 1, step: 0.5, tick: function (v) { return v.toFixed(1); }, fmt: function (v) { return f2(v) + " m"; }, lines: [Object.assign({}, OBS, { gap: 2, pts: obsPts(1) })].concat(mLines(1)), aria: "Wave height, measured and forecast" });
    var pl = [Object.assign({}, OBS, { gap: 2, pts: obsPts(2) })];
    if (L.rule) pl.push({ label: "Buoy × 1.3", c: OBS_C, w: 1.5, dash: "5 4", op: 0.75, gap: 2, pts: obsPts(2).map(function (p) { return { t: p.t, v: p.v === null ? null : p.v * 1.3 }; }) });
    timeChart(document.getElementById("wl-p"), { xMin: x0, xMax: x1, now: D.now, auto: true, yFloor: 10, step: 2, tick: function (v) { return v + "s"; }, fmt: function (v) { return f1(v) + " s"; }, lines: pl.concat(mLines(2)), aria: "Wave period, measured and forecast" });
    timeChart(document.getElementById("wl-d"), { xMin: x0, xMax: x1, now: D.now, yMin: 0, yMax: 360, step: 90, h: 160, tick: function (v) { return ["N", "E", "S", "W", "N"][v / 90]; }, fmt: function (v) { return compass(v) + " (" + Math.round(v) + "°)"; },
      lines: [Object.assign({}, OBS, { dots: true, r: 3, pts: obsPts(3) })].concat(models.map(function (m) { return { label: SRC[m].name, c: SRC[m].c, dots: true, r: 2, op: 0.85, pts: waveModelLine(L.buoy, m, 3) }; })), aria: "Wave direction" });
    if (L.buoy === "WRA007") {
      timeChart(document.getElementById("wl-w"), { xMin: x0, xMax: x1, now: D.now, auto: true, yFloor: 6, step: 2, tick: function (v) { return v + ""; }, fmt: function (v) { return f1(v) + " m/s"; },
        lines: [Object.assign({}, OBS, { gap: 2, pts: obsPts(4) }), { label: "ECMWF wind", c: SRC.ecmwf.c, w: 2, pts: waveModelLine("WRA007", "ecmwf", 4) }, { label: "GFS wind", c: SRC.gfs_wind.c, w: 2, pts: waveModelLine("WRA007", "gfs_wind", 4) }], aria: "Wind speed at the Taitung buoy" });
    }
  }
  function wavesLiveSynopsis(buoy, obs) {
    var b = BUOYS[buoy], out = [];
    var past = obs.filter(function (o) { return o[0] >= D.now - 72 * H && o[1] !== null; });
    if (!past.length) return "No recent readings from this buoy.";
    var hs = past.map(function (o) { return o[1]; }), last = past[past.length - 1];
    var ref = past.filter(function (o) { return o[0] <= last[0] - 6 * H; }).pop() || past[0], ch = last[1] - ref[1];
    out.push("Over the last 72 hours the " + b.name + " buoy measured " + f1(Math.min.apply(null, hs)) + "–" + f1(Math.max.apply(null, hs)) + " m; it now reads <b>" + f1(last[1]) + " m</b> and is " + (ch > 0.15 ? "rising" : ch < -0.15 ? "dropping" : "holding steady") + ".");
    var byHour = {}; past.forEach(function (o) { byHour[o[0]] = o[1]; });
    var rank = ["open_meteo", "ecmwf", "gfs_wave"].map(function (m) {
      var n = 0, abs = 0, sum = 0;
      (((D.live.buoys[buoy] || {}).asForecast || {})[m] || []).forEach(function (r) { var o = byHour[r[0]]; if (o === undefined || r[1] === null || r[1] === undefined) return; n++; abs += Math.abs(r[1] - o); sum += r[1] - o; });
      return { m: m, n: n, mae: n ? abs / n : null, bias: n ? sum / n : null };
    }).filter(function (r) { return r.n >= 6; }).sort(function (a, c) { return a.mae - c.mae; });
    var lead = rank[0] ? rank[0].m : "open_meteo";
    if (rank.length) {
      var far = rank.slice().sort(function (a, c) { return Math.abs(c.bias) - Math.abs(a.bias); })[0];
      out.push("Forecast 6 hours ahead, <b>" + SRC[rank[0].m].name + "</b> has tracked it most closely, typically within " + f2(rank[0].mae) + " m" + (rank[0].n < 24 ? " (over " + rank[0].n + " hours so far)" : "") +
        (rank.length > 1 && far.m !== rank[0].m ? "; " + SRC[far.m].name + " has run " + (far.bias > 0 ? "highest" : "lowest") + " (" + sgn(far.bias, f2) + " m)" : "") + ".");
    }
    var fut = waveModelLine(buoy, lead, 1).filter(function (p) { return p.t > D.now && p.t <= D.now + 72 * H && p.v !== null; });
    if (fut.length) {
      var mx = fut.reduce(function (a, p) { return p.v > a.v ? p : a; }), mn = fut.reduce(function (a, p) { return p.v < a.v ? p : a; });
      out.push(SRC[lead].name + " expects " + (mx.v > last[1] + 0.2 ? "a rise to about <b>" + f1(mx.v) + " m</b> around " + fmtWHM.format(mx.t) : mn.v < last[1] - 0.2 ? "it to ease to about <b>" + f1(mn.v) + " m</b> by " + fmtWHM.format(mn.t) : "it to hold near <b>" + f1(fut[fut.length - 1].v) + " m</b>") + " over the next 3 days.");
    }
    return out.join(" ");
  }

  function waveStats(win, buoy, point, field, lead) {
    return ((D.stats.windows[win] || {}).waves || []).filter(function (x) { return x.buoy === buoy && x.point === point && x.field === field && (lead === undefined || x.lead === lead); });
  }
  function persistence(win, buoy, field, lead) {
    return ((D.stats.windows[win] || {}).persistence || []).filter(function (x) { return x.buoy === buoy && x.field === field && x.lead === lead; })[0] || null;
  }
  function wavesPointDefault() {
    // At the buoy once any model there has 3 days of matches; the Donghe point until then.
    var ok = waveStats(S.wh.win, S.wh.buoy, "buoy", "height", 24).some(function (x) { return x.n >= ENOUGH; });
    return ok ? "buoy" : "donghe";
  }
  function renderWavesHist(box) {
    var Hs = S.wh;
    var point = Hs.point || wavesPointDefault();
    var ids = point === "buoy" ? ["open_meteo", "ecmwf", "gfs_wave"] : ["cwa_coastal_donghe", "open_meteo", "ecmwf", "gfs_wave"];
    var b = BUOYS[Hs.buoy], winLabel = Hs.win === "7d" ? "last 7 days" : "last 30 days";
    function rowsFor(field) { var all = waveStats(Hs.win, Hs.buoy, point, field, Hs.lead); return ids.map(function (id) { return { id: id, st: all.filter(function (x) { return x.source === id; })[0] || { n: 0 } }; }); }
    var hRows = rowsFor("height"), pRows = rowsFor("period");
    box.innerHTML = syn("Summary · " + b.name + " buoy · " + winLabel + " · forecasts made " + Hs.lead + "h ahead", wavesHistSynopsis(hRows, pRows, b, point)) +
      '<div class="fc-controls"><div class="fc-ctl"><span class="fc-ctl-label">Buoy</span><div class="fc-seg" id="wh-buoy"></div></div>' +
      '<div class="fc-ctl"><span class="fc-ctl-label">Forecast for</span><div class="fc-seg" id="wh-point"></div></div>' +
      '<div class="fc-ctl"><span class="fc-ctl-label">Made</span><div class="fc-seg" id="wh-lead"></div><span class="fc-ctl-label">ahead</span></div>' +
      '<div class="fc-ctl"><span class="fc-ctl-label">Over</span><div class="fc-seg" id="wh-win"></div></div></div>' +
      (point === "buoy" ? "" : '<p class="fc-note">Scores against forecasts made for Donghe, ' + b.dist + '; part of each miss is the distance. Forecasts at the buoy\'s own position have been logged since Oct 6 — switch "Forecast for" to "The buoy" as they build up.</p>') +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Wave height</h3><span class="fc-note">metres</span></div><div class="fc-score">' + scoreTable(hRows, "m", f2, 0.05, persistence(Hs.win, Hs.buoy, "height", Hs.lead)) + "</div>" +
      '<div class="fc-legend" id="wh-hleg"></div><div class="fc-chart" id="wh-hts"><p class="fc-empty">Loading the last 7 days…</p></div>' +
      '<h4 style="margin:.4rem 0 0">Typical miss by how far ahead the forecast was made</h4><div class="fc-chart" id="wh-hlead"></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Wave period</h3><span class="fc-note">seconds · the buoy reports a mean period of the whole sea, so expect every model to read longer</span></div><div class="fc-score">' + scoreTable(pRows, "s", f1, 0.25, persistence(Hs.win, Hs.buoy, "period", Hs.lead)) + "</div>" +
      '<div class="fc-chart" id="wh-pts"><p class="fc-empty">Loading the last 7 days…</p></div>' +
      '<h4 style="margin:.4rem 0 0">Typical miss by how far ahead the forecast was made</h4><div class="fc-chart" id="wh-plead"></div></div>';
    seg(document.getElementById("wh-buoy"), Object.keys(BUOYS).map(function (k) { return { label: BUOYS[k].name, value: k }; }), Hs.buoy, function (v) { Hs.buoy = v; Hs.point = null; save(); render(); });
    seg(document.getElementById("wh-point"), [{ label: "The buoy", value: "buoy" }, { label: "Donghe (reference)", value: "donghe" }], point, function (v) { Hs.point = v; save(); render(); });
    seg(document.getElementById("wh-lead"), LEADS.map(function (l) { return { label: l + "h", value: l }; }), Hs.lead, function (v) { Hs.lead = +v; save(); render(); });
    seg(document.getElementById("wh-win"), [{ label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }], Hs.win, function (v) { Hs.win = v; Hs.point = null; save(); render(); });
    function leadSeries(field) {
      return ids.map(function (id) { return { label: SRC[id].name, c: SRC[id].c, pts: LEADS.map(function (l) { return { lead: l, st: (waveStats(Hs.win, Hs.buoy, point, field, l).filter(function (x) { return x.source === id; })[0]) || null }; }) }; })
        .concat([{ label: "No change", c: "var(--fc-ink-3)", dash: "5 4", pts: LEADS.map(function (l) { return { lead: l, st: persistence(Hs.win, Hs.buoy, field, l) }; }) }]);
    }
    leadChart(document.getElementById("wh-hlead"), leadSeries("height"), Hs.lead, "m", f2, 0.1);
    leadChart(document.getElementById("wh-plead"), leadSeries("period"), Hs.lead, "s", f1, 0.5);
    document.getElementById("wh-hleg").innerHTML = legendHtml([{ label: b.name + " buoy (measured)", c: OBS_C, w: 3 }].concat(ids.map(function (id) { return { label: SRC[id].name, c: SRC[id].c }; })).concat([{ label: "No change benchmark (dashed, lead chart)", c: "var(--fc-ink-3)", dash: true }]));
    loadHistory().then(function () {
      if (S.tab !== "waves" || S.sub.waves !== "hist") return;
      var o = D.history.buoys[Hs.buoy] || [], key = (point === "buoy" ? Hs.buoy : "donghe");
      var x1 = Date.parse(D.history.updatedAt), x0 = x1 - 7 * 24 * H;
      function lines(i) {
        return [{ label: b.name + " buoy", c: OBS_C, w: 2.5, gap: 2, pts: o.map(function (r) { return { t: r[0], v: r[i] === undefined ? null : r[i] }; }) }]
          .concat(ids.map(function (id) { return { label: SRC[id].name + " (" + Hs.lead + "h ahead)", c: SRC[id].c, w: 2, gap: 4, pts: (D.history.forecasts[key + "|" + id + "|" + Hs.lead] || []).map(function (r) { return { t: r[0], v: r[i] === undefined ? null : r[i] }; }) }; }));
      }
      timeChart(document.getElementById("wh-hts"), { xMin: x0, xMax: x1, auto: true, yFloor: 1, step: 0.5, tick: function (v) { return v.toFixed(1); }, fmt: function (v) { return f2(v) + " m"; }, lines: lines(1), aria: "Wave height, last 7 days" });
      timeChart(document.getElementById("wh-pts"), { xMin: x0, xMax: x1, auto: true, yFloor: 10, step: 2, tick: function (v) { return v + "s"; }, fmt: function (v) { return f1(v) + " s"; }, lines: lines(2), aria: "Wave period, last 7 days" });
    }).catch(function () { ["wh-hts", "wh-pts"].forEach(function (id) { var e = document.getElementById(id); if (e) e.innerHTML = '<p class="fc-empty">Couldn\'t load the last 7 days.</p>'; }); });
  }
  function wavesHistSynopsis(hRows, pRows, b, point) {
    var Hs = S.wh, out = [];
    var hh = hRows.filter(function (r) { return r.st.n >= 10; }).sort(function (a, c) { return a.st.mae - c.st.mae; });
    if (!hh.length) return "Not enough matched hours yet in this range to rank the sources.";
    var solid = hh.filter(function (r) { return r.st.n >= ENOUGH; }), thin = hh.filter(function (r) { return r.st.n < ENOUGH; });
    var where = point === "buoy" ? " at the " + b.name + " buoy" : " (forecasts for Donghe, checked against the " + b.name + " buoy)";
    if (solid.length) {
      var best = solid[0], better = thin.filter(function (r) { return r.st.mae < best.st.mae; });
      out.push("Over the " + (Hs.win === "7d" ? "last 7 days" : "last 30 days") + ", <b>" + SRC[best.id].name + "</b> has been the most accurate for wave height " + Hs.lead + " hours ahead" + where + ", typically within " + f2(best.st.mae) + " m" +
        (better.length ? " (" + better.map(function (r) { return SRC[r.id].name + " (" + r.st.n + " hours)"; }).join(" and ") + (better.length > 1 ? " look" : " looks") + " closer still, on less than three days of matches)" : "") + ".");
    } else out.push("No source has three days of matches" + where + " yet; " + SRC[hh[0].id].name + " leads so far, within " + f2(hh[0].st.mae) + " m over " + hh[0].st.n + " hours.");
    var high = hh.filter(function (r) { return r.st.bias > 0.05; }), low = hh.filter(function (r) { return r.st.bias < -0.05; }), ok = hh.filter(function (r) { return Math.abs(r.st.bias) <= 0.05; });
    var nm = function (rs) { return nameList(rs.map(function (r) { return SRC[r.id].name; })); };
    out.push([high.length ? nm(high) + " read high" : "", low.length ? nm(low) + " read low" : "", ok.length ? nm(ok) + (ok.length > 1 ? " have" : " has") + " landed about right" : ""].filter(Boolean).join("; ") + ".");
    var pers = persistence(Hs.win, Hs.buoy, "height", Hs.lead);
    if (pers && pers.n && hh[0]) out.push(hh[0].st.mae < pers.mae ? "That beats simply assuming no change (" + f2(pers.mae) + " m)." : "At this lead, simply assuming no change has done as well or better (" + f2(pers.mae) + " m).");
    return out.join(" ");
  }

  /* =================== WIND =================== */
  function dongheWindFuture(id) {
    if (id === "ecmwf") return ((D.ecmwf || {}).series || []).map(function (p) { return { t: Date.parse(p.targetTime), s: p.windSpeed, d: p.windDirectionDeg }; });
    if (id === "gfs_wind") return ((D.gfsWind || {}).series || []).map(function (p) { return { t: Date.parse(p.targetTime), s: p.windSpeed, d: p.windDirectionDeg }; });
    if (id === "cwa_coastal_donghe") {
      try {
        var loc = D.coastal.records.locations[0].location[0], els = {};
        (loc.WeatherElement || []).forEach(function (w) { els[w.ElementName] = w.Time || []; });
        var dirs = {}; (els["風向"] || []).forEach(function (t) { var v = t.ElementValue; v = Array.isArray(v) ? v[0] : v; dirs[t.DataTime] = zhDeg(v && v.WindDirection); });
        return (els["風速"] || []).map(function (t) { var v = t.ElementValue; v = Array.isArray(v) ? v[0] : v; return { t: Date.parse(t.DataTime), s: v ? Number(v.WindSpeed) : null, d: dirs[t.DataTime] === undefined ? null : dirs[t.DataTime] }; });
      } catch (e) { return []; }
    }
    return [];
  }
  function dongheWindLine(id, which) {
    var past = (D.live.donghe.asForecast[id] || []).map(function (r) { return { t: r[0], v: which === "s" ? (r[4] === undefined ? null : r[4]) : (r[5] === undefined ? null : r[5]) }; });
    dongheWindFuture(id).forEach(function (p) { if (p.t > D.now) past.push({ t: p.t, v: p[which] === undefined ? null : p[which] }); });
    return past;
  }
  var WIND_IDS = ["cwa_coastal_donghe", "ecmwf", "gfs_wind"];
  function renderWindLive(box) {
    var obs = D.live.donghe.windObs || [], x0 = D.now - 72 * H, x1 = D.now + 72 * H;
    var buoyObs = (D.live.buoys.WRA007 || {}).obs || [];
    box.innerHTML = syn("Summary · Donghe · last 72 hours and next 3 days", windLiveSynopsis(obs)) +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Donghe station · measured + forecast</h3><span class="fc-note">Station C0S810 sits ~1 km inland at 65 m, so it reads lighter than the open water</span></div>' +
      '<div class="fc-now" id="nl-now"></div><div class="fc-legend" id="nl-legend"></div><div class="fc-stack">' +
      '<div class="fc-row"><h4>Wind speed</h4><div class="fc-chart" id="nl-s"></div></div>' +
      '<div class="fc-row"><h4>Wind direction <span class="fc-note">(coming from) · shaded: offshore and onshore for Donghe</span></h4><div class="fc-chart" id="nl-d"></div></div></div>' +
      '<p class="fc-note">Left of "now", each line is that source\'s forecast for the hour as made 6 hours ahead. CWA\'s coastal forecast is 3-hourly and runs 72 hours ahead.</p></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Reference: Taitung buoy · open water</h3><span class="fc-note">33 km SW of Donghe · forecasts at the buoy\'s position · no land shelter</span></div>' +
      '<div class="fc-chart" id="nl-b"></div></div>';
    var last = obs[obs.length - 1], now = "";
    if (last) {
      var call = windCall(last[1], last[2]);
      now += '<span><span class="k">Donghe ' + fmtWHM.format(last[0]) + "</span><b>" + f1(last[1]) + " m/s</b>" + (last[2] !== null && last[2] !== undefined ? " from " + compass(last[2]) : "") + (call ? " · " + call : "") + "</span>";
    }
    var bl = buoyObs.filter(function (o) { return o[4] !== null && o[4] !== undefined; }).pop();
    if (bl) now += '<span><span class="k">Taitung buoy ' + fmtWHM.format(bl[0]) + "</span><b>" + f1(bl[4]) + " m/s</b>" + (bl[5] !== null && bl[5] !== undefined ? " from " + compass(bl[5]) : "") + "</span>";
    document.getElementById("nl-now").innerHTML = now;
    var OBS = { label: "Donghe station (measured)", c: OBS_C, w: 2.5, gap: 2 };
    document.getElementById("nl-legend").innerHTML = legendHtml([OBS].concat(WIND_IDS.map(function (id) { return { label: SRC[id].name, c: SRC[id].c }; })));
    timeChart(document.getElementById("nl-s"), { xMin: x0, xMax: x1, now: D.now, auto: true, yFloor: 6, step: 2, tick: function (v) { return v + ""; }, fmt: function (v) { return f1(v) + " m/s"; },
      lines: [Object.assign({}, OBS, { pts: obs.map(function (o) { return { t: o[0], v: o[1] }; }) })].concat(WIND_IDS.map(function (id) { return { label: SRC[id].name, c: SRC[id].c, w: 2, pts: dongheWindLine(id, "s") }; })), aria: "Wind speed at Donghe" });
    timeChart(document.getElementById("nl-d"), { xMin: x0, xMax: x1, now: D.now, yMin: 0, yMax: 360, step: 90, h: 170, tick: function (v) { return ["N", "E", "S", "W", "N"][v / 90]; }, fmt: function (v) { return compass(v) + " (" + Math.round(v) + "°)"; },
      bands: [{ from: 45, to: 165, c: "var(--danger)", label: "onshore" }, { from: 225, to: 345, c: "var(--fc-good)", label: "offshore" }],
      lines: [Object.assign({}, OBS, { dots: true, r: 3, pts: obs.map(function (o) { return { t: o[0], v: o[2] }; }) })].concat(WIND_IDS.map(function (id) { return { label: SRC[id].name, c: SRC[id].c, dots: true, r: 2, op: 0.85, pts: dongheWindLine(id, "d") }; })), aria: "Wind direction at Donghe" });
    timeChart(document.getElementById("nl-b"), { xMin: x0, xMax: x1, now: D.now, auto: true, yFloor: 6, step: 2, tick: function (v) { return v + ""; }, fmt: function (v) { return f1(v) + " m/s"; },
      lines: [{ label: "Taitung buoy (measured)", c: OBS_C, w: 2.5, gap: 2, pts: buoyObs.map(function (o) { return { t: o[0], v: o[4] === undefined ? null : o[4] }; }) },
        { label: "ECMWF", c: SRC.ecmwf.c, w: 2, pts: waveModelLine("WRA007", "ecmwf", 4) }, { label: "GFS", c: SRC.gfs_wind.c, w: 2, pts: waveModelLine("WRA007", "gfs_wind", 4) }], aria: "Wind speed at the Taitung buoy" });
  }
  function windLiveSynopsis(obs) {
    var past = obs.filter(function (o) { return o[0] >= D.now - 72 * H && o[1] !== null && o[1] !== undefined; });
    if (!past.length) return "No recent readings from the Donghe station.";
    var out = [], last = past[past.length - 1], calls = {};
    past.forEach(function (o) { var c = windCall(o[1], o[2]); if (c) calls[c] = (calls[c] || 0) + 1; });
    var top = Object.keys(calls).sort(function (a, b) { return calls[b] - calls[a]; })[0];
    out.push("At the Donghe station the last 72 hours were mostly <b>" + top + "</b> (" + Math.round(calls[top] / past.length * 100) + "% of hours), now " + f1(last[1]) + " m/s" + (last[2] !== null && last[2] !== undefined ? " from " + compass(last[2]) + " (" + (windCall(last[1], last[2]) || "—") + ")" : "") + ".");
    var byHour = {}; past.forEach(function (o) { byHour[o[0]] = o; });
    var rank = WIND_IDS.map(function (id) {
      var n = 0, hit = 0;
      (D.live.donghe.asForecast[id] || []).forEach(function (r) { var o = byHour[r[0]]; if (!o) return; var a = windCall(r[4], r[5]), b = windCall(o[1], o[2]); if (!a || !b) return; n++; if (a === b) hit++; });
      return { id: id, n: n, pct: n ? Math.round(hit / n * 100) : null };
    }).filter(function (r) { return r.n >= 6; }).sort(function (a, b) { return b.pct - a.pct; });
    if (rank.length) out.push("Forecast 6 hours ahead, " + SRC[rank[0].id].name + " got the offshore/onshore call right most often here (" + rank[0].pct + "% of " + rank[0].n + " hours)" + (rank.length > 1 ? "; " + SRC[rank[rank.length - 1].id].name + " least (" + rank[rank.length - 1].pct + "%)" : "") + ".");
    var fut = dongheWindFuture("ecmwf").filter(function (p) { return p.t > D.now && p.t <= D.now + 48 * H && p.s !== null; });
    if (fut.length) {
      var cnt = {}; fut.forEach(function (p) { var c = windCall(p.s, p.d); if (c) cnt[c] = (cnt[c] || 0) + 1; });
      var next = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      if (next) out.push("ECMWF expects mostly " + next + " wind over the next 48 hours.");
    }
    return out.join(" ");
  }
  function renderWindHist(box) {
    var Ns = S.nh, W = (D.stats.windows[Ns.win] || {});
    var sp = (W.windSpeed || []).filter(function (x) { return x.lead === Ns.lead; });
    var dir = (W.windDirection || []).filter(function (x) { return x.lead === Ns.lead; });
    var ids = ["cwa_coastal_donghe", "cwa_township_wind", "ecmwf", "gfs_wind"];
    var spRows = ids.map(function (id) { return { id: id, st: sp.filter(function (x) { return x.truth === "C0S810" && x.source === id; })[0] || { n: 0 } }; });
    var bRows = ["ecmwf", "gfs_wind"].map(function (id) { return { id: id, sub: "At the Taitung buoy's position", st: sp.filter(function (x) { return x.truth === "WRA007" && x.source === id; })[0] || { n: 0 } }; });
    var dRows = ids.map(function (id) { return { id: id, st: dir.filter(function (x) { return x.source === id; })[0] || { n: 0 } }; });
    var dh = "<table><thead><tr><th>Source</th><th>Right call</th><th>Matched hours</th></tr></thead><tbody>" + dRows.map(function (r) {
      var s = SRC[r.id]; return '<tr><td><span class="fc-src"><span class="fc-sw" style="background:' + s.c + '"></span>' + s.name + '</span><span class="fc-sub">' + s.sub + "</span></td>" +
        (r.st.n ? '<td class="num">' + r.st.pct + '%</td><td class="num' + (r.st.n < ENOUGH ? " fc-thin" : "") + '">' + r.st.n + (r.st.n < ENOUGH ? " · thin" : "") + "</td>" : '<td class="num fc-thin">no data yet</td><td class="num fc-thin">0</td>') + "</tr>";
    }).join("") + "</tbody></table>";
    var okDir = dRows.filter(function (r) { return r.st.n >= 12; }).sort(function (a, b) { return b.st.pct - a.st.pct; });
    var okSp = spRows.filter(function (r) { return r.st.n >= 12; }).sort(function (a, b) { return a.st.mae - b.st.mae; });
    var s1 = okDir.length ? "Over the " + (Ns.win === "7d" ? "last 7 days" : "last 30 days") + ", <b>" + SRC[okDir[0].id].name + "</b> has made the best offshore/onshore call at Donghe " + Ns.lead + " hours ahead (" + okDir[0].st.pct + "% right)." : "Not enough matched hours yet to score the offshore/onshore call.";
    var s2 = okSp.length ? " For speed, " + SRC[okSp[0].id].name + " has been closest to the Donghe station (within " + f1(okSp[0].st.mae) + " m/s)" + (okSp.some(function (r) { return r.st.bias > 1; }) ? "; " + nameList(okSp.filter(function (r) { return r.st.bias > 1; }).map(function (r) { return SRC[r.id].name; })) + " read well above it, largely because the station is sheltered" : "") + "." : "";
    box.innerHTML = syn("Summary · Donghe · " + (Ns.win === "7d" ? "last 7 days" : "last 30 days") + " · forecasts made " + Ns.lead + "h ahead", s1 + s2) +
      '<div class="fc-controls"><div class="fc-ctl"><span class="fc-ctl-label">Made</span><div class="fc-seg" id="nh-lead"></div><span class="fc-ctl-label">ahead</span></div>' +
      '<div class="fc-ctl"><span class="fc-ctl-label">Over</span><div class="fc-seg" id="nh-win"></div></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Offshore / onshore call at Donghe</h3><span class="fc-note">Light (&lt; 2 m/s), offshore (from W–NW), onshore (from E–ESE) or cross-shore, forecast vs the station</span></div><div class="fc-score">' + dh + "</div></div>" +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Wind speed vs the Donghe station</h3><span class="fc-note">m/s · the station is sheltered, so "reads high" is partly the site</span></div><div class="fc-score">' + scoreTable(spRows, "m/s", f1, 0.5) + "</div>" +
      '<div class="fc-chart" id="nh-ts"><p class="fc-empty">Loading the last 7 days…</p></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Reference: wind speed vs the Taitung buoy</h3><span class="fc-note">m/s · open water, forecasts at the buoy\'s position (logged since Oct 6)</span></div><div class="fc-score">' + scoreTable(bRows, "m/s", f1, 0.5) + "</div></div>";
    seg(document.getElementById("nh-lead"), LEADS.map(function (l) { return { label: l + "h", value: l }; }), Ns.lead, function (v) { Ns.lead = +v; save(); render(); });
    seg(document.getElementById("nh-win"), [{ label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }], Ns.win, function (v) { Ns.win = v; save(); render(); });
    loadHistory().then(function () {
      if (S.tab !== "wind" || S.sub.wind !== "hist") return;
      var x1 = Date.parse(D.history.updatedAt), x0 = x1 - 7 * 24 * H;
      timeChart(document.getElementById("nh-ts"), { xMin: x0, xMax: x1, auto: true, yFloor: 6, step: 2, tick: function (v) { return v + ""; }, fmt: function (v) { return f1(v) + " m/s"; },
        lines: [{ label: "Donghe station", c: OBS_C, w: 2.5, gap: 2, pts: D.history.dongheWind.map(function (r) { return { t: r[0], v: r[1] === undefined ? null : r[1] }; }) }]
          .concat(WIND_IDS.map(function (id) { return { label: SRC[id].name + " (" + Ns.lead + "h ahead)", c: SRC[id].c, w: 2, gap: 4, pts: (D.history.forecasts["donghe|" + id + "|" + Ns.lead] || []).map(function (r) { return { t: r[0], v: r[4] === undefined ? null : r[4] }; }) }; })), aria: "Wind speed at Donghe, last 7 days" });
    }).catch(function () { var e = document.getElementById("nh-ts"); if (e) e.innerHTML = '<p class="fc-empty">Couldn\'t load the last 7 days.</p>'; });
  }

  /* =================== TIDE =================== */
  function interp(pts, t) {
    if (!pts.length || t < pts[0][0] || t > pts[pts.length - 1][0]) return null;
    for (var i = 0; i < pts.length - 1; i++) if (t >= pts[i][0] && t <= pts[i + 1][0]) { var f = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]), mu = (1 - Math.cos(f * Math.PI)) / 2; return pts[i][1] * (1 - mu) + pts[i + 1][1] * mu; }
    return null;
  }
  function kind(pts, i) { var p = pts[i], a = pts[i - 1] || pts[i + 1], b = pts[i + 1] || pts[i - 1]; return p[1] > a[1] && p[1] > b[1] ? "High" : "Low"; }
  function tideStats(rows) {
    if (!rows.length) return null;
    var d = rows.map(function (r) { return r[1] - r[2]; }), bias = d.reduce(function (a, b) { return a + b; }, 0) / d.length;
    return { n: d.length, bias: bias, mae: d.reduce(function (a, b) { return a + Math.abs(b); }, 0) / d.length, maeShape: d.reduce(function (a, b) { return a + Math.abs(b - bias); }, 0) / d.length, worst: d.reduce(function (a, b) { return Math.abs(b) > Math.abs(a) ? b : a; }, 0) };
  }
  function cgPoints() { return (D.extrema && D.extrema.location === "臺東縣成功鎮" ? D.extrema.points : []).map(function (p) { return [Date.parse(p.t), p.h]; }); }
  function dhPoints() {
    var out = [];
    try { D.tideJson.records.TideForecasts[0].Location.TimePeriods.Daily.forEach(function (d) { (d.Time || []).forEach(function (t) { var h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL); out.push([Date.parse(t.DateTime), Number(h)]); }); }); } catch (e) {}
    return out.sort(function (a, b) { return a[0] - b[0]; });
  }
  function renderTideLive(box) {
    var T = S.tl, rows = D.live.tide || [], cg = cgPoints(), dh = dhPoints();
    var log = rows.filter(function (r) { return r[1] !== null; }), paired = log.filter(function (r) { return r[2] !== null; });
    function predAt(t) { var v = interp(cg, t); if (v !== null) return v; var best = null; rows.forEach(function (r) { if (r[2] !== null && Math.abs(r[0] - t) < 31 * 60000) best = r[2]; }); return best; }
    var recent = paired.filter(function (r) { return r[0] > D.now - 24 * H; });
    var avg = recent.length ? recent.reduce(function (a, r) { return a + r[1] - r[2]; }, 0) / recent.length : null;
    var nx = { High: null, Low: null }; cg.forEach(function (p, i) { if (p[0] > D.now) { var k = kind(cg, i); if (!nx[k]) nx[k] = p; } });
    box.innerHTML = syn("Summary · Chenggong · last 72 hours and next tides", tideLiveSynopsis(paired, avg, nx)) +
      '<div class="fc-controls"><div class="fc-ctl"><span class="fc-ctl-label">Show</span><div class="fc-seg" id="tl-ahead"></div></div>' +
      '<label class="fc-toggle"><input type="checkbox" id="tl-dh"' + (T.dh ? " checked" : "") + '><span class="fc-tg"></span>Donghe prediction (what the dashboard\'s tide chart shows)</label></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Chenggong · measured + predicted</h3><span class="fc-note">Gauge C4S02, 15 km NNE of Donghe · cm above TWVD2001</span></div>' +
      '<div class="fc-now" id="tl-now"></div><div class="fc-legend" id="tl-legend"></div><div class="fc-stack">' +
      '<div class="fc-row"><h4>Tide height</h4><div class="fc-chart" id="tl-tide"></div></div>' +
      '<div class="fc-row"><h4>Gauge minus prediction <span class="fc-note">(above zero: the sea is higher than predicted)</span></h4><div class="fc-legend" id="tl-rleg"></div><div class="fc-chart" id="tl-resid"></div></div></div></div>';
    seg(document.getElementById("tl-ahead"), [{ label: "Next 3 days", value: 3 }, { label: "Next 6 days", value: 6 }], T.ahead, function (v) { T.ahead = +v; save(); render(); });
    document.getElementById("tl-dh").addEventListener("change", function (e) { T.dh = e.target.checked; save(); render(); });
    var x0 = D.now - 72 * H, x1 = D.now + T.ahead * 24 * H, curve = [];
    for (var t = Math.ceil(x0 / (15 * 60000)) * 15 * 60000; t <= x1; t += 15 * 60000) curve.push({ t: t, v: predAt(t) });
    var lines = [{ label: "Chenggong predicted (CWA)", c: "var(--fc-s1)", w: 2, pts: curve }];
    if (T.dh) { var dl = []; curve.forEach(function (p) { var v = interp(dh, p.t); if (v !== null) dl.push({ t: p.t, v: v }); }); lines.push({ label: "Donghe predicted", c: "var(--fc-s2)", w: 1.5, dash: "5 4", pts: dl }); }
    lines.push({ label: "Chenggong gauge (measured)", c: OBS_C, w: 2.5, gap: 2, pts: log.map(function (r) { return { t: r[0], v: r[1] }; }) });
    document.getElementById("tl-legend").innerHTML = legendHtml(lines);
    var marks = [], n = 0; cg.forEach(function (p, i) { if (p[0] > D.now && n < 4) { var k = kind(cg, i); marks.push({ t: p[0], v: p[1], high: k === "High", label: fmtHM.format(p[0]) + " · " + f0(p[1]) }); n++; } });
    timeChart(document.getElementById("tl-tide"), { xMin: x0, xMax: x1, now: D.now, yMin: -100, yMax: 150, step: 50, h: document.getElementById("tl-tide").clientWidth < 500 ? 230 : 270, tick: function (v) { return v + ""; }, fmt: function (v) { return f0(v) + " cm"; }, lines: lines, marks: marks, aria: "Tide height, measured and predicted" });
    var resid = paired.map(function (r) { return { t: r[0], v: r[1] - r[2] }; });
    var press = rows.filter(function (r) { return r[3] !== null && r[3] !== undefined; }).map(function (r) { return { t: r[0], v: -(r[3] - 1013.25) }; });
    var rl = [{ label: "Gauge minus prediction", c: OBS_C, w: 2, gap: 2, pts: resid }];
    if (press.length) rl.push({ label: "What air pressure alone would do", c: "var(--fc-s3)", w: 1.5, dash: "5 4", gap: 2, pts: press });
    document.getElementById("tl-rleg").innerHTML = legendHtml(rl);
    timeChart(document.getElementById("tl-resid"), { xMin: x0, xMax: x1, now: D.now, yMin: -20, yMax: 40, step: 20, h: 150, tick: function (v) { return (v > 0 ? "+" : "") + v; }, fmt: function (v) { return sgn(v) + " cm"; }, areas: [{ c: OBS_C, pts: resid }], lines: rl, aria: "Gauge minus prediction" });
    var last = log[log.length - 1], h = "";
    if (last) h += '<span><span class="k">Gauge ' + fmtWHM.format(last[0]) + "</span><b>" + f0(last[1]) + " cm</b>" + (last[2] !== null ? " · predicted " + f0(last[2]) : "") + "</span>";
    if (avg !== null) h += '<span><span class="k">Last 24 h</span><b>' + sgn(avg) + " cm</b> vs prediction</span>";
    ["High", "Low"].forEach(function (k) { if (nx[k]) h += '<span><span class="k">Next ' + k.toLowerCase() + "</span><b>" + fmtHM.format(nx[k][0]) + "</b> " + fmtDay.format(nx[k][0]) + " · " + f0(nx[k][1]) + " cm</span>"; });
    document.getElementById("tl-now").innerHTML = h;
  }
  function tideLiveSynopsis(paired, avg, nx) {
    var out = [], win = paired.filter(function (r) { return r[0] >= D.now - 72 * H; }), ws = tideStats(win), last = paired[paired.length - 1];
    if (ws && last) {
      var cur = last[1] - last[2], away = cur - ws.bias;
      out.push("Over the last 72 hours the sea at Chenggong ran on average <b>" + sgn(ws.bias) + " cm</b> against CWA's prediction; at the latest reading it was " + sgn(cur) + " cm" + (Math.abs(away) >= 8 ? ", " + (away > 0 ? "well above" : "well below") + " that usual offset" : ", close to that usual offset") + ".");
    }
    // Pressure: only ever used to explain the gap (inverse barometer, ~1 cm per hPa).
    var pr = (D.live.tide || []).filter(function (r) { return r[3] !== null && r[3] !== undefined && r[0] > D.now - 6 * H; });
    if (pr.length && avg !== null) {
      var p = pr.reduce(function (a, r) { return a + r[3]; }, 0) / pr.length, effect = -(p - 1013.25);
      out.push(Math.abs(effect) < 3 ? "Air pressure is near normal (" + f0(p) + " hPa), so it isn't the cause." :
        effect < 0 ? "Air pressure is high (" + f0(p) + " hPa), which on its own would lower the sea about " + f0(-effect) + " cm" + (avg > 0 ? " — so the extra water is coming from something else, most likely wind and swell pushing it against the coast" : "") + "." :
        "Air pressure is low (" + f0(p) + " hPa), which on its own would raise the sea about " + f0(effect) + " cm" + (avg > 0 ? (effect >= avg * 0.7 ? " — that explains most of the gap" : " — part of the gap") : "") + ".");
    } else if (ws) out.push("With the steady offset removed, the prediction's timing and shape have held to within about " + f0(ws.maeShape) + " cm.");
    if (avg !== null && (nx.High || nx.Low)) {
      var bits = ["Low", "High"].filter(function (k) { return nx[k]; }).sort(function (a, c) { return nx[a][0] - nx[c][0]; }).map(function (k, i) {
        return "next " + k.toLowerCase() + " is <b>" + fmtWHM.format(nx[k][0]) + "</b>, predicted " + f0(nx[k][1]) + " cm, or about " + f0(nx[k][1] + avg) + " cm " + (i === 0 ? "if the last 24 hours' offset holds" : "with the same offset");
      });
      out.push(bits[0].charAt(0).toUpperCase() + bits[0].slice(1) + (bits[1] ? "; " + bits[1] : "") + ".");
    }
    return out.length ? out.join(" ") : "Not enough recent gauge readings yet.";
  }
  function renderTideHist(box) {
    var Ts = S.th, T = (D.stats.windows[Ts.win] || {}).tide;
    box.innerHTML = syn("Summary · Chenggong · " + (Ts.win === "7d" ? "last 7 days" : "last 30 days"), tideHistSynopsis(T)) +
      '<div class="fc-controls"><div class="fc-ctl"><span class="fc-ctl-label">Over</span><div class="fc-seg" id="th-win"></div></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Scorecard by tide stage</h3><span class="fc-note">last 7 days · cm · "near" = within 90 minutes of a predicted high or low</span></div><div class="fc-score" id="th-score"><p class="fc-empty">Loading…</p></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Day by day</h3><span class="fc-note">Average offset and typical miss per day, cm</span></div><div class="fc-legend">' + legendHtml([{ label: "Offset (signed)", c: "var(--fc-s1)" }, { label: "Typical miss", c: "var(--fc-s2)" }]) + '</div><div class="fc-chart" id="th-daily"></div></div>' +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Predicted vs measured, every hour</h3><span class="fc-note">last 7 days · on the diagonal = exactly as predicted</span></div><div class="fc-chart" id="th-scatter"><p class="fc-empty">Loading…</p></div></div>' +
      '<div class="fc-notes"><b>Reading this</b><ul><li>Gauge and prediction are both for Chenggong, so they describe the same water. The dashboard\'s tide chart shows Donghe; the two run very close (compare on the Live tab).</li><li>"Offset removed" separates a steady difference (seasonal sea level, the datum) from the prediction getting the shape and timing wrong.</li><li>Air pressure is used only to explain the offset: about 1 cm of sea level per hPa below normal.</li><li>The log restarted on Oct 2, when forecast and gauge were matched to the same station.</li></ul></div>';
    seg(document.getElementById("th-win"), [{ label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }], Ts.win, function (v) { Ts.win = v; save(); render(); });
    dailyBars(document.getElementById("th-daily"), (T && T.daily) || []);
    loadHistory().then(function () {
      if (S.tab !== "tide" || S.sub.tide !== "hist") return;
      var rows = D.history.tide.filter(function (r) { return r[1] !== null && r[2] !== null; });
      // Stages from the prediction: turning points recovered from the hourly predicted values.
      var turns = [];
      for (var i = 1; i < rows.length - 1; i++) { var a = rows[i - 1][2], b = rows[i][2], c = rows[i + 1][2]; if ((b > a && b >= c) || (b < a && b <= c)) turns.push({ t: rows[i][0], k: b > a ? "high" : "low" }); }
      function stage(r, i) {
        var best = null; turns.forEach(function (tp) { var d = Math.abs(tp.t - r[0]); if (!best || d < best.d) best = { d: d, k: tp.k }; });
        if (best && best.d <= 90 * 60000) return "Near " + best.k;
        var prev = rows[i - 1], next = rows[i + 1]; return prev && next ? (next[2] > prev[2] ? "Rising" : "Falling") : null;
      }
      var groups = [{ name: "All hours", rows: rows }];
      ["Near high", "Near low", "Rising", "Falling"].forEach(function (s) { groups.push({ name: s, rows: rows.filter(function (r, i) { return stage(r, i) === s; }) }); });
      var h = "<table><thead><tr><th>Tide stage</th><th>Typical miss</th><th>Offset</th><th>Miss, offset removed</th><th>Worst</th><th>Hours</th></tr></thead><tbody>";
      groups.forEach(function (g, i) {
        var s = tideStats(g.rows);
        h += '<tr><td><span class="fc-src" style="font-weight:' + (i ? 400 : 600) + '">' + g.name + "</span></td>" + (s ? '<td class="num">' + f0(s.mae) + ' cm</td><td class="num">' + sgn(s.bias) + ' cm <span class="fc-dir">' + (Math.abs(s.bias) < 3 ? "about right" : s.bias > 0 ? "sea higher" : "sea lower") + '</span></td><td class="num">' + f0(s.maeShape) + ' cm</td><td class="num">' + sgn(s.worst) + ' cm</td><td class="num">' + s.n + "</td>" : '<td class="num fc-thin" colspan="5">no data yet</td>') + "</tr>";
      });
      if (T && T.pressure) h += '<tr class="fc-baseline"><td>Offset with the pressure effect removed</td><td class="num">—</td><td class="num">' + sgn(T.pressure.biasPressureAdjusted) + ' cm</td><td class="num" colspan="2">' + (Ts.win === "7d" ? "last 7 days" : "last 30 days") + ", " + T.pressure.n + ' h with pressure</td><td class="num">' + T.pressure.n + "</td></tr>";
      document.getElementById("th-score").innerHTML = h + "</tbody></table>";
      scatter(document.getElementById("th-scatter"), rows);
    }).catch(function () { ["th-score", "th-scatter"].forEach(function (id) { var e = document.getElementById(id); if (e) e.innerHTML = '<p class="fc-empty">Couldn\'t load the last 7 days.</p>'; }); });
  }
  function tideHistSynopsis(T) {
    if (!T || !T.n) return "Not enough matched hours yet.";
    var out = ["Over " + T.n + " matched hours, CWA's prediction has matched the tide's shape and timing to within about <b>" + f0(T.maeShape) + " cm</b> once its steady " + sgn(T.bias) + " cm offset is removed."];
    var ds = (T.daily || []).filter(function (d) { return d[1] >= 6; });
    if (ds.length > 1) {
      var mx = ds.reduce(function (a, d) { return d[2] > a[2] ? d : a; }), mn = ds.reduce(function (a, d) { return d[2] < a[2] ? d : a; });
      out.push("Day to day the offset ranged from " + sgn(mn[2]) + " to " + sgn(mx[2]) + " cm, highest on " + fmtDay.format(Date.parse(mx[0] + "T12:00:00+08:00")) + ".");
    }
    if (T.pressure) {
      var p = T.pressure;
      out.push("Taking out the air-pressure effect " + (Math.abs(p.biasPressureAdjusted) > Math.abs(p.biasRaw) + 1 ? "makes the offset larger (" + sgn(p.biasPressureAdjusted) + " cm), so pressure isn't behind it" : Math.abs(p.biasPressureAdjusted) < Math.abs(p.biasRaw) - 1 ? "shrinks it to " + sgn(p.biasPressureAdjusted) + " cm, so pressure explains part of it" : "barely changes it (" + sgn(p.biasPressureAdjusted) + " cm)") + ".");
    }
    return out.join(" ");
  }
  function dailyBars(box, daily) {
    box.innerHTML = "";
    if (!daily.length) { box.innerHTML = '<p class="fc-empty">No days yet.</p>'; return; }
    var W = Math.max(300, box.clientWidth), Hh = 200, pad = { l: 42, r: 10, t: 12, b: 26 }, yMin = -10, yMax = 30, step = 10;
    daily.forEach(function (d) { if (d[3] > yMax) yMax = Math.ceil(d[3] / 10) * 10; if (d[2] < yMin) yMin = Math.floor(d[2] / 10) * 10; });
    function sy(v) { return pad.t + (1 - (v - yMin) / (yMax - yMin)) * (Hh - pad.t - pad.b); }
    var colW = (W - pad.l - pad.r) / daily.length, bw = Math.min(22, colW / 3), every = Math.ceil(daily.length / Math.max(2, Math.floor((W - pad.l) / 56)));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + Hh, role: "img", "aria-label": "Daily offset and typical miss" });
    var g = svgEl("g", { class: "fc-grid" }), ax = svgEl("g", { class: "fc-axis" });
    for (var v = yMin; v <= yMax; v += step) { g.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), style: v === 0 ? "stroke:var(--fc-ink-3)" : "" })); ax.appendChild(svgEl("text", { x: pad.l - 6, y: sy(v) + 4, "text-anchor": "end" }, (v > 0 ? "+" : "") + v)); }
    svg.appendChild(g); svg.appendChild(ax);
    var tip = document.createElement("div"); tip.className = "fc-tip"; tip.hidden = true;
    daily.forEach(function (d, i) {
      var cx = pad.l + colW * (i + 0.5), day = Date.parse(d[0] + "T12:00:00+08:00");
      if (i % every === 0) ax.appendChild(svgEl("text", { x: cx, y: Hh - 8, "text-anchor": "middle" }, fmtDay.format(day)));
      [[d[2], "var(--fc-s1)", -bw - 1], [d[3], "var(--fc-s2)", 1]].forEach(function (b) { var y0 = sy(0), y1 = sy(b[0]); svg.appendChild(svgEl("rect", { x: cx + b[2], y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), rx: 3, style: "fill:" + b[1] })); });
      var hit = svgEl("rect", { x: cx - colW / 2, y: pad.t, width: colW, height: Hh - pad.t - pad.b, fill: "transparent", style: "cursor:pointer" });
      function show() { tip.innerHTML = '<div class="t">' + fmtDay.format(day) + '</div><div class="r"><span>Offset</span><span class="v">' + sgn(d[2]) + ' cm</span></div><div class="r"><span>Typical miss</span><span class="v">' + f0(d[3]) + ' cm</span></div><div class="r"><span>Hours</span><span class="v">' + d[1] + "</span></div>"; tip.hidden = false; placeTip(tip, box, svg, W, cx); }
      hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", function () { tip.hidden = true; });
      svg.appendChild(hit);
    });
    box.appendChild(svg); box.appendChild(tip);
  }
  function scatter(box, rows) {
    box.innerHTML = "";
    var SW = Math.max(280, Math.min(box.clientWidth, 480)), SH = SW, sp = { l: 44, r: 12, t: 12, b: 36 }, lo = -100, hi = 150;
    function px(v) { return sp.l + (v - lo) / (hi - lo) * (SW - sp.l - sp.r); }
    function py(v) { return sp.t + (1 - (v - lo) / (hi - lo)) * (SH - sp.t - sp.b); }
    var svg = svgEl("svg", { viewBox: "0 0 " + SW + " " + SH, role: "img", "aria-label": "Predicted versus measured tide", style: "max-width:480px" });
    var g = svgEl("g", { class: "fc-grid" }), ax = svgEl("g", { class: "fc-axis" });
    for (var v = lo; v <= hi; v += 50) {
      g.appendChild(svgEl("line", { x1: sp.l, x2: SW - sp.r, y1: py(v), y2: py(v) })); g.appendChild(svgEl("line", { y1: sp.t, y2: SH - sp.b, x1: px(v), x2: px(v) }));
      ax.appendChild(svgEl("text", { x: sp.l - 6, y: py(v) + 4, "text-anchor": "end" }, v)); ax.appendChild(svgEl("text", { x: px(v), y: SH - sp.b + 15, "text-anchor": "middle" }, v));
    }
    ax.appendChild(svgEl("text", { x: (sp.l + SW - sp.r) / 2, y: SH - 4, "text-anchor": "middle" }, "Predicted (cm)"));
    ax.appendChild(svgEl("text", { x: 12, y: (sp.t + SH - sp.b) / 2, "text-anchor": "middle", transform: "rotate(-90 12 " + (sp.t + SH - sp.b) / 2 + ")" }, "Measured (cm)"));
    svg.appendChild(g); svg.appendChild(ax);
    svg.appendChild(svgEl("line", { x1: px(lo), y1: py(lo), x2: px(hi), y2: py(hi), style: "stroke:var(--fc-ink-3);stroke-width:1.5;stroke-dasharray:5 4" }));
    rows.forEach(function (r) { svg.appendChild(svgEl("circle", { cx: px(r[2]), cy: py(r[1]), r: 3.5, style: "fill:var(--fc-s1);opacity:.7;stroke:var(--bg-card);stroke-width:1" })); });
    box.appendChild(svg);
  }

  /* =================== TYPHOON SWELLS =================== */
  function renderTyphoon(box) {
    var ev = ((D.stats || {}).typhoonSwell || []).slice().sort(function (a, b) { return Date.parse(b.lastPrediction.peakAt) - Date.parse(a.lastPrediction.peakAt); });
    var clean = ev.filter(function (e) { return e.observedPeak && !(e.overlapsWith || []).length; });
    var s = !ev.length ? "No typhoon swell predictions logged in the last two months." :
      ev.length + " storm" + (ev.length > 1 ? "s" : "") + " with a swell prediction in the logs; " + (clean.length ? clean.length + " can be scored cleanly. " + clean.map(function (e) {
        var dt = e.peakTimingErrorH, dh = e.lastPrediction.heightM - e.observedPeak.heightM;
        return "For " + esc(e.name) + ", the peak was called " + (Math.abs(dt) <= 3 ? "within " + Math.max(1, Math.abs(dt)) + " hour" + (Math.abs(dt) > 1 ? "s" : "") : Math.abs(dt) + " hours " + (dt > 0 ? "late" : "early")) + " and " + (Math.abs(dh) < 0.3 ? "about the right size" : f1(Math.abs(dh)) + " m too " + (dh < 0 ? "small" : "big")) + ".";
      }).join(" ") : "the rest overlapped other storms, so the buoy can't separate their swells.");
    box.innerHTML = syn("Summary · typhoon swell calls vs the Chenggong buoy", s) +
      '<div class="fc-panel"><div class="fc-panel-head"><h3>Predicted vs observed swell peaks</h3><span class="fc-note">Prediction: the dashboard\'s typhoon swell alert. Observed: the biggest Chenggong-buoy reading within 36 h of the predicted peak.</span></div>' +
      '<div class="fc-events">' + (ev.map(function (e) {
        var o = e.observedPeak, fp = e.firstPrediction, lp = e.lastPrediction;
        return '<div class="fc-event"><h4>' + esc(e.name) + ' <span class="fc-note">' + esc(e.id) + " · " + e.predictions + " predictions</span></h4><dl>" +
          "<dt>First call</dt><dd>" + fmtWHM.format(Date.parse(fp.peakAt)) + " · " + f1(fp.heightM) + " m, " + f1(fp.periodS) + " s <span class=\"fc-note\">(made " + fmtFull.format(Date.parse(fp.issuedAt)) + ")</span></dd>" +
          "<dt>Last call before the peak</dt><dd>" + fmtWHM.format(Date.parse(lp.peakAt)) + " · " + f1(lp.heightM) + " m, " + f1(lp.periodS) + " s</dd>" +
          "<dt>Observed peak</dt><dd>" + (o ? fmtWHM.format(Date.parse(o.at)) + " · " + f1(o.heightM) + " m" + (o.periodS !== null && o.periodS !== undefined ? ", " + f1(o.periodS) + " s" : "") : "no buoy readings") + "</dd>" +
          (o ? "<dt>Timing</dt><dd>" + (e.peakTimingErrorH === 0 ? "on time" : Math.abs(e.peakTimingErrorH) + " h " + (e.peakTimingErrorH > 0 ? "late" : "early")) + "</dd>" : "") +
          "</dl>" + ((e.overlapsWith || []).length ? '<p class="fc-flag">⚠ Overlaps ' + esc(nameList(e.overlapsWith)) + " — the buoy can't tell their swells apart, so this isn't a clean score.</p>" : "") + "</div>";
      }).join("") || '<p class="fc-empty">Nothing yet.</p>') + "</div>" +
      '<p class="fc-note">The buoy measures the whole sea while the alert predicts the storm\'s swell, so sizes are a rough check. Timing is the more reliable comparison.</p></div>';
  }

  /* =================== shell =================== */
  var TABS = ["waves", "wind", "tide", "typhoon"];
  function subtabs(tab) {
    if (tab === "typhoon") return "";
    return '<div class="fc-subtabs" role="tablist" aria-label="View"><button type="button" role="tab" data-sub="live" aria-selected="' + (S.sub[tab] === "live") + '">Live</button><button type="button" role="tab" data-sub="hist" aria-selected="' + (S.sub[tab] === "hist") + '">Accuracy history</button></div>';
  }
  function render() {
    TABS.forEach(function (t) {
      document.getElementById("t-" + t).setAttribute("aria-selected", String(t === S.tab));
      document.getElementById("p-" + t).hidden = t !== S.tab;
    });
    var panel = document.getElementById("p-" + S.tab);
    panel.innerHTML = subtabs(S.tab) + '<div class="fc-view" id="fc-body"></div>';
    panel.querySelectorAll("[data-sub]").forEach(function (b) { b.addEventListener("click", function () { S.sub[S.tab] = b.getAttribute("data-sub"); save(); render(); }); });
    var body = document.getElementById("fc-body");
    if (!D.live || !D.stats) { body.innerHTML = '<p class="fc-empty">' + (D.error ? "Couldn't load the Forecast Check data (" + esc(D.error) + ")." : "Loading…") + "</p>"; return; }
    try {
      var fn = { waves: [renderWavesLive, renderWavesHist], wind: [renderWindLive, renderWindHist], tide: [renderTideLive, renderTideHist], typhoon: [renderTyphoon, renderTyphoon] }[S.tab];
      fn[S.sub[S.tab] === "hist" ? 1 : 0](body);
    } catch (e) {
      body.innerHTML = '<p class="fc-empty">Something went wrong drawing this view (' + esc(e.message) + ").</p>";
      if (window.console) console.error(e);
    }
  }
  TABS.forEach(function (t) { document.getElementById("t-" + t).addEventListener("click", function () { S.tab = t; save(); if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t); render(); }); });
  function fromHash() { var h = location.hash.replace("#", ""); if (TABS.indexOf(h) >= 0) S.tab = h; }
  window.addEventListener("hashchange", function () { fromHash(); render(); });
  fromHash();
  render();

  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(render, 150); });

  /* ---------- load ---------- */
  function optional(p) { return getJSON(p).catch(function () { return null; }); }
  Promise.all([getJSON("data/phase3-live.json"), getJSON("data/phase3-stats.json"), optional("data/buoy-site-forecasts.json"),
    optional("data/ecmwf.json"), optional("data/gfs-wind.json"), optional("data/coastal.json"), optional("data/tide-extrema.json"), optional("data/tide.json"), optional("data/meta.json")])
    .then(function (r) {
      D.live = r[0]; D.stats = r[1]; D.site = r[2] || {}; D.ecmwf = r[3]; D.gfsWind = r[4]; D.coastal = r[5]; D.extrema = r[6]; D.tideJson = r[7];
      D.now = Date.now();
      var up = r[8] && r[8].updatedAt ? new Date(r[8].updatedAt) : new Date(D.live.updatedAt);
      var mins = Math.round((D.now - up.getTime()) / 60000);
      document.getElementById("lastUpdated").textContent = "Updated " + (mins < 60 ? mins + " min" : Math.round(mins / 60) + " h") + " ago";
      document.getElementById("lastUpdated").title = "Data refreshed " + fmtFull.format(up);
      render();
    })
    .catch(function (e) { D.error = e.message; render(); });
})();
