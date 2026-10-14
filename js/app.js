(function () {
  "use strict";

  /* ---------- Stale-asset self-heal ----------
     GitHub Pages serves index.html itself with Cache-Control: max-age=600,
     and browsers routinely hold it much longer (bfcache, a tab left open,
     mobile heuristics). The ?v= cache-buster on css/js only helps if the
     browser re-fetches index.html — when it doesn't, the visitor keeps
     running old code indefinitely and sees bugs that were fixed days ago.

     version.json is fetched with cache:"no-store", so it is always current
     even when index.html is not. If the version baked into this file doesn't
     match it, this page IS the stale copy: reload once with a cache-busting
     query to pull a fresh index.html. The sessionStorage guard means a
     mismatch can never cause more than one reload per session, so a
     forgotten version bump degrades to one wasted reload, not a loop. */
  var ASSET_VERSION = "2026-10-14b";
  var RELOAD_GUARD = "surf-asset-reload";

  (function selfHealStaleAssets() {
    var alreadyTried = false;
    try { alreadyTried = sessionStorage.getItem(RELOAD_GUARD) === ASSET_VERSION; } catch (e) { alreadyTried = true; }
    if (alreadyTried) return;
    fetch("version.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.assets || v.assets === ASSET_VERSION) return;
        try { sessionStorage.setItem(RELOAD_GUARD, ASSET_VERSION); } catch (e) { return; }
        var u = location.href.split("#")[0];
        location.replace(u + (u.indexOf("?") === -1 ? "?" : "&") + "_v=" + encodeURIComponent(v.assets));
      })
      .catch(function () { /* offline or blocked — keep showing what we have */ });
  })();

  /* ---------- Quick-link offset ----------
     The header is sticky and wraps on a phone, so the quick links' jump
     targets need its real height above them (scroll-margin-top in CSS). */
  (function trackHeaderHeight() {
    var hdr = document.querySelector(".site-header");
    if (!hdr) return;
    function set() { document.documentElement.style.setProperty("--header-h", hdr.offsetHeight + "px"); }
    set();
    window.addEventListener("resize", set);
  })();

  /* ---------- Theme toggle (default dark) ---------- */
  var root = document.documentElement;
  var toggleBtn = document.getElementById("themeToggle");

  function applyTheme(theme) {
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
      toggleBtn.textContent = "☀️";
    } else {
      root.setAttribute("data-theme", "dark");
      toggleBtn.textContent = "🌙";
    }
  }

  var savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem("surf-theme") || "dark";
  } catch (e) { /* localStorage unavailable — default dark */ }
  applyTheme(savedTheme);

  toggleBtn.addEventListener("click", function () {
    var current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
    var next = current === "light" ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem("surf-theme", next); } catch (e) { /* ignore */ }
  });

  /* ---------- Translation helpers (CWA data is Chinese; this site is English) ---------- */
  var DIR_ZH_EN = {
    "北": "N", "北北東": "NNE", "東北": "NE", "東北東": "ENE", "東": "E", "東南東": "ESE", "東南": "SE", "南南東": "SSE",
    "南": "S", "南南西": "SSW", "西南": "SW", "西西南": "WSW", "西": "W", "西北西": "WNW", "西北": "NW", "北北西": "NNW"
  };
  function translateDirText(s) {
    if (!s) return s;
    s = ("" + s).trim();
    var m = s.match(/^(.+?)風$/);
    if (m) {
      var base = m[1].replace(/^偏/, "");
      return (DIR_ZH_EN[base] || base) + " wind";
    }
    var base2 = s.replace(/^偏/, "");
    return DIR_ZH_EN[base2] || s;
  }

  // Best-effort phrase translation for CWA's free-text weather descriptions —
  // exact matches first, then a rough substring pass as a fallback so an
  // unrecognized phrase still comes out mostly-English rather than blank.
  var WEATHER_PHRASES = [
    ["晴時多雲短暫雷陣雨", "Fair, cloudy with brief thundershowers"],
    ["多雲時陰短暫雨", "Cloudy, occasionally overcast with brief rain"],
    ["多雲短暫陣雨", "Cloudy with brief showers"],
    ["晴時多雲", "Fair, occasionally cloudy"],
    ["多雲時晴", "Cloudy, occasionally fair"],
    ["晴午後多雲", "Fair, cloudy in the afternoon"],
    ["多雲時陰", "Cloudy, occasionally overcast"],
    ["陰時多雲", "Overcast, occasionally cloudy"],
    ["多雲短暫雨", "Cloudy with brief showers"],
    ["多雲陣雨", "Cloudy with showers"],
    ["陰短暫雨", "Overcast with brief rain"],
    ["雷陣雨", "Thundershowers"],
    ["短暫雨", "Brief rain"],
    ["陣雨", "Showers"],
    ["短暫", "Brief"],
    ["晴天", "Clear"],
    ["多雲", "Cloudy"],
    ["晴", "Clear"],
    ["陰", "Overcast"],
    ["雨", "Rain"]
  ];
  function translateWeather(s) {
    if (!s) return s;
    for (var i = 0; i < WEATHER_PHRASES.length; i++) {
      if (s === WEATHER_PHRASES[i][0]) return WEATHER_PHRASES[i][1];
    }
    var out = s;
    for (var j = 0; j < WEATHER_PHRASES.length; j++) out = out.split(WEATHER_PHRASES[j][0]).join(WEATHER_PHRASES[j][1]);
    return out;
  }
  // The 24 solar terms — a closed set, so unlike the weather phrases this is
  // an exact lookup rather than best-effort.
  var SOLAR_TERMS_EN = {
    "立春": "Start of Spring", "雨水": "Rain Water", "驚蟄": "Awakening of Insects",
    "春分": "Spring Equinox", "清明": "Clear and Bright", "穀雨": "Grain Rain",
    "立夏": "Start of Summer", "小滿": "Grain Full", "芒種": "Grain in Ear",
    "夏至": "Summer Solstice", "小暑": "Minor Heat", "大暑": "Major Heat",
    "立秋": "Start of Autumn", "處暑": "End of Heat", "白露": "White Dew",
    "秋分": "Autumn Equinox", "寒露": "Cold Dew", "霜降": "Frost's Descent",
    "立冬": "Start of Winter", "小雪": "Minor Snow", "大雪": "Major Snow",
    "冬至": "Winter Solstice", "小寒": "Minor Cold", "大寒": "Major Cold"
  };
  function translateSolarTerm(s) {
    if (!s) return s;
    return SOLAR_TERMS_EN[s.trim()] || s;
  }

  // "農曆8月8日" -> "Lunar 8/8" (8th day of the 8th lunar month). Leap months
  // are prefixed 閏 in CWA's data; keep that marker rather than dropping it.
  function translateLunarDate(s) {
    if (!s) return s;
    var m = ("" + s).match(/^農曆(閏?)(\d+)月(\d+)日$/);
    if (!m) return s;
    return "Lunar " + m[2] + "/" + m[3] + (m[1] ? " (leap)" : "");
  }

  var TIDE_ZH_EN = { "滿潮": "High Tide", "乾潮": "Low Tide" };
  var STATION_NAME_EN = { "東河": "Donghe", "都歷": "Duli", "豐濱": "Fengbin" };

  /* ---------- Generic helpers ---------- */
  function fetchJSON(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function showError(elId, msg) {
    var el = document.getElementById(elId);
    if (el) el.innerHTML = '<p class="error-msg">⚠ ' + msg + "</p>";
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) {
      return iso;
    }
  }

  // "9/18, Fri, 00:00" — the weekday matters on a 72h forecast table, where
  // a bare date makes you count which day you're looking at.
  function fmtTimeDow(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) + ", " +
        d.toLocaleDateString("en-US", { weekday: "short" }) + ", " +
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) {
      return iso;
    }
  }

  function fmtHour(iso) {
    try {
      return new Date(iso).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) {
      return iso;
    }
  }

  // Every displayed number rounds to at most one decimal — CWA and
  // Open-Meteo mix 1- and 2-decimal precision, which looked inconsistent
  // across the tables.
  function n1(v) {
    if (v === null || v === undefined || v === "") return v;
    var x = Number(v);
    if (!isFinite(x)) return v;
    return String(Math.round(x * 10) / 10);
  }

  function renderTable(elId, headers, rows) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="loading">No data available</p>';
      return;
    }
    var html = "<table><thead><tr>";
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (row) {
      html += "<tr>" + row.map(function (c) { return "<td>" + (c === undefined || c === null || c === "" ? "—" : c) + "</td>"; }).join("") + "</tr>";
    });
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  // Fixed axis bands so every wave-height chart reads on the same scale
  // rather than auto-fitting to its own data: 0–3m with 0.5m gridlines by
  // default, stepping up to 0–6m then 0–10m only when the swell needs the
  // room (coarser gridlines there so they stay readable). Anything past
  // 10m rounds up to the next even metre so a typhoon swell still fits.
  function waveChartOpts(series, opts) {
    var max = 0;
    series.forEach(function (p) { if (isFinite(p.y) && p.y > max) max = p.y; });
    if (max <= 3) { opts.yMax = 3; opts.gridStep = 0.5; }
    else if (max <= 6) { opts.yMax = 6; opts.gridStep = 1; }
    else if (max <= 10) { opts.yMax = 10; opts.gridStep = 1; }
    else { opts.yMax = Math.ceil(max / 2) * 2; opts.gridStep = 2; }
    opts.yMin = 0;
    opts.area = true;
    opts.unit = "m";
    return opts;
  }

  // Wave period, same fixed-axis idea: 0–10s with 2s gridlines covers almost
  // every east-coast swell, stepping to 0–20s for a long-period groundswell.
  function periodChartOpts(series, opts) {
    var max = 0;
    series.forEach(function (p) { if (isFinite(p.y) && p.y > max) max = p.y; });
    opts.yMin = 0;
    opts.yMax = max <= 10 ? 10 : 20;
    opts.gridStep = max <= 10 ? 2 : 5;
    opts.unit = "s";
    return opts;
  }

  // Wind scale axis is pinned at Beaufort 1–10 and never rescales, so the
  // height of the line means the same thing on every chart and every day.
  // Readings outside that range are clamped by clampScale() rather than
  // being allowed to stretch the axis — a force 11 draws at the 10 line.
  function beaufortChartOpts(opts) {
    opts.yMin = 1;
    opts.yMax = 10;
    opts.gridStep = 1;
    opts.unit = "";
    return opts;
  }

  // Holds a Beaufort reading inside the fixed 1–10 axis. Note this means a
  // dead-calm 0 draws on the floor at 1; the tables and the "Scale" stat
  // still show the true number.
  function clampScale(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return Math.min(10, Math.max(1, n));
  }

  // Beaufort wind scale number (0-12) from a wind speed in m/s — same
  // thresholds as scripts/fetch-data.mjs's beaufort() (kept separate since
  // one runs in Node, the other in the browser).
  function beaufortScale(speedMs) {
    var n = Number(speedMs);
    if (!isFinite(n)) return "";
    var thresholds = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
    for (var i = 0; i < thresholds.length; i++) if (n < thresholds[i]) return i;
    return 12;
  }

  // Wave energy index (kJ), calibrated to read on the same scale as
  // surf-forecast.com's "kJ" figure for Chengkung: E ≈ k·H²·T. Their
  // displayed number doesn't derive cleanly from a single H/T pair (two
  // rows with identical height+period showed different kJ, implying they
  // sum primary+secondary+wind-sea swell), so this is fit empirically —
  // k=15 was the average of six same-swell rows pulled directly from
  // their site on 2026-09-14 (individual fits ranged ~12-17). It won't
  // match exactly hour-to-hour but tracks the same scale and trend.
  function wavePowerKw(heightM, periodS) {
    var h = Number(heightM), t = Number(periodS);
    if (!isFinite(h) || !isFinite(t)) return "";
    return Math.round(15 * h * h * t);
  }

  // Bearing -> 16-point compass. Observations arrive as degrees ("37.0"),
  // which is more precision than anyone reads off a page — "NNE" is the
  // form you actually think in, and it matches how the CWA forecasts and
  // buoy descriptions already label direction elsewhere on the page.
  var COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function degToCompass(deg) {
    var d = Number(deg);
    if (!isFinite(d)) return "";
    return COMPASS_16[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  }

  // Rotates an up-arrow to point in the direction a wave/wind is heading
  // (i.e. compass bearing + 180°, since CWA/Open-Meteo report the
  // direction it's coming FROM, same convention as Windy's arrows).
  function dirArrowHtml(deg) {
    var d = Number(deg);
    if (!isFinite(d)) return "";
    var travel = (d + 180) % 360;
    return ' <span style="display:inline-block;transform:rotate(' + travel + 'deg)">↑</span>';
  }

  /* ---------- Tiny SVG line-chart builder (no external deps) ---------- */
  function lineChartSVG(series, opts) {
    opts = opts || {};
    var w = opts.width || 600, h = opts.height || 160, pad = { t: 14, r: 14, b: 22, l: opts.padLeft || 34 };
    var xs = series.map(function (p) { return p.x; });
    var ys = series.map(function (p) { return p.y; }).filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (!ys.length) return "";
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var yMin = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, ys);
    var yMax = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, ys);
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    // Only breathe room into an auto-fitted axis — a caller that pins both
    // ends (e.g. the fixed 0–3m wave scale) means exactly those bounds.
    if (opts.yMin === undefined || opts.yMax === undefined) {
      var pd = (yMax - yMin) * 0.1;
      yMin -= pd; yMax += pd;
    }
    function sx(x) { return pad.l + (xMax === xMin ? 0 : (x - xMin) / (xMax - xMin)) * (w - pad.l - pad.r); }
    function sy(y) { return h - pad.b - (y - yMin) / (yMax - yMin) * (h - pad.t - pad.b); }

    var linePts = series.filter(function (p) { return p.y !== null && p.y !== undefined && !isNaN(p.y); })
      .map(function (p) { return sx(p.x) + "," + sy(p.y); });
    var pathD = "M" + linePts.join(" L");
    var areaD = pathD + " L" + sx(xMax) + "," + sy(yMin) + " L" + sx(xMin) + "," + sy(yMin) + " Z";

    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" style="display:block;overflow:visible" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';

    // Horizontal reference gridlines at a fixed step, labelled down the left
    // of the y-axis so a value can be read straight off the line.
    if (opts.gridStep) {
      var gStart = Math.ceil(yMin / opts.gridStep - 1e-9) * opts.gridStep;
      for (var gv = gStart; gv <= yMax + 1e-9; gv += opts.gridStep) {
        var gy = sy(gv);
        svg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (w - pad.r) + '" y2="' + gy + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3"></line>';
        svg += '<text x="' + (pad.l - 4) + '" y="' + (gy + 3) + '" font-size="9" fill="var(--text-dim)" text-anchor="end">' + n1(gv) + (opts.unit || "") + "</text>";
      }
    }

    // Vertical gridlines rising from each x tick (tide chart uses these).
    if (opts.xGridlines) {
      (opts.xTicks || []).forEach(function (t) {
        svg += '<line x1="' + sx(t.x) + '" y1="' + pad.t + '" x2="' + sx(t.x) + '" y2="' + (h - pad.b) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3"></line>';
      });
    }

    if (opts.area) svg += '<path d="' + areaD + '" fill="var(--accent)" opacity="0.15" stroke="none"></path>';
    svg += '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"></path>';

    // Bare min/max labels, only when there are no gridlines already labelling the axis.
    if (!opts.gridStep) {
      svg += '<text x="2" y="' + (sy(yMax) + 4) + '" font-size="10" fill="var(--text-dim)">' + n1(yMax) + (opts.unit || "") + '</text>';
      svg += '<text x="2" y="' + (sy(yMin) + 4) + '" font-size="10" fill="var(--text-dim)">' + n1(yMin) + (opts.unit || "") + '</text>';
    }

    // x-axis tick labels (optionally two lines: label + sublabel, e.g. weekday + date)
    (opts.xTicks || []).forEach(function (t) {
      if (t.sublabel) {
        svg += '<text x="' + sx(t.x) + '" y="' + (h - 16) + '" font-size="10" fill="var(--text-dim)" text-anchor="middle">' + t.label + "</text>";
        svg += '<text x="' + sx(t.x) + '" y="' + (h - 5) + '" font-size="9" fill="var(--text-dim)" text-anchor="middle" opacity="0.75">' + t.sublabel + "</text>";
      } else {
        svg += '<text x="' + sx(t.x) + '" y="' + (h - 6) + '" font-size="10" fill="var(--text-dim)" text-anchor="middle">' + t.label + "</text>";
      }
    });

    // marker dots (optionally with a label above and a sublabel, e.g. exact time, below)
    (opts.markers || []).forEach(function (m) {
      svg += '<circle cx="' + sx(m.x) + '" cy="' + sy(m.y) + '" r="3" fill="var(--accent-2)"></circle>';
      if (m.label) svg += '<text x="' + sx(m.x) + '" y="' + (sy(m.y) - 8) + '" font-size="10" fill="var(--text-dim)" text-anchor="middle">' + m.label + "</text>";
      if (m.sublabel) svg += '<text x="' + sx(m.x) + '" y="' + (sy(m.y) + 16) + '" font-size="10" font-weight="600" fill="var(--accent-2)" text-anchor="middle">' + m.sublabel + "</text>";
    });

    // "now" vertical line
    if (opts.nowX !== undefined && opts.nowX >= xMin && opts.nowX <= xMax) {
      svg += '<line x1="' + sx(opts.nowX) + '" y1="' + pad.t + '" x2="' + sx(opts.nowX) + '" y2="' + (h - pad.b) + '" stroke="var(--danger)" stroke-width="1" stroke-dasharray="3,3"></line>';
    }

    svg += "</svg>";
    return svg;
  }

  // Clock-face ticks: the current time first, then every 6-hour boundary
  // (0600/1200/1800/2400) after it, so the time axis always reads the same
  // way regardless of when the page is opened. Midnight shows as 2400.
  // Past about two days, 6-hourly labels collide at phone width, so the
  // step doubles to 12-hourly (1200/2400) and the axis stays legible.
  function sixHourTicks(xMin, xMax) {
    var ticks = [];
    var stepH = (xMax - xMin) / 3600000 > 48 ? 12 : 6;
    var start = Math.max(xMin, Math.min(Date.now(), xMax));
    function label(ms) {
      var d = new Date(ms);
      var hh = d.getHours(), mm = d.getMinutes();
      if (hh === 0 && mm === 0) return "2400"; // read as the end of the previous day
      return (hh < 10 ? "0" : "") + hh + (mm < 10 ? "0" : "") + mm;
    }
    ticks.push({ x: start, label: "now", sublabel: label(start) });

    var t = new Date(start);
    t.setMinutes(0, 0, 0);
    t.setHours((Math.floor(t.getHours() / stepH) + 1) * stepH);
    var prevDay = new Date(start).getDate();
    // The first boundary can fall minutes after "now" — at 12-hourly spacing
    // on a 3-day axis that's a few pixels, and the two labels print on top of
    // each other. Drop a boundary that crowds "now"; the next one is along
    // soon enough.
    var minGapMs = (stepH / 3) * 3600 * 1000;
    while (t.getTime() <= xMax) {
      var day = t.getDate();
      if (t.getTime() - start >= minGapMs) {
        ticks.push({
          x: t.getTime(),
          label: label(t.getTime()),
          sublabel: day !== prevDay ? t.toLocaleDateString("en-US", { weekday: "short" }) : "",
        });
      }
      prevDay = day;
      t = new Date(t.getTime() + stepH * 3600 * 1000);
    }
    return ticks;
  }

  // Same 6-hour clock face, but for charts that look BACKWARDS (observation
  // history). sixHourTicks starts at "now" and walks forward, which on a
  // past-only range collapses to a single tick at the right edge — here we walk
  // the boundaries forward from xMin and label the right edge "now" instead.
  function historySixHourTicks(xMin, xMax) {
    var ticks = [];
    function label(ms) {
      var d = new Date(ms);
      var hh = d.getHours(), mm = d.getMinutes();
      if (hh === 0 && mm === 0) return "2400";
      return (hh < 10 ? "0" : "") + hh + (mm < 10 ? "0" : "") + mm;
    }
    var t = new Date(xMin);
    t.setMinutes(0, 0, 0);
    t.setHours(Math.ceil(t.getHours() / 6) * 6);
    var prevDay = new Date(xMin).getDate();
    // Stop short of the right edge so the boundary tick can't collide with "now".
    while (t.getTime() <= xMax - 45 * 60 * 1000) {
      var day = t.getDate();
      ticks.push({
        x: t.getTime(),
        label: label(t.getTime()),
        sublabel: day !== prevDay ? t.toLocaleDateString("en-US", { weekday: "short" }) : "",
      });
      prevDay = day;
      t = new Date(t.getTime() + 6 * 3600 * 1000);
    }
    ticks.push({ x: xMax, label: "now", sublabel: label(xMax) });
    return ticks;
  }

  /* --- Township forecast (F-D0047-039) ---
     Real schema: records.locations[0].location[0].WeatherElement[]
     = { ElementName (Chinese), Time: [{ StartTime, EndTime, ElementValue }] }
     where ElementValue is an ARRAY of one object: [{ Temperature: "28" }]. */
  function renderTownship(data) {
    try {
      var loc = data.records.locations[0].location[0];
      var elements = {};
      loc.WeatherElement.forEach(function (we) { elements[we.ElementName] = we.Time; });
      var times = (elements["天氣現象"] || elements["平均溫度"] || []).slice(0, 8);
      function val(name, field, unit) {
        return function (i) {
          var arr = elements[name];
          if (!arr || !arr[i] || !arr[i].ElementValue) return "";
          var ev = arr[i].ElementValue;
          var obj = Array.isArray(ev) ? ev[0] : ev;
          var v = obj && obj[field];
          return v === undefined || v === "" ? "" : v + (unit || "");
        };
      }
      var wxRaw = val("天氣現象", "Weather");
      var temp = val("平均溫度", "Temperature", "°C");
      var pop = val("12小時降雨機率", "ProbabilityOfPrecipitation", "%");
      var wind = val("風速", "WindSpeed", " m/s");
      var rows = times.map(function (t, i) {
        var wx = wxRaw(i);
        return [fmtTime(t.StartTime), wx ? translateWeather(wx) : "", temp(i), pop(i), wind(i)];
      });
      renderTable("townshipTable", ["Time", "Weather", "Temp", "Rain %", "Wind"], rows);
    } catch (e) {
      showError("townshipTable", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Coastal 3-day forecast (F-D0047-095) ---
     Real schema: records.locations[0].location[0].WeatherElement[]
     = { ElementName (Chinese), Time: [{ DataTime, ElementValue: {...} }] } */
  function renderCoastal(data) {
    try {
      var loc = data.records.locations[0].location[0];
      var elements = {};
      loc.WeatherElement.forEach(function (we) { elements[we.ElementName] = we.Time; });
      // CWA sends 33 three-hourly points (96h — the "3-day" dataset reliably
      // carries a fourth). Cap the chart and table at 72h ahead; the leading
      // point or two sit just behind "now", which gives the curve some
      // run-up rather than starting it mid-air.
      var horizon = Date.now() + 72 * 60 * 60 * 1000;
      var times = (elements["浪高"] || elements["風速"] || []).filter(function (t) {
        return new Date(t.DataTime).getTime() <= horizon;
      });
      function val(name, field) {
        return function (i) {
          var arr = elements[name];
          if (!arr || !arr[i] || !arr[i].ElementValue) return "";
          var ev = arr[i].ElementValue;
          var obj = Array.isArray(ev) ? ev[0] : ev;
          var v = obj && obj[field];
          return v === undefined ? "" : v;
        };
      }
      var waveHeight = val("浪高", "WaveHeight");
      var wavePeriod = val("浪週期", "WavePeriod");
      var windSpeed = val("風速", "WindSpeed");
      var windDirRaw = val("風向", "WindDirection");
      var waveDirRaw = val("浪向", "WaveDirection");
      var rows = times.map(function (t, i) {
        var wd = windDirRaw(i), vd = waveDirRaw(i);
        return [
          fmtTimeDow(t.DataTime), n1(waveHeight(i)), n1(wavePeriod(i)),
          wavePowerKw(waveHeight(i), wavePeriod(i)),
          vd ? translateDirText(vd) : "",
          beaufortScale(windSpeed(i)),
          wd ? translateDirText(wd) : "",
        ];
      });
      renderTable("coastalTable", ["Time", "Wave Ht (m)", "Wave Period (s)", "Energy (kJ)", "Wave Dir", "Wind Scale", "Wind Dir"], rows);

      // Chart: wave height (with size gridlines) + wind scale, stacked
      var chartEl = document.getElementById("coastalChart");
      if (chartEl && times.length) {
        var xs = times.map(function (t) { return new Date(t.DataTime).getTime(); });
        var xMin = xs[0], xMax = xs[xs.length - 1];
        var xTicks = sixHourTicks(xMin, xMax);
        var waveSeries = times.map(function (t, i) { return { x: xs[i], y: Number(waveHeight(i)) }; });
        var windScaleSeries = times.map(function (t, i) { return { x: xs[i], y: clampScale(beaufortScale(windSpeed(i))) }; });
        var waveSVG = lineChartSVG(waveSeries, waveChartOpts(waveSeries, { width: 640, height: 190, xTicks: xTicks }));
        var windSVG = lineChartSVG(windScaleSeries, beaufortChartOpts({ width: 640, height: 175, padLeft: 26, xTicks: xTicks }));
        chartEl.innerHTML =
          '<div class="chart-label">Wave Height</div>' + (waveSVG || '<p class="loading">No data</p>') +
          '<div class="chart-label">Wind Scale (Beaufort)</div>' + (windSVG || '<p class="loading">No data</p>');
      }
    } catch (e) {
      showError("coastalChart", "Couldn't parse this data (" + e.message + ")");
      showError("coastalTable", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Tide forecast (F-A0021-001) — line chart with day pager + trimmed table --- */
  var tideDayIndex = 0;
  var tideDaysCache = null; // array of {date, points:[{t:Date,h:number}], extrema:[...]}

  function interpolateTide(points, sampleTimes) {
    return sampleTimes.map(function (t) {
      if (t <= points[0].t) return points[0].h;
      if (t >= points[points.length - 1].t) return points[points.length - 1].h;
      for (var i = 0; i < points.length - 1; i++) {
        if (t >= points[i].t && t <= points[i + 1].t) {
          var frac = (t - points[i].t) / (points[i + 1].t - points[i].t);
          var mu = (1 - Math.cos(frac * Math.PI)) / 2;
          return points[i].h * (1 - mu) + points[i + 1].h * mu;
        }
      }
      return points[points.length - 1].h;
    });
  }

  function renderTideDay(idx) {
    var chartEl = document.getElementById("tideChart");
    var headingEl = document.getElementById("tideDayHeading");
    var prevBtn = document.getElementById("tidePrevBtn");
    var nextBtn = document.getElementById("tideNextBtn");
    if (!tideDaysCache || !tideDaysCache.length) return;
    idx = Math.max(0, Math.min(idx, tideDaysCache.length - 1));
    tideDayIndex = idx;
    var day = tideDaysCache[idx];
    var allPoints = tideDaysCache.reduce(function (acc, d) { return acc.concat(d.points); }, []).sort(function (a, b) { return a.t - b.t; });

    var dayStart = new Date(day.date + "T00:00:00+08:00").getTime();
    var dayEnd = dayStart + 24 * 60 * 60 * 1000;
    var samples = [];
    for (var t = dayStart; t <= dayEnd; t += 15 * 60 * 1000) samples.push(t);
    var heights = interpolateTide(allPoints, samples);
    var series = samples.map(function (t, i) { return { x: t, y: heights[i] }; });

    var markers = day.extrema.map(function (p) {
      return {
        x: p.t, y: p.h,
        label: p.tideEn + " " + Math.round(p.h) + "cm",
        sublabel: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      };
    });
    // Tide axis is pinned and never rescales, so the curve's shape means the
    // same thing every day. -100..+150cm (relative to TWVD2001) comfortably
    // contains Donghe's astronomical range — the largest spring tides in the
    // CWA data run about -45 to +100cm.
    var xTicks = [6, 12, 18, 24].map(function (hr) {
      return { x: dayStart + hr * 3600000, label: (hr === 24 ? "24" : "0" + hr).slice(-2) + "00" };
    });
    var now = Date.now();
    var svg = lineChartSVG(series, {
      width: 640, height: 200, area: true, unit: "cm",
      yMin: -100, yMax: 150, gridStep: 50, padLeft: 46, xGridlines: true,
      markers: markers, xTicks: xTicks,
      nowX: (now >= dayStart && now <= dayEnd) ? now : undefined,
    });
    if (chartEl) chartEl.innerHTML = svg || '<p class="loading">No tide curve available</p>';

    // Dawn surf window. The chart shows the shape of the day; this states the
    // two numbers you actually plan around, interpolated off the same curve
    // rather than read off the nearest high/low.
    var windowEl = document.getElementById("tideWindow");
    if (windowEl) {
      var wt = interpolateTide(allPoints, [dayStart + 6 * 3600000, dayStart + 8 * 3600000]);
      var h6 = Math.round(wt[0]), h8 = Math.round(wt[1]);
      var trend = h8 > h6 ? "rising" : h8 < h6 ? "falling" : "slack";
      windowEl.innerHTML =
        '<span class="tide-window-label">Surf window</span> ' +
        "06:00 " + h6 + "cm → 08:00 " + h8 + "cm " +
        '<span class="tide-window-trend">(' + trend + ")</span>";
    }

    if (headingEl) {
      var label = idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : new Date(day.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      headingEl.textContent = label + " — " + new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx === tideDaysCache.length - 1;

    // Sun/moon times, the astronomical calendar and the moon phase all
    // follow the day being viewed, not just the tide curve.
    astroDayKey = day.date;
    renderAstronomyDay();
    renderMoonWidget(idx === 0 ? new Date() : new Date(day.date + "T12:00:00+08:00"));
  }

  // Horizontal drag/swipe on the tide chart pages between days, alongside
  // the ‹ › buttons. Pointer events cover both touch and mouse; the chart
  // is redrawn on release rather than tracking the finger, which keeps it
  // cheap and avoids fighting vertical page scrolling.
  function enableTideSwipe() {
    var wrap = document.querySelector(".tide-chart-wrap");
    if (!wrap || wrap.dataset.swipeBound) return;
    wrap.dataset.swipeBound = "1";
    var startX = null, startY = null;
    wrap.addEventListener("pointerdown", function (ev) { startX = ev.clientX; startY = ev.clientY; });
    wrap.addEventListener("pointerup", function (ev) {
      if (startX === null) return;
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      startX = startY = null;
      // Ignore mostly-vertical drags (page scroll) and taps.
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      renderTideDay(tideDayIndex + (dx < 0 ? 1 : -1));
    });
    wrap.addEventListener("pointercancel", function () { startX = startY = null; });
  }

  function renderTide(data) {
    try {
      var tf = (data.records.TideForecasts || data.records.locations)[0];
      var loc = tf.Location || tf;
      var daily = loc.TimePeriods.Daily || loc.TimePeriods;

      tideDaysCache = daily.map(function (day) {
        var extrema = (day.Time || []).map(function (t) {
          var h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL);
          return { t: new Date(t.DateTime).getTime(), h: Number(h), tide: t.Tide, tideEn: TIDE_ZH_EN[t.Tide] || t.Tide };
        });
        return { date: day.Date, points: extrema.map(function (e) { return { t: e.t, h: e.h }; }), extrema: extrema };
      }).slice(0, 3);

      if (!tideDaysCache.length) throw new Error("no days in response");
      renderTideDay(0);
      enableTideSwipe();
    } catch (e) {
      showError("tideChart", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Moon phase widget (top-right of the tide chart) ---
     Computed locally from the date — no API needed. Reference: the synodic
     month (new moon to new moon) is 29.530588853 days; 2000-01-06 18:14 UTC
     was a new moon. */
  var MOON_ICONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  function moonPhaseInfo(date) {
    var synodic = 29.530588853;
    var newMoonRef = Date.UTC(2000, 0, 6, 18, 14, 0);
    var days = (date.getTime() - newMoonRef) / 86400000;
    var phase = (days % synodic) / synodic;
    if (phase < 0) phase += 1;
    var waxing = phase < 0.5;
    var daysToFull = (((0.5 - phase) % 1 + 1) % 1) * synodic;
    var daysToNew = (((1 - phase) % 1 + 1) % 1) * synodic;
    if (daysToNew < 0.5) daysToNew = synodic; // just past new — show the *next* one, not "today"
    return {
      phase: phase,
      waxing: waxing,
      icon: MOON_ICONS[Math.round(phase * 8) % 8],
      nextFull: new Date(date.getTime() + daysToFull * 86400000),
      nextNew: new Date(date.getTime() + daysToNew * 86400000),
    };
  }

  function renderMoonWidget(date) {
    var el = document.getElementById("moonWidget");
    if (!el) return;
    var info = moonPhaseInfo(date || new Date());
    var arrow = info.waxing ? "▲" : "▼";
    var nextLabel = info.waxing
      ? "Full " + info.nextFull.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "New " + info.nextNew.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    el.innerHTML =
      '<div class="moon-icon">' + info.icon + '<span class="moon-arrow">' + arrow + "</span></div>" +
      '<div class="moon-next">' + nextLabel + "</div>";
  }

  /* --- Station observations (O-A0001-001), 16-hour rolling history from stations-history.json ---
     One chart card per station, side by side (same grid pattern as buoy cards).
     WindDirection is a compass degree (e.g. "44.0"), not Chinese text — no translation needed. */
  function renderStationsHistory(history) {
    var container = document.getElementById("stationContainer");
    if (!container) return;
    try {
      var ids = Object.keys(history).sort();
      if (!ids.length) {
        container.innerHTML = '<p class="loading">No station data available</p>';
        return;
      }
      var html = "";
      ids.forEach(function (id) {
        var s = history[id];
        var name = STATION_NAME_EN[s.name] || s.name || id;
        var readings = s.readings || [];
        var latest = readings[readings.length - 1] || {};
        var series = readings.map(function (r) { return { x: new Date(r.DateTime).getTime(), y: clampScale(r.WindScale) }; });
        var xMin = series.length ? series[0].x : Date.now();
        var xMax = series.length ? series[series.length - 1].x : Date.now();
        var xTicks = historySixHourTicks(xMin, xMax);
        var svg = lineChartSVG(series, beaufortChartOpts({
          width: 600, height: 175, area: true, padLeft: 26, xTicks: xTicks,
        }));

        html += '<div class="buoy-card">';
        html += "<h3>" + name + " <span class=\"en\">(" + id + ")</span></h3>";
        var wl = stationWindLine(id, s);
        if (wl) html += '<p class="buoy-trend">' + wl.text + "</p>";
        html += '<div class="buoy-chart-label">Wind Scale (Beaufort) — last 16h</div>' + (svg || '<p class="loading">Still collecting data (populates hourly)</p>');
        html += '<div class="buoy-stats">';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Wind Speed</span><span class="buoy-stat-value">' + (latest.WindSpeed !== undefined ? n1(latest.WindSpeed) : "—") + ' m/s</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Direction</span><span class="buoy-stat-value">' + (latest.WindDirection !== undefined ? degToCompass(latest.WindDirection) + dirArrowHtml(latest.WindDirection) : "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Scale</span><span class="buoy-stat-value">' + (latest.WindScale !== undefined ? latest.WindScale : "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">As of</span><span class="buoy-stat-value">' + fmtTime(latest.DateTime) + '</span></div>';
        html += "</div>";

        // Full 16-hour reading list under the chart (same pattern as the buoy cards).
        var stationRows = readings.slice().reverse().map(function (r) {
          return [
            fmtHour(r.DateTime),
            n1(r.WindSpeed),
            r.WindDirection !== undefined ? degToCompass(r.WindDirection) + dirArrowHtml(r.WindDirection) : "",
            r.WindScale,
          ];
        }).map(function (row) {
          return "<tr>" + row.map(function (c) { return "<td>" + (c === undefined || c === null || c === "" ? "—" : c) + "</td>"; }).join("") + "</tr>";
        }).join("");
        html += '<div class="buoy-chart-label">Last 16 hours</div>';
        html += '<div class="buoy-history-table"><table><thead><tr><th>Time</th><th>Speed(m/s)</th><th>Dir</th><th>Scale</th></tr></thead><tbody>' + stationRows + "</tbody></table></div>";
        html += "</div>";
      });
      container.innerHTML = html;
    } catch (e) {
      showError("stationContainer", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Buoy / sea state (O-B0075-001), multiple stations, last-24h charts --- */
  function renderBuoy(data) {
    var container = document.getElementById("buoyContainer");
    if (!container) return;
    try {
      var stations = (data.records && data.records.Stations) || [];
      if (!stations.length) {
        container.innerHTML = '<p class="loading">No buoy data available</p>';
        return;
      }
      var html = "";
      stations.forEach(function (st) {
        var readings = st.Readings || [];
        var latest = readings[readings.length - 1] || {};
        var heightSeries = readings.map(function (r) { return { x: new Date(r.DateTime).getTime(), y: Number(r.WaveHeight) }; });
        var periodSeries = readings.map(function (r) { return { x: new Date(r.DateTime).getTime(), y: Number(r.WavePeriod) }; });
        var xMin = heightSeries.length ? heightSeries[0].x : Date.now();
        var xMax = heightSeries.length ? heightSeries[heightSeries.length - 1].x : Date.now();
        var xTicks = historySixHourTicks(xMin, xMax);
        var heightSVG = lineChartSVG(heightSeries, waveChartOpts(heightSeries, { width: 600, height: 130, xTicks: xTicks }));
        var periodSVG = lineChartSVG(periodSeries, periodChartOpts(periodSeries, { width: 600, height: 110, xTicks: xTicks }));
        var nv = function (v) { return (v === undefined || v === null || v === "" || v === "None") ? "" : v; };

        html += '<div class="buoy-card">';
        html += "<h3>" + st.Label + " <span class=\"en\">(" + st.StationID + ")</span></h3>";
        var tr = buoyTrend(st);
        if (tr) html += '<p class="buoy-trend">' + buoyTrendText(tr) + "</p>";
        html += '<div class="buoy-chart-label">Wave Height — last 24h</div>' + (heightSVG || '<p class="loading">No data</p>');
        html += '<div class="buoy-chart-label">Wave Period — last 24h</div>' + (periodSVG || '<p class="loading">No data</p>');
        html += '<div class="buoy-stats">';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Wave Height</span><span class="buoy-stat-value">' + (n1(nv(latest.WaveHeight)) || "—") + ' m</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Period</span><span class="buoy-stat-value">' + (n1(nv(latest.WavePeriod)) || "—") + ' s</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Energy</span><span class="buoy-stat-value">' + (wavePowerKw(latest.WaveHeight, latest.WavePeriod) || "—") + ' kJ</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Direction</span><span class="buoy-stat-value">' + (nv(latest.WaveDirectionDescription) || "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Sea Temp</span><span class="buoy-stat-value">' + (n1(nv(latest.SeaTemperature)) || "—") + ' °C</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">As of</span><span class="buoy-stat-value">' + fmtTime(latest.DateTime) + '</span></div>';
        html += "</div>";

        var cutoff8h = Date.now() - 8 * 60 * 60 * 1000;
        var recent = readings.filter(function (r) { return new Date(r.DateTime).getTime() >= cutoff8h; }).slice().reverse();
        var recentRows = recent.map(function (r) {
          return [fmtHour(r.DateTime), n1(nv(r.WaveHeight)), n1(nv(r.WavePeriod)), wavePowerKw(r.WaveHeight, r.WavePeriod), nv(r.WaveDirectionDescription), n1(nv(r.SeaTemperature))];
        }).map(function (row) {
          return "<tr>" + row.map(function (c) { return "<td>" + (c === undefined || c === null || c === "" ? "—" : c) + "</td>"; }).join("") + "</tr>";
        }).join("");
        html += '<div class="buoy-chart-label">Last 8 hours</div>';
        html += '<div class="buoy-history-table"><table><thead><tr><th>Time</th><th>Ht(m)</th><th>Per(s)</th><th>Energy(kJ)</th><th>Dir</th><th>Temp(°C)</th></tr></thead><tbody>' + recentRows + "</tbody></table></div>";
        html += "</div>";
      });
      container.innerHTML = html;
    } catch (e) {
      showError("buoyContainer", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Independent wave forecast (Open-Meteo Marine API / Météo-France MFWAM) ---
     Timestamps come back as e.g. "2026-09-14T00:00" with NO timezone
     suffix, already in Asia/Taipei local time (per the request param) —
     append the +08:00 offset explicitly so it parses correctly regardless
     of the viewer's own timezone. */
  function renderOpenWave(data) {
    try {
      var h = data.hourly;
      if (!h || !h.time || !h.time.length) throw new Error("no data returned");
      var toDate = function (t) { return new Date(t + ":00+08:00"); };
      var series = h.time.map(function (t, i) { return { x: toDate(t).getTime(), y: Number(h.wave_height[i]) }; });
      var xMin = series[0].x;
      var xTicks = [0, 1, 2, 3, 4].map(function (d) {
        var x = xMin + d * 86400000;
        var dt = new Date(x);
        return {
          x: x,
          label: dt.toLocaleDateString("en-US", { weekday: "short" }),
          sublabel: dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
        };
      });
      var svg = lineChartSVG(series, waveChartOpts(series, { width: 640, height: 190, xTicks: xTicks }));
      var chartEl = document.getElementById("openWaveChart");
      if (chartEl) chartEl.innerHTML = svg || '<p class="loading">No wave curve available</p>';

      var rows = [];
      h.time.forEach(function (t, i) {
        if (toDate(t).getHours() % 6 === 0) {
          rows.push([
            fmtTime(toDate(t).toISOString()),
            n1(h.wave_height[i]),
            n1(h.wave_period[i]),
            wavePowerKw(h.wave_height[i], h.wave_period[i]),
            h.wave_direction[i] !== undefined ? degToCompass(h.wave_direction[i]) + dirArrowHtml(h.wave_direction[i]) : "",
            n1(h.swell_wave_height[i]),
            n1(h.swell_wave_period[i]),
          ]);
        }
      });
      renderTable("openWaveTable", ["Time", "Wave Ht (m)", "Period (s)", "Energy (kJ)", "Direction", "Swell Ht (m)", "Swell Period (s)"], rows.slice(0, 20));
    } catch (e) {
      showError("openWaveChart", "Couldn't parse this data (" + e.message + ")");
      showError("openWaveTable", "Couldn't parse this data (" + e.message + ")");
    }
  }

  // Each data file is fetched once and shared: the sections, the Right now
  // card and the summaries all read the same copy.
  var dataCache = {};
  function getData(name) {
    if (!dataCache[name]) dataCache[name] = fetchJSON("data/" + name + ".json");
    return dataCache[name];
  }

  function loadAll() {
    getData("coastal").then(renderCoastal).catch(function (e) { showError("coastalTable", "Couldn't load this data (" + e.message + ")"); });
    getData("tide").then(renderTide).catch(function (e) { showError("tideChart", "Couldn't load this data (" + e.message + ")"); });
    getData("stations-history").then(renderStationsHistory).catch(function (e) { showError("stationContainer", "Couldn't load this data (" + e.message + ")"); });
    getData("buoy").then(renderBuoy).catch(function (e) { showError("buoyContainer", "Couldn't load this data (" + e.message + ")"); });
    getData("openwave").then(renderOpenWave).catch(function (e) { showError("openWaveChart", "Couldn't load this data (" + e.message + ")"); });

    getData("typhoon").then(renderTyphoon).catch(function () { /* no feed, panel stays hidden */ });

    getData("astronomy").then(renderAstronomy).catch(function () { /* section stays empty */ });

    renderSummaries();

    fetchJSON("data/update-log.json").then(function (log) {
      updateLog = log;
      renderAllUpdateLines();
    }).catch(function () { /* no update lines until the log exists */ });

    fetchJSON("data/meta.json")
      .then(renderFreshness)
      .catch(function () { renderFreshness(null); });

    // Phase 3: the dashboard only gets the summary lines and the tide note;
    // the charts are on accuracy.html. Both files are small current-tier ones.
    Promise.all([getData("phase3-stats"), getData("phase3-live")])
      .then(function (r) { renderForecastCheckCard(r[0], r[1]); renderTideOffsetNote(r[1]); })
      .catch(function () {
        var el = document.getElementById("fcCard");
        if (el) el.innerHTML = '<li class="fc-card-empty">Forecast Check data isn\'t available right now.</li>';
      });
  }

  /* ---------- Forecast Check summary card (Phase 3) ----------
     Three generated lines — waves, wind, tide — each linking to its tab on
     accuracy.html. Same thresholds as that page: a source needs 72 matched
     hours to be called the best, and wave scores use forecasts at the buoy's
     own position once there are enough of them, the Donghe point until then. */
  var FC_NAMES = { cwa_coastal_donghe: "CWA coastal", open_meteo: "Open-Meteo", ecmwf: "ECMWF", gfs_wave: "GFS-Wave", gfs_wind: "GFS", cwa_township_wind: "CWA township" };
  function renderForecastCheckCard(stats, live) {
    var el = document.getElementById("fcCard");
    if (!el) return;
    var w = (stats.windows || {})["7d"] || {}, lines = [];
    var waves = (w.waves || []).filter(function (x) { return x.buoy === "46761F" && x.field === "height" && x.lead === 24; });
    var point = waves.some(function (x) { return x.point === "buoy" && x.n >= 72; }) ? "buoy" : "donghe";
    var cands = waves.filter(function (x) { return x.point === point && x.n >= 72 && FC_NAMES[x.source]; }).sort(function (a, b) { return a.mae - b.mae; });
    if (cands.length) {
      lines.push('<li><a href="accuracy.html#waves"><b>Waves:</b></a> ' + FC_NAMES[cands[0].source] + " has been closest this week, typically within <b>" +
        cands[0].mae.toFixed(2) + " m</b> of the Chenggong buoy (forecasts made 24 h ahead" + (point === "donghe" ? ", for Donghe" : "") + ").</li>");
    }
    var dir = (w.windDirection || []).filter(function (x) { return x.lead === 24 && x.n >= 24 && FC_NAMES[x.source]; }).sort(function (a, b) { return b.pct - a.pct; });
    if (dir.length) {
      lines.push('<li><a href="accuracy.html#wind"><b>Wind:</b></a> ' + FC_NAMES[dir[0].source] + " made the best offshore/onshore call at Donghe this week — right <b>" + dir[0].pct + "%</b> of the time, 24 h ahead.</li>");
    }
    var off = tideOffset24h(live);
    if (off) {
      lines.push('<li><a href="accuracy.html#tide"><b>Tide:</b></a> over the last 24 h the sea at Chenggong ran <b>' + signedCm(off.avg) + "</b> against CWA's prediction.</li>");
    }
    el.innerHTML = lines.length ? lines.join("") : '<li class="fc-card-empty">Not enough matched data yet — check back after a few days of logging.</li>';
    // The collapsed bar: the same three facts, short.
    var bits = [];
    if (cands.length) bits.push(FC_NAMES[cands[0].source] + " closest for waves this week (" + cands[0].mae.toFixed(2) + " m)");
    if (dir.length) bits.push(FC_NAMES[dir[0].source] + " best offshore/onshore call (" + dir[0].pct + "%)");
    setSummary("accuracy", bits.length ? bits.join(" · ") : "How the forecasts compared with what was measured");
  }
  function signedCm(v) { var r = Math.round(v); return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r) + " cm"; }
  function tideOffset24h(live) {
    var now = Date.now(), rows = ((live && live.tide) || []).filter(function (r) { return r[0] > now - 24 * 3600000 && r[1] !== null && r[2] !== null; });
    if (rows.length < 6) return null;
    var pr = rows.filter(function (r) { return r[3] !== null && r[3] !== undefined; });
    return {
      avg: rows.reduce(function (a, r) { return a + (r[1] - r[2]); }, 0) / rows.length,
      pressure: pr.length ? pr.reduce(function (a, r) { return a + r[3]; }, 0) / pr.length : null,
    };
  }

  /* ---------- Tide offset note (under the Donghe tide chart) ----------
     The prediction is astronomy only; the real sea also carries seasonal
     level, wind, swell and air pressure. This states how far the Chenggong
     gauge has run from CWA's prediction over the last 24h, so today's tides
     can be read with that added. Pressure is used only to say whether it
     explains the gap (~1 cm of sea level per hPa below normal). */
  function renderTideOffsetNote(live) {
    var el = document.getElementById("tideOffsetNote");
    var off = tideOffset24h(live);
    if (!el || !off) return;
    var a = Math.round(off.avg), txt;
    if (Math.abs(a) < 3) txt = "Chenggong tide gauge, last 24 h: the sea has been running close to the prediction.";
    else {
      txt = "Chenggong tide gauge, last 24 h: the sea has been running <b>" + signedCm(a) + "</b> " + (a > 0 ? "above" : "below") +
        " CWA's prediction — expect tides about that much " + (a > 0 ? "higher" : "lower") + " than shown.";
      if (off.pressure !== null) {
        var effect = -(off.pressure - 1013.25);
        if (effect * a < 0 && Math.abs(effect) >= 3) txt += " Air pressure is " + (effect < 0 ? "high" : "low") + " (" + Math.round(off.pressure) + " hPa), so it isn't the cause — likely wind and swell.";
        else if (effect * a > 0 && Math.abs(effect) >= Math.abs(a) * 0.6) txt += " Low air pressure (" + Math.round(off.pressure) + " hPa) explains most of it.";
      }
    }
    el.innerHTML = txt + ' <a href="accuracy.html#tide">Tide check →</a>';
    el.hidden = false;
  }

  /* ---------- Typhoon News ----------
     Shown only when JTWC has an active Western Pacific system or invest;
     the whole panel is hidden otherwise, so a quiet season costs nothing.

     Severe-weather information carries a real hazard the rest of this page
     doesn't: if our hourly fetch breaks we could keep showing a storm that
     has dissipated, or a warning that has been superseded. JTWC warns every
     6 hours, so anything older than 12h means two missed cycles — that gets
     an explicit stale notice rather than being presented as current. */
  var TYPHOON_STALE_HOURS = 12;

  function escapeHtml(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function swellDesc(p) {
    return n1(p.heightM) + "m, " + n1(p.periodS) + "s from " + degToCompass(p.dirDeg);
  }

  function swellSentence(s) {
    var sw = s.swell;
    if (!sw) return "";
    // Pre-2026-09-29 files carried a bare arrival with no status.
    if (!sw.status && sw.targetTime) sw = { status: "incoming", arrival: sw, peak: sw.peak };
    var peakTxt = sw.peak && (!sw.arrival || sw.peak.targetTime !== sw.arrival.targetTime)
      ? ", peaking at <strong>" + swellDesc(sw.peak) + "</strong> around " + fmtDonghe(sw.peak.targetTime) : "";
    if (sw.status === "incoming") {
      return "Swell expected to arrive <strong>" + fmtDonghe(sw.arrival.targetTime) + "</strong> (" +
        swellDesc(sw.arrival) + ")" + peakTxt;
    }
    if (sw.status === "arriving") {
      return "Swell <strong>arriving now</strong> (" + swellDesc(sw.arrival) + ")" + peakTxt;
    }
    if (sw.status === "in-water") {
      if (sw.easing) {
        return "Swell arrived " + fmtDonghe(sw.arrival.targetTime) + " and is now <strong>easing</strong> — " +
          swellDesc(sw.now) + " now";
      }
      return "Swell in the water since " + fmtDonghe(sw.arrival.targetTime) + " — " + swellDesc(sw.now) +
        " now" + peakTxt;
    }
    var until = sw.windowEnd ? " through " + fmtDonghe(sw.windowEnd).replace(/,\s*\d{2}:\d{2}$/, "") : "";
    // Donghe faces east; a storm to the west or southwest is behind the island.
    var b = s.spot && s.spot.bearingDeg;
    var why = (typeof b === "number" && b >= 190 && b <= 340) ? " — the storm is west of Taiwan, so the island blocks it" : "";
    // A swell another storm lines up with better is credited there (see
    // creditSwellToBestMatch in scripts/fetch-data.mjs).
    var credit = sw.creditedTo ? " — the swell on its way lines up better with " + escapeHtml(sw.creditedTo) : "";
    return "No meaningful swell from " + escapeHtml(s.name || s.id) + " expected at Donghe" + until + why + credit +
      ' <span class="typhoon-lag">(Open-Meteo, 5-day window)</span>';
  }

  /* The collapsed Typhoon bar's one line. Counts only storms that are active
     by our definition — not retired by the retirement rule (recurved north
     of 28N, heading away, no swell left) — and says whether each is
     expected to send swell, and when. Formation alerts and invests are a
     short tail. */
  function typhoonSwellPhrase(s) {
    var sw = s.swell;
    if (!sw) return "swell outlook not available";
    if (!sw.status && sw.targetTime) sw = { status: "incoming", arrival: sw };
    var day = function (iso) { return fmtDonghe(iso).replace(/:\d{2}$/, ":00"); };
    if (sw.status === "incoming") return "expected to send swell arriving <b>" + day(sw.arrival.targetTime) + "</b>";
    if (sw.status === "arriving") return "its swell is <b>arriving now</b>";
    if (sw.status === "in-water") return sw.easing ? "its swell is in the water and easing" : "its swell is in the water" + (sw.peak ? ", peaking around " + day(sw.peak.targetTime) : "");
    return "not expected to send swell to Donghe in the next 5 days";
  }
  function typhoonSummary(active, retired, data) {
    var alerts = ((data && data.alerts) || []).filter(function (a) { return !(a.alertId && !/^WTPN/i.test(a.alertId)) && !(typeof a.lon === "number" && a.lon < 100); });
    var ids = {};
    alerts.forEach(function (a) { ids[a.investId || a.alertId] = 1; });
    ((data && data.invests) || []).forEach(function (iv) { ids[iv.id || Math.random()] = 1; });
    var watched = Object.keys(ids).length;
    var tail = watched ? " · " + watched + " area" + (watched > 1 ? "s" : "") + " being watched" : "";
    if (!active.length) {
      return "No active storms that could send swell" + (retired.length ? " (" + retired.map(function (s) { return escapeHtml(s.name || s.id); }).join(", ") + " heading away)" : "") + tail + ".";
    }
    var head = active.length + " active storm" + (active.length > 1 ? "s" : "") + " in the W Pacific";
    var parts = active.map(function (s) {
      // Unnamed systems carry JTWC's spelled-out number as a name ("Twentyeight") — leave it off.
      var realName = s.name && s.name !== s.id && !/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)/i.test(s.name);
      var label = (s.designation ? s.designation + " " : "") + escapeHtml(s.id) + (realName ? " (" + escapeHtml(s.name) + ")" : "");
      return label + ": " + typhoonSwellPhrase(s);
    });
    return head + ". " + parts.join(". ") + "." + tail;
  }

  function renderTyphoon(data) {
    var panel = document.getElementById("typhoon");
    var body = document.getElementById("typhoonBody");
    if (!panel || !body) return;

    var systems = (data && data.systems) || [];
    var invests = (data && data.invests) || [];
    if (!systems.length && !invests.length) { panel.hidden = true; return; }

    // Staleness is judged on the newest JTWC issuance, not on our fetch time:
    // a successful fetch of a feed nobody has updated is still stale news.
    var newest = 0;
    systems.forEach(function (s) {
      var t = s.issuedAt ? new Date(s.issuedAt).getTime() : 0;
      if (t > newest) newest = t;
    });
    var ageH = newest ? (Date.now() - newest) / 3600000 : null;

    var html = "";
    if (ageH !== null && ageH >= TYPHOON_STALE_HOURS) {
      html += '<p class="typhoon-stale">⚠ Last JTWC warning was ' + Math.round(ageH) +
        "h ago. JTWC issues every 6h, so this may be out of date — check the links below.</p>";
    }

    // Storms past their swell-making life (recurved north of 28N, heading
    // away, no swell still to come — see retirementState in the fetch
    // script) shrink to one line at the end instead of a full card.
    var retired = systems.filter(function (s) { return s.retired; });
    systems = systems.filter(function (s) { return !s.retired; });
    setSummary("typhoon", typhoonSummary(systems, retired, data));

    systems.forEach(function (s) {
      html += '<div class="typhoon-card">';
      html += "<h3>" + escapeHtml(s.headline) + "</h3>";
      var meta = [];
      if (s.warningNumber) meta.push("Warning #" + escapeHtml(s.warningNumber));
      if (s.issuedAt) meta.push("issued " + escapeHtml(fmtDonghe(s.issuedAt)));
      else if (s.issuedZ) meta.push("issued " + escapeHtml(s.issuedZ));
      if (meta.length) html += '<p class="typhoon-meta">' + meta.join(" · ") + "</p>";

      // Hard numbers, straight from the warning text — no interpretation.
      var facts = [];
      if (s.maxWindKt) facts.push("<strong>" + s.maxWindKt + " kt</strong> max" + (s.gustKt ? ", gusts " + s.gustKt + " kt" : ""));
      if (s.pressureMb) facts.push(s.pressureMb + " mb");
      if (s.seasFt) facts.push("seas <strong>" + s.seasFt + " ft</strong>");
      if (s.movingKt !== undefined && s.movingToward !== undefined) {
        facts.push("moving " + degToCompass(s.movingToward) + " at " + s.movingKt + " kt");
      }
      if (facts.length) html += '<p class="typhoon-facts">' + facts.join(" · ") + "</p>";

      if (s.spot && s.spot.distanceNm) {
        var spot = "<strong>" + Math.round(s.spot.distanceNm * 1.852) + " km</strong> from Donghe, bearing " +
          degToCompass(s.spot.bearingDeg);
        var ca = s.spot.closestApproach;
        if (ca) {
          spot += ca.recedingOnly
            ? " · tracking away over the forecast period"
            : " · closest <strong>" + Math.round(ca.distanceNm * 1.852) + " km</strong> at +" + ca.tau + "h";
        }
        html += '<p class="typhoon-spot">' + spot + "</p>";
      }

      // Where the track turns, read off the forecast points. Capped at three
      // so a long recurve stays a sentence rather than a list.
      if (s.motion && s.motion.turns && s.motion.turns.length) {
        var turnBits = s.motion.turns.slice(0, 3).map(function (t) {
          var window = t.fromTau === 0 ? "within " + t.toTau + "h" : t.fromTau + "–" + t.toTau + "h";
          return "<strong>" + degToCompass(t.headingDeg) + "</strong> " + window;
        });
        html += '<p class="typhoon-motion"><span class="typhoon-label">Turning</span> ' +
          turnBits.join(" · ") + "</p>";
      } else if (s.motion && s.motion.legs && s.motion.legs.length) {
        html += '<p class="typhoon-motion"><span class="typhoon-label">Track</span> holding <strong>' +
          degToCompass(s.motion.legs[0].heading) + "</strong> through the forecast period</p>";
      }

      // Swell verdict — every storm gets one, including an explicit "none".
      // See detectStormSwell in scripts/fetch-data.mjs.
      var swellTxt = swellSentence(s);
      if (swellTxt) html += '<p class="typhoon-swell">🌊 ' + swellTxt + "</p>";

      // Twice-daily digest of JTWC's prognostic reasoning, extracted from
      // its own topic sentences (not written by a model).
      if (s.summary && s.summary.text) {
        html += '<div class="typhoon-summary"><span class="typhoon-label">Forecaster summary</span> ' +
          escapeHtml(s.summary.text) +
          ' <span class="typhoon-lag">(JTWC warning #' + escapeHtml(s.summary.warningNumber) +
          ", updated " + escapeHtml(fmtDonghe(s.summary.generatedAt)) + ")</span></div>";
      }

      // JTWC's own change summary, quoted rather than paraphrased.
      var r = s.reasoning || {};
      if (r.significantForecastChanges) {
        html += '<p class="typhoon-changes"><span class="typhoon-label">Forecaster note</span> “' +
          escapeHtml(r.significantForecastChanges) + "”" +
          (s.reasoningLagsWarning && r.warningNumber
            ? ' <span class="typhoon-lag">(from warning #' + escapeHtml(r.warningNumber) + ")</span>"
            : "") + "</p>";
      }

      // Measured deltas against the previous archived cycle.
      var c = s.changes;
      if (c) {
        var deltas = [];
        if (c.maxWindKtDelta) deltas.push((c.maxWindKtDelta > 0 ? "+" : "") + c.maxWindKtDelta + " kt");
        if (c.pressureMbDelta) deltas.push((c.pressureMbDelta > 0 ? "+" : "") + c.pressureMbDelta + " mb");
        if (c.seasFtDelta) deltas.push("seas " + (c.seasFtDelta > 0 ? "+" : "") + c.seasFtDelta + " ft");
        if (c.maxTrackShiftNm) deltas.push("track shifted up to " + Math.round(c.maxTrackShiftNm * 1.852) + " km");
        if (c.closestApproachNmDelta) {
          deltas.push("closest approach " + (c.closestApproachNmDelta > 0 ? "+" : "") +
            Math.round(c.closestApproachNmDelta * 1.852) + " km");
        }
        html += '<p class="typhoon-changes"><span class="typhoon-label">Since warning #' +
          escapeHtml(c.previousWarningNumber) + "</span> " +
          (deltas.length ? deltas.join(" · ") : "no measurable change") + "</p>";
      }

      if (r.confidence) {
        var conf = [];
        if (r.confidence.track0072) conf.push("track " + r.confidence.track0072.toLowerCase());
        if (r.confidence.intensity0072) conf.push("intensity " + r.confidence.intensity0072.toLowerCase());
        if (conf.length) html += '<p class="typhoon-conf">JTWC confidence (0–72h): ' + conf.join(", ") + "</p>";
      }

      html += '<div class="typhoon-images">';
      if (s.graphic) {
        // The gif URL is stable per storm and rewritten in place every cycle,
        // so the issue time is appended to defeat the browser cache.
        var bust = s.issuedAt ? "?t=" + encodeURIComponent(s.issuedAt) : "";
        html += '<figure><a href="' + escapeHtml(s.graphic) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(s.graphic) + bust + '" alt="JTWC warning graphic for ' +
          escapeHtml(s.headline) + '" loading="lazy"></a>' +
          "<figcaption>JTWC TC Warning Graphic</figcaption></figure>";
      }
      if (s.cwaTrackImage) {
        html += '<figure><a href="' + escapeHtml(s.cwaTrackImage) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(s.cwaTrackImage) + '" alt="CWA 96-hour track forecast for ' +
          escapeHtml(s.name) + '" loading="lazy"></a>' +
          "<figcaption>CWA 96h track forecast</figcaption></figure>";
      }
      html += "</div>";

      var links = ['<a href="https://www.metoc.navy.mil/jtwc/jtwc.html" target="_blank" rel="noopener">JTWC ↗</a>'];
      if (s.warningText) links.push('<a href="' + escapeHtml(s.warningText) + '" target="_blank" rel="noopener">Warning text ↗</a>');
      links.push('<a href="https://www.cwa.gov.tw/V8/E/P/Typhoon/TY_NEWS.html" target="_blank" rel="noopener">CWA typhoon news ↗</a>');
      html += '<p class="typhoon-links">' + links.join(" · ") + "</p>";
      html += "</div>";
    });

    retired.forEach(function (s) {
      var where = s.spot && s.spot.distanceNm ? Math.round(s.spot.distanceNm * 1.852).toLocaleString("en-US") + " km " + degToCompass(s.spot.bearingDeg) + ", " : "";
      html += '<p class="typhoon-retired"><b>' + escapeHtml(s.name || s.id) + " (" + escapeHtml(s.id) + ")</b>: " + where +
        "tracking away — no more swell expected for Donghe. " +
        (s.warningText ? '<a href="' + escapeHtml(s.warningText) + '" target="_blank" rel="noopener">Warning ↗</a>' : "") + "</p>";
    });

    // Formation alerts — between "watching an area" and a numbered warning.
    // Listed before invests because an alert means JTWC thinks something is
    // about to happen, and it carries a hard decision deadline.
    // Western Pacific only (WTPN header, east of 100E) — the fetch script
    // filters these too; this also hides alerts in files written before it did.
    (data.alerts || []).filter(function (a) {
      return !(a.alertId && !/^WTPN/i.test(a.alertId)) && !(typeof a.lon === "number" && a.lon < 100);
    }).forEach(function (a) {
      html += '<div class="typhoon-card typhoon-alert"><h3>⚠ Formation Alert — Invest ' +
        escapeHtml(a.investId || a.alertId || "") + "</h3>";

      var lead = [];
      if (a.windowLowH && a.windowHighH) {
        lead.push("Formation possible in <strong>" + a.windowLowH + "–" + a.windowHighH + "h</strong>");
      }
      if (a.potential) lead.push("development potential <strong>" + escapeHtml(a.potential) + "</strong>");
      if (lead.length) html += "<p>" + lead.join(", ") + ".</p>";

      var det = [];
      if (a.distanceNm) det.push(Math.round(a.distanceNm * 1.852) + " km " + degToCompass(a.bearingDeg) + " of Donghe");
      if (a.movingText && a.movingKt) det.push("moving " + escapeHtml(a.movingText.toLowerCase()) + " at " + a.movingKt + " kt");
      if (a.maxWindKtLow && a.maxWindKtHigh) det.push(a.maxWindKtLow + "–" + a.maxWindKtHigh + " kt");
      if (a.pressureMb) det.push(a.pressureMb + " mb");
      if (det.length) html += '<p class="typhoon-meta">' + det.join(" · ") + "</p>";

      if (a.decisionByZ) {
        html += '<p class="typhoon-meta">Alert is upgraded to a warning, reissued or cancelled by <strong>' +
          escapeHtml(fmtDonghe(zuluToLocalISO(a.decisionByZ))) + "</strong>.</p>";
      }

      var img = a.graphic || a.satellite;
      if (img) {
        html += '<div class="typhoon-images"><figure>' +
          '<a href="' + escapeHtml(img) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(img) + (a.issuedAt ? "?t=" + encodeURIComponent(a.issuedAt) : "") +
          '" alt="JTWC formation alert graphic" loading="lazy"></a>' +
          "<figcaption>JTWC TCFA graphic</figcaption></figure></div>";
      }
      if (a.textUrl) {
        html += '<p class="typhoon-links"><a href="' + escapeHtml(a.textUrl) +
          '" target="_blank" rel="noopener">Formation alert text ↗</a></p>';
      }
      html += "</div>";
    });

    if (invests.length) {
      html += '<div class="typhoon-card typhoon-invests"><h3>Areas being watched</h3>';
      invests.forEach(function (iv) {
        var line = "<strong>Invest " + escapeHtml(iv.id || "—") + "</strong>";
        if (iv.potential) line += " — " + escapeHtml(iv.potential) + " development potential";
        var det = [];
        if (iv.distanceNm) {
          det.push(Math.round(iv.distanceNm * 1.852) + " km " + degToCompass(iv.bearingDeg) + " of Donghe");
        }
        // Left in JTWC's own casing — lowercasing turns "468 NM SOUTH OF
        // GUAM" into "468 nm south of guam", mangling the unit and the
        // place name. It already renders small and dim.
        if (iv.geoReference) det.push(escapeHtml(iv.geoReference));
        if (iv.windKtLow && iv.windKtHigh) det.push(iv.windKtLow + "–" + iv.windKtHigh + " kt");
        if (iv.pressureMb) det.push(iv.pressureMb + " mb");
        html += '<p class="typhoon-invest-line">' + line +
          (det.length ? '<br><span class="typhoon-rough">' + det.join(" · ") + "</span>" : "") + "</p>";
      });
      // No per-invest graphic exists, so the basin-wide advisory satellite
      // image is what lets you judge whether a disturbance is organising.
      if (data.investSatellite) {
        html += '<div class="typhoon-images"><figure>' +
          '<a href="' + escapeHtml(data.investSatellite) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(data.investSatellite) +
          (data.advisory && data.advisory.issuedAt ? "?t=" + encodeURIComponent(data.advisory.issuedAt) : "") +
          '" alt="JTWC Western Pacific advisory satellite image" loading="lazy"></a>' +
          "<figcaption>JTWC advisory satellite image (W Pacific)</figcaption></figure></div>";
      }
      if (data.advisory && data.advisory.url) {
        html += '<p class="typhoon-links"><a href="' + escapeHtml(data.advisory.url) +
          '" target="_blank" rel="noopener">Significant Tropical Weather Advisory ↗</a></p>';
      }
      html += "</div>";
    }

    body.innerHTML = html;
    panel.hidden = false;
  }

  /* ---------- Per-forecast update lines ----------
     "Last update / Next update" under each forecast, so you can tell which
     model run you're reading. Neither CWA nor Open-Meteo publishes an issue
     time in what we store, so scripts/fetch-data.mjs hashes each dataset
     every run and records when the content actually changed — that moment
     IS the new run landing. The next time is the median observed gap added
     to the last change, and is marked "~" because it's inferred, not
     announced. Until two changes have been seen there's no cadence to
     infer and only the last update is shown. */
  var updateLog = null;

  // JTWC works in Zulu; this page is read standing on a beach in Taiwan.
  // Pinned to Asia/Taipei rather than device-local so the times stay Donghe
  // times even when the page is opened from somewhere else.
  var DONGHE_TZ = "Asia/Taipei";
  function fmtDonghe(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-US", {
        timeZone: DONGHE_TZ, weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
    } catch (e) { return iso; }
  }

  // "230400Z" -> ISO. JTWC gives only day-of-month, so the month comes from
  // now, stepping forward if that would put a deadline in the past (these
  // are always imminent) — the mirror of the backwards guess used for
  // issue times, which are always recent.
  function zuluToLocalISO(dz) {
    var m = String(dz || "").match(/^(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    var now = new Date();
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +m[1], +m[2], +m[3]));
    if (d.getTime() < Date.now() - 2 * 86400000) {
      d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, +m[1], +m[2], +m[3]));
    }
    return d.toISOString();
  }

  function fmtClock(iso) {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return "—"; }
  }

  function renderUpdateLine(elId, sourceKey) {
    var el = document.getElementById(elId);
    if (!el) return;
    var s = updateLog && updateLog.sources && updateLog.sources[sourceKey];
    if (!s || !s.lastChangedAt) { el.textContent = ""; return; }

    var last = new Date(s.lastChangedAt);
    var txt = "Last update: " + fmtClock(s.lastChangedAt);
    // Say the day too if the last change wasn't today — "Last update: 18:00"
    // is misleading when it means yesterday evening.
    if (last.toDateString() !== new Date().toDateString()) {
      txt += " (" + last.toLocaleDateString("en-US", { weekday: "short" }) + ")";
    }
    if (s.intervalMinutes) {
      var next = new Date(last.getTime() + s.intervalMinutes * 60000);
      // A prediction already in the past means the update is running late;
      // saying "due now" is honest, a stale past time is not.
      txt += " · Next update: " + (next.getTime() < Date.now() ? "due now" : "~" + fmtClock(next.toISOString()));
    }
    el.textContent = txt;
  }

  function renderAllUpdateLines() {
    renderUpdateLine("openWaveUpdated", "openwave");
    renderUpdateLine("coastalUpdated", "coastal");
    renderUpdateLine("tideUpdated", "tide");
  }

  /* ---------- Sunrise / sunset / astronomical calendar ----------
     From CWA's own per-year astronomy files (see buildAstronomy in
     scripts/fetch-data.mjs). The calendar genuinely has gaps — most days
     carry no phenomenon and no solar term — so anything missing is simply
     omitted rather than rendered as a dash. */
  // Both the astronomy file and the tide pager can arrive first, so each
  // stores its half and the render runs off whatever is there.
  var astroData = null;
  var astroDayKey = null; // YYYY-MM-DD of the tide day being viewed

  function renderAstronomy(data) {
    astroData = data;
    renderAstronomyDay();
  }

  function renderAstronomyDay() {
    var el = document.getElementById("astronomy");
    var srcEl = document.getElementById("astroSource");
    if (!el) return;
    function showSource(on) { if (srcEl) srcEl.hidden = !on; }
    try {
      var dayKey = astroDayKey || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      var d = astroData && astroData.days && astroData.days[dayKey];
      if (!d) { el.innerHTML = ""; showSource(false); return; }

      // The attribution line is for the calendar, so it only earns its space
      // on days that have calendar content — most days have neither a solar
      // term nor a phenomenon.
      showSource(!!(d.solarTerm || (d.phenomena && d.phenomena.length)));

      var html = '<div class="astro-row">';
      if (d.sunrise) html += '<span class="astro-item">🌅 Sunrise <strong>' + d.sunrise + "</strong></span>";
      if (d.sunset) html += '<span class="astro-item">🌇 Sunset <strong>' + d.sunset + "</strong></span>";
      if (d.civilTwilightBegin) html += '<span class="astro-item astro-dim">First light ' + d.civilTwilightBegin + "</span>";
      if (d.civilTwilightEnd) html += '<span class="astro-item astro-dim">Last light ' + d.civilTwilightEnd + "</span>";
      html += "</div>";

      var extras = [];
      if (d.moonrise || d.moonset) {
        extras.push("Moon " + (d.moonrise || "—") + " – " + (d.moonset || "—"));
      }
      if (d.solarTerm) extras.push("Solar term: " + translateSolarTerm(d.solarTerm));
      if (d.lunarDate) extras.push(translateLunarDate(d.lunarDate));
      if (d.phenomena && d.phenomena.length) extras.push(d.phenomena.join(" · "));
      if (extras.length) {
        html += '<div class="astro-row astro-cal">' + extras.map(function (x) {
          return '<span class="astro-item">' + x + "</span>";
        }).join("") + "</div>";
      }
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = "";
      showSource(false);
    }
  }

  /* ---------- Data freshness ----------
     Everything on this page is served from data/*.json, which a scheduled
     Action refreshes hourly. If that Action breaks, the page keeps rendering
     the last good numbers and looks completely normal — which is worse than
     showing nothing, because someone reads two-week-old wave heights and
     believes them. So the age of the data is stated outright.

     Thresholds are keyed to the hourly refresh: under 2h is a normal gap
     (one missed run, or a run that found no changes), by 4h something is
     wrong, and by 12h the numbers can no longer be trusted for a surf call. */
  var STALE_HOURS = 4;
  var VERY_STALE_HOURS = 12;

  function humanAge(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 90) return mins + " min";
    var hours = Math.round(mins / 60);
    if (hours < 36) return hours + "h";
    return Math.round(hours / 24) + " days";
  }

  function renderFreshness(meta) {
    var el = document.getElementById("lastUpdated");
    var banner = document.getElementById("staleBanner");

    // meta.json itself didn't load — can't say anything about the data's age,
    // so say that rather than implying it's current.
    if (!meta || !meta.updatedAt) {
      if (el) {
        el.textContent = "⚠ Update status unknown";
        el.className = "last-updated is-very-stale";
      }
      if (banner) {
        banner.className = "stale-banner is-error";
        banner.innerHTML = "<strong>⚠ Can't tell how old this data is</strong>" +
          "The update log didn't load, so everything below may be out of date. " +
          '<span class="stale-detail">Check the "Update CWA Data" workflow in the repository\'s Actions tab.</span>';
        banner.hidden = false;
      }
      return;
    }

    var ageMs = Date.now() - new Date(meta.updatedAt).getTime();
    var ageHours = ageMs / 3600000;
    // Hard failures only: a source with ok:false and no error just means the
    // fetch succeeded but matched nothing, and it already writes its raw
    // payload for inspection.
    var failed = (meta.sources || []).filter(function (s) { return s.ok === false && s.error; });

    if (el) {
      el.textContent = (ageHours >= STALE_HOURS ? "⚠ " : "") +
        "Updated " + fmtTime(meta.updatedAt) + " (" + humanAge(ageMs) + " ago)";
      el.className = "last-updated" +
        (ageHours >= VERY_STALE_HOURS ? " is-very-stale" : ageHours >= STALE_HOURS ? " is-stale" : "");
    }
    if (!banner) return;

    if (ageHours >= STALE_HOURS) {
      var severe = ageHours >= VERY_STALE_HOURS;
      banner.className = "stale-banner" + (severe ? " is-error" : "");
      banner.innerHTML = "<strong>⚠ This data is " + humanAge(ageMs) + " old</strong>" +
        (severe
          ? "The hourly update has stopped. Don't use anything below to judge conditions."
          : "The hourly update hasn't run recently. Treat the numbers below with caution.") +
        ' <span class="stale-detail">Last successful update ' + fmtTime(meta.updatedAt) +
        ". Check the \"Update CWA Data\" workflow in the repository's Actions tab." +
        (failed.length ? " Last run also reported " + failed.length + " failed source(s)." : "") +
        "</span>";
      banner.hidden = false;
      return;
    }

    // Data is current, but part of the last run failed — that section is
    // stale even though the page as a whole isn't.
    if (failed.length) {
      banner.className = "stale-banner";
      banner.innerHTML = "<strong>⚠ Part of the last update failed</strong>" +
        "Most of this page is current, but these sources didn't refresh: " +
        failed.map(function (s) { return s.name; }).join(", ") + "." +
        ' <span class="stale-detail">Those sections are showing older data.</span>';
      banner.hidden = false;
      return;
    }

    banner.hidden = true;
  }

  document.addEventListener("click", function (ev) {
    if (ev.target && ev.target.id === "tidePrevBtn") renderTideDay(tideDayIndex - 1);
    if (ev.target && ev.target.id === "tideNextBtn") renderTideDay(tideDayIndex + 1);
  });

  /* =====================================================================
     Collapsible sections
     Every section starts collapsed (by choice, every visit) and shows its
     one-line summary on the bar. Tapping the bar or a header button opens
     it. Embeds that run code (Windguru) are deferred until Forecasts is
     first opened; the iframes are loading="lazy", so a collapsed section
     never loads them at all. Charts are fixed-viewBox SVG, so drawing them
     while hidden is safe.
     ===================================================================== */
  var deferredEmbedsRan = false;
  function setSectionOpen(sec, open) {
    var btn = sec.querySelector(".sec-head"), body = sec.querySelector(".sec-body");
    if (!btn || !body) return;
    btn.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
    sec.classList.toggle("is-open", open);
    if (open && sec.id === "forecasts" && !deferredEmbedsRan) {
      deferredEmbedsRan = true;
      (window.deferredEmbeds || []).forEach(function (run) { try { run(); } catch (e) { /* one widget failing shouldn't stop the rest */ } });
    }
  }
  function openAndScroll(id) {
    var sec = document.getElementById(id);
    if (!sec || !sec.classList.contains("sec") || sec.hidden) return false;
    setSectionOpen(sec, true);
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  (function initSections() {
    document.querySelectorAll(".sec > .sec-head").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sec = btn.parentNode;
        setSectionOpen(sec, btn.getAttribute("aria-expanded") !== "true");
      });
    });
    document.querySelectorAll('.quick-links a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (ev) {
        var id = a.getAttribute("href").slice(1);
        if (openAndScroll(id)) {
          ev.preventDefault();
          try { history.replaceState(null, "", "#" + id); } catch (e) { /* ignore */ }
        }
      });
    });
    // A link straight to a section (e.g. index.html#tide) opens it.
    var h = location.hash.replace("#", "");
    if (h) setTimeout(function () { openAndScroll(h); }, 300);
  })();

  function setSummary(id, html) {
    var el = document.getElementById("sum-" + id);
    if (el) el.innerHTML = html;
  }

  /* ---------- shared helpers for the summaries ---------- */
  var TZ = "Asia/Taipei";
  var fmtHMx = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  var fmtDayShort = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
  var fmtWeekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
  function dayKey(t) { return new Date(t + 8 * 3600000).toISOString().slice(0, 10); }
  function hourOf(t) { return new Date(t + 8 * 3600000).getUTCHours(); }
  function num(v) { if (v === null || v === undefined || v === "" || v === "None") return null; var n = Number(v); return isFinite(n) ? n : null; }
  function kt(ms) { return ms * 1.94384; }
  function angDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  var ZH_DEG = { "北": 0, "北北東": 22.5, "東北": 45, "東北東": 67.5, "東": 90, "東南東": 112.5, "東南": 135, "南南東": 157.5, "南": 180, "南南西": 202.5, "西南": 225, "西南西": 247.5, "西西南": 247.5, "西": 270, "西北西": 292.5, "西北": 315, "北北西": 337.5 };
  function zhDeg(t) { if (!t) return null; var b = String(t).trim().replace(/風$/, "").replace(/^偏/, ""); return ZH_DEG[b] === undefined ? null : ZH_DEG[b]; }
  // Donghe's beach faces ~ESE: onshore from ~105°, offshore from ~285° (same
  // rule as the Forecast Check page).
  function windCallDonghe(ms, dir) {
    if (ms === null) return null;
    if (ms < 2) return "light & variable";
    if (dir === null) return null;
    if (angDiff(dir, 285) <= 60) return "offshore";
    if (angDiff(dir, 105) <= 60) return "onshore";
    return "cross-shore";
  }
  // Wind strength words, in knots (user's choice): light < 8, moderate 8–16, strong > 16.
  function windStrength(k) { return k < 8 ? "light" : k <= 16 ? "moderate" : "strong"; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }

  /* ---------- data adapters ---------- */
  function openWaveSeries(ow) {
    var h = (ow && ow.hourly) || {};
    return (h.time || []).map(function (t, i) { return { t: new Date(t + ":00+08:00").getTime(), h: num(h.wave_height[i]), p: num(h.wave_period[i]), d: h.wave_direction ? num(h.wave_direction[i]) : null }; });
  }
  function coastalSeries(c) {
    try {
      var loc = c.records.locations[0].location[0], els = {};
      (loc.WeatherElement || []).forEach(function (w) { els[w.ElementName] = w.Time || []; });
      function val(name, field) { var m = {}; (els[name] || []).forEach(function (t) { var v = t.ElementValue; v = Array.isArray(v) ? v[0] : v; m[t.DataTime] = v ? v[field] : null; }); return m; }
      var hgt = val("浪高", "WaveHeight"), spd = val("風速", "WindSpeed"), wdir = val("風向", "WindDirection"), wx = val("天氣現象", "Weather");
      var keys = Object.keys(spd).length ? Object.keys(spd) : Object.keys(hgt);
      return keys.map(function (k) { return { t: Date.parse(k), h: num(hgt[k]), s: num(spd[k]), d: zhDeg(wdir[k]), rain: /雨/.test(wx[k] || "") }; }).sort(function (a, b) { return a.t - b.t; });
    } catch (e) { return []; }
  }
  function tideExtrema(td) {
    var out = [];
    try {
      var tf = (td.records.TideForecasts || td.records.locations)[0], loc = tf.Location || tf;
      (loc.TimePeriods.Daily || loc.TimePeriods).forEach(function (day) {
        (day.Time || []).forEach(function (t) {
          var h = t.TideHeights && (t.TideHeights.AboveTWVD !== undefined ? t.TideHeights.AboveTWVD : t.TideHeights.AboveLocalMSL);
          out.push({ t: new Date(t.DateTime).getTime(), h: Number(h), high: t.Tide === "滿潮" });
        });
      });
    } catch (e) { /* no tide */ }
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  function tideAt(ex, t) {
    for (var i = 0; i < ex.length - 1; i++) if (t >= ex[i].t && t <= ex[i + 1].t) {
      var f = (t - ex[i].t) / (ex[i + 1].t - ex[i].t), mu = (1 - Math.cos(f * Math.PI)) / 2;
      return { h: ex[i].h * (1 - mu) + ex[i + 1].h * mu, rising: ex[i + 1].h > ex[i].h };
    }
    return null;
  }

  function renderSummaries() {
    // Each piece waits only for its own files and fails on its own.
    Promise.all([getData("buoy"), getData("stations-history"), getData("tide"), getData("astronomy").catch(function () { return null; }),
      getData("openwave"), getData("coastal").catch(function () { return null; })])
      .then(function (r) { renderNowCard(r[0], r[1], r[2], r[3], r[4], r[5]); }).catch(function () {});
    Promise.all([getData("openwave"), getData("ecmwf").catch(function () { return null; }), getData("gfs-wave").catch(function () { return null; }), getData("coastal").catch(function () { return null; })])
      .then(function (r) { renderForecastSummary(r[0], r[1], r[2], r[3]); }).catch(function () { setSummary("forecasts", "Wave forecasts, models and maps"); });
    Promise.all([getData("tide"), getData("phase3-live").catch(function () { return null; })])
      .then(function (r) { renderTideSummary(r[0], r[1]); }).catch(function () { setSummary("tide", "Donghe tide chart, sun and moon"); });
    getData("stations-history").then(renderObservationSummary).catch(function () { setSummary("observations", "Land-station wind, last 16 hours"); });
    getData("buoy").then(renderBuoySummary).catch(function () { setSummary("buoys", "Sea state at five buoys, last 24 hours"); });
    getData("rain").then(renderRainSummary).catch(function () {}); // keeps the static Rain line on failure
  }

  /* ---------- Early offshore at Donghe ----------
     Most mornings a light land breeze drains off the Coastal Range and
     blows offshore at dawn — unless the background (gradient) wind over the
     water is strong enough to override it. CWA's coastal forecast for
     05:00–08:00 is that background wind. Set from the Donghe station and
     the user's own calls for Oct 4–13: 6–9 kt mornings were offshore,
     Sat Oct 10 at 11 kt NE wasn't, 12–18 kt NE mornings weren't. ECMWF and
     GFS show 2–5 kt at Donghe every dawn, so they can't separate the days.
     Calibrated on few days — Phase 4's surf log is how to tune it. */
  function earlyOffshore(wind, k) {
    var dawn = wind.filter(function (p) { var hr = hourOf(p.t); return dayKey(p.t) === k && hr >= 5 && hr <= 8 && p.s !== null; });
    if (!dawn.length) return null;
    var s = kt(mean(dawn.map(function (p) { return p.s; })));
    var d = dawn[0].d;
    var fromLand = d !== null && angDiff(d, 285) <= 60; // W–NW gradient wind is offshore anyway
    if (fromLand && s <= 20) return { level: "likely", text: "Likely offshore early" };
    if (s <= 10) return { level: "likely", text: "Likely offshore early" };
    if (s <= 14) return { level: "maybe", text: "Probably not offshore early" };
    return { level: "unlikely", text: "Not likely offshore early" };
  }

  /* ---------- Surf rating (WaveSlave's rules, user's choice 2026-10-13) ----------
     Each hour scores 0–8: height (exposure-adjusted) 0–3, period 0–3, wind
     −2…+2. Period is scored ×1.3 like WaveSlave so the ratings match theirs;
     the periods shown on the page stay raw. Wind kinds use WaveSlave's own
     split (offshore within 55° of 280°, cross within 115°) rather than the
     site's 285±60 call, again so the ratings match. The top rating (WaveSlave's "Firing", shown as "Drop everything and go now!!!") needs a 10 kt+
     offshore wind; without it the top is Good. */
  var RATE_P = 1.3, RATE_OFF = 280;
  var RATINGS = [["Flat", "flat"], ["Poor", "poor"], ["Fair", "fair"], ["Good", "good"], ["Drop everything and go now!!!", "firing"]];
  function rateWindKind(from) { var d = angDiff(from, RATE_OFF); return d <= 55 ? "off" : d <= 115 ? "cross" : "on"; }
  // How much of the swell reaches the beach, which faces away from its offshore direction.
  function rateExposure(dir) { if (dir === null || dir === undefined) return 1; var d = angDiff(dir, RATE_OFF + 180); return d <= 45 ? 1 : d <= 90 ? 0.5 : 0.2; }
  // h, p raw (m, s); w = { kt, from, rain } or null.
  function surfScore(h, p, w) {
    var s = h < 0.4 ? 0 : h < 0.8 ? 1 : h < 1.2 ? 2 : h <= 2.5 ? 3 : h <= 3.5 ? 2 : 1;
    var pp = p === null ? 0 : p * RATE_P;
    s += pp < 6 ? 0 : pp < 8 ? 1 : pp < 10 ? 2 : 3;
    var hardOff = false;
    if (w && w.from !== null && w.from !== undefined) {
      var k = rateWindKind(w.from), v = w.rain ? w.kt / 2 : w.kt; // rain usually knocks the wind down
      if (v < 5) s += 2; else if (k === "off") s += v < 20 ? 2 : 1; else if (k === "cross") s += v < 10 ? 0 : -1; else s += v < 10 ? -1 : -2;
      hardOff = k === "off" && v >= 10;
    }
    s = Math.max(0, Math.min(8, s));
    return s >= 7 && !hardOff ? 6 : s;
  }
  function rateOf(score) { return score <= 1 ? 0 : score <= 3 ? 1 : score <= 5 ? 2 : score <= 6 ? 3 : 4; }
  function ratingHtml(score) { var r = RATINGS[rateOf(score)]; return '<span class="rating rating-' + r[1] + '">' + r[0] + "</span>"; }
  // Hourly scores for a day: Open-Meteo waves with the nearest CWA coastal wind (within 3 h).
  function dayScores(waves, wind, k, light) {
    return waves.filter(function (p) { return dayKey(p.t) === k && p.h !== null; }).map(function (p) {
      var near = null, bd = Infinity;
      wind.forEach(function (w) { var d = Math.abs(w.t - p.t); if (w.s !== null && d < bd) { bd = d; near = w; } });
      var w = near && bd <= 3 * 3600000 ? { kt: kt(near.s), from: near.d, rain: near.rain } : null;
      var hm = fmtHMx.format(p.t);
      return { t: p.t, h: p.h, p: p.p, w: w, day: !light || (hm >= light[0] && hm <= light[1]), s: surfScore(p.h * rateExposure(p.d), p.p, w) };
    });
  }
  // Best window: the best-scoring daylight hour still ahead (or the day's best,
  // once it has passed), grown over back-to-back hours scoring as well.
  // 2 to 3 hours long (user's limits, 2026-10-13).
  function bestWindow(hours, now) {
    var pool = hours.filter(function (x) { return x.day && x.w; });
    if (!pool.length) pool = hours;
    if (!pool.length) return null;
    var ahead = pool.filter(function (x) { return x.t >= now - now % 3600000; }), cand = ahead.length ? ahead : pool;
    var top = cand.reduce(function (a, b) { return b.s > a.s ? b : a; }, cand[0]);
    var lo = cand.indexOf(top), hi = lo;
    function prev(minS) { return lo > 0 && cand[lo].t - cand[lo - 1].t <= 3600000 && cand[lo - 1].s >= minS ? cand[lo - 1] : null; }
    function next(minS) { return hi < cand.length - 1 && cand[hi + 1].t - cand[hi].t <= 3600000 && cand[hi + 1].s >= minS ? cand[hi + 1] : null; }
    // First only hours scoring as well, up to 3 hours; if the best hour still
    // stands alone, add its better neighbour so the window is at least 2 hours.
    [top.s, -Infinity].forEach(function (minS, pass) {
      if (pass && hi > lo) return;
      while (hi - lo < (pass ? 1 : 2)) { var p = prev(minS), n = next(minS); if (!p && !n) break; if (n && (!p || n.s >= p.s)) hi++; else lo--; }
    });
    return { a: cand[lo].t, b: cand[hi].t, top: top, past: !ahead.length, peak: Math.max.apply(null, pool.map(function (x) { return x.s; })) };
  }
  function bestWindowText(bw) {
    var x = bw.top, w = x.w;
    var span = bw.a < bw.b ? fmtHMx.format(bw.a) + "–" + fmtHMx.format(bw.b + 3600000) : "around " + fmtHMx.format(x.t);
    var windTxt = w ? ", " + Math.round(w.kt) + " kt" + (w.kt < 5 ? "" : " " + { off: "offshore", cross: "cross-shore", on: "onshore" }[rateWindKind(w.from)]) : "";
    return (bw.past ? "Best was " : "Best window ") + span + ": " + n1(x.h) + " m at " + (x.p !== null ? Math.round(x.p) + " s" : "—") + windTxt;
  }

  /* ---------- Right now + next 3 days ---------- */
  function renderNowCard(buoy, stations, tide, astro, ow, coastal) {
    var now = Date.now();
    function cell(id, html) { var el = document.getElementById(id); if (el) el.querySelector(".now-v").innerHTML = html; }
    // Waves: the Chenggong buoy (closest to Donghe).
    var cg = ((buoy.records && buoy.records.Stations) || []).filter(function (s) { return s.StationID === "46761F"; })[0];
    var last = cg && (cg.Readings || []).filter(function (r) { return num(r.WaveHeight) !== null; }).pop();
    if (last) {
      cell("nowWaves", "<b>" + n1(num(last.WaveHeight)) + " m" + (num(last.WavePeriod) !== null ? ' <span class="per">@ ' + n1(num(last.WavePeriod)) + " s</span>" : "") + "</b>" +
        '<span class="now-s">' + (last.WaveDirectionDescription ? "from " + escapeHtml(last.WaveDirectionDescription) : "") + " · " + fmtHMx.format(new Date(last.DateTime)) + "</span>");
    }
    // Wind: the Donghe station.
    var dh = stations && stations.C0S810 && (stations.C0S810.readings || []);
    var w = dh && dh.filter(function (r) { return num(r.WindSpeed) !== null; }).pop();
    if (w) {
      var ms = num(w.WindSpeed), dir = num(w.WindDirection), call = windCallDonghe(ms, dir);
      cell("nowWind", "<b>" + Math.round(kt(ms)) + " kt</b>" + '<span class="now-s">' + (dir !== null ? "from " + degToCompass(dir) : "") +
        (call ? ' · <span class="call call-' + call.split(" ")[0] + '">' + call + "</span>" : "") + " · " + fmtHMx.format(new Date(w.DateTime)) + "</span>");
    }
    // Rating now: the Chenggong buoy and the Donghe station wind, as WaveSlave does.
    var nr = document.getElementById("nowRating");
    if (nr && last) {
      var nw = w ? { kt: kt(num(w.WindSpeed)), from: num(w.WindDirection) } : null;
      nr.innerHTML = ratingHtml(surfScore(num(last.WaveHeight) * rateExposure(num(last.WaveDirection)), num(last.WavePeriod), nw));
    }
    // Tide: the Donghe prediction now, and the next turning point.
    var ex = tideExtrema(tide), at = tideAt(ex, now), next = ex.filter(function (e) { return e.t > now; })[0];
    if (at) {
      cell("nowTide", "<b>" + Math.round(at.h) + " cm</b>" + '<span class="now-s">' + (at.rising ? "rising" : "falling") +
        (next ? " · " + (next.high ? "high" : "low") + " " + fmtHMx.format(next.t) + " (" + Math.round(next.h) + " cm)" : "") + "</span>");
    }
    // Sun: today's times, or tomorrow's once today's sunset has passed.
    var days = (astro && astro.days) || {}, key = dayKey(now), d = days[key];
    if (d && d.sunset) {
      var ss = new Date(key + "T" + d.sunset + ":00+08:00").getTime();
      if (now > ss) { var k2 = dayKey(now + 86400000); if (days[k2]) { d = days[k2]; key = k2; } }
    }
    if (d) {
      cell("nowSun", "<b>" + (d.sunrise || "—") + "</b>" + '<span class="now-s">' + (key !== dayKey(now) ? "sunrise tomorrow" : "sunrise") +
        (d.civilTwilightBegin ? " · first light " + d.civilTwilightBegin : "") + (d.sunset ? " · sunset " + d.sunset : "") + "</span>");
    }

    // Next 3 days: Open-Meteo waves over daylight (06–18), CWA coastal wind.
    var waves = openWaveSeries(ow), wind = coastalSeries(coastal), cards = [];
    for (var i = 0; i < 3; i++) {
      var k = dayKey(now + i * 86400000);
      var day = waves.filter(function (p) { var hr = hourOf(p.t); return dayKey(p.t) === k && hr >= 6 && hr <= 18 && p.h !== null; });
      if (!day.length) continue;
      var hs = day.map(function (p) { return p.h; }), ps = day.map(function (p) { return p.p; }).filter(function (v) { return v !== null; });
      var dw = wind.filter(function (p) { var hr = hourOf(p.t); return dayKey(p.t) === k && hr >= 6 && hr <= 18 && p.s !== null; });
      var calls = {}; dw.forEach(function (p) { var c = windCallDonghe(p.s, p.d); if (c) calls[c] = (calls[c] || 0) + 1; });
      var topCall = Object.keys(calls).sort(function (a, b) { return calls[b] - calls[a]; })[0];
      var windTxt = dw.length ? Math.round(kt(mean(dw.map(function (p) { return p.s; })))) + " kt" + (topCall ? ", mostly " + topCall : "") : "wind forecast not out yet";
      var hMin = Math.min.apply(null, hs), hMax = Math.max.apply(null, hs);
      var pMin = ps.length ? Math.min.apply(null, ps) : null, pMax = ps.length ? Math.max.apply(null, ps) : null;
      var early = earlyOffshore(wind, k);
      var ad = days[k], scores = dayScores(waves, wind, k, ad && ad.civilTwilightBegin && ad.civilTwilightEnd ? [ad.civilTwilightBegin, ad.civilTwilightEnd] : ["06:00", "18:00"]);
      var bw = bestWindow(scores, now);
      // No Best window for today (user's choice 2026-10-14); the day's rating still shows.
      var bwTxt = bw && i > 0 ? '<span class="od-best" title="' + escapeHtml(bestWindowText(bw)) + '">' + (bw.past ? "Best was " : "Best window ") + (bw.a < bw.b ? fmtHMx.format(bw.a) + "–" + fmtHMx.format(bw.b + 3600000) : "~" + fmtHMx.format(bw.top.t)) + "</span>" : "";
      var earlyTxt = early && !(i === 0 && hourOf(now) >= 9) ? '<span class="od-off od-off-' + early.level + '">' + early.text + "</span>" : "";
      var label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtWeekday.format(now + i * 86400000);
      cards.push('<div class="outlook-day"><span class="od-k">' + label + ' <span class="od-date">' + fmtDayShort.format(now + i * 86400000).replace(/^\w+, /, "") + "</span></span>" +
        (bw ? ratingHtml(bw.peak) : "") +
        '<span class="od-h">' + n1(hMin) + (n1(hMax) !== n1(hMin) ? "–" + n1(hMax) : "") + " m" +
        (pMin !== null ? ' <span class="per">@ ' + Math.round(pMin) + (Math.round(pMax) !== Math.round(pMin) ? "–" + Math.round(pMax) : "") + " s</span>" : "") + "</span>" +
        '<span class="od-w">' + windTxt + "</span>" + earlyTxt + bwTxt + "</div>");
    }
    var ol = document.getElementById("outlook");
    if (ol) ol.innerHTML = cards.length ? cards.join("") : '<p class="loading">No forecast available</p>';
  }

  /* ---------- Forecasts: tomorrow vs today, and do the models agree ---------- */
  function daytimeMean(points, k) {
    var v = points.filter(function (p) { var hr = hourOf(p.t); return dayKey(p.t) === k && hr >= 6 && hr <= 18 && p.v !== null && p.v !== undefined; }).map(function (p) { return p.v; });
    return v.length ? mean(v) : null;
  }
  function renderForecastSummary(ow, ec, gw, coastal) {
    var now = Date.now(), today = dayKey(now), tom = dayKey(now + 86400000);
    var om = openWaveSeries(ow);
    var hT = daytimeMean(om.map(function (p) { return { t: p.t, v: p.h }; }), today), hN = daytimeMean(om.map(function (p) { return { t: p.t, v: p.h }; }), tom);
    var pT = daytimeMean(om.map(function (p) { return { t: p.t, v: p.p }; }), today), pN = daytimeMean(om.map(function (p) { return { t: p.t, v: p.p }; }), tom);
    var out = [];
    if (hT !== null && hN !== null) {
      // Bigger/smaller at a 20% change; period longer/shorter at 1 s.
      var size = hN >= hT * 1.2 ? "bigger than" : hN <= hT * 0.8 ? "smaller than" : "similar to";
      var per = pT === null || pN === null ? "" : pN - pT >= 1 ? ", period longer (" + Math.round(pN) + " s vs " + Math.round(pT) + " s)" : pT - pN >= 1 ? ", period shorter (" + Math.round(pN) + " s vs " + Math.round(pT) + " s)" : ", period similar (~" + Math.round(pN) + " s)";
      out.push("<b>Tomorrow:</b> waves " + size + " today (about " + n1(hN) + " m vs " + n1(hT) + " m)" + per + ".");
    }
    // Models: tomorrow's daytime mean height from each source we log for Donghe.
    var srcs = [["Open-Meteo", om.map(function (p) { return { t: p.t, v: p.h }; })]];
    if (ec && ec.series) srcs.push(["ECMWF", ec.series.map(function (p) { return { t: Date.parse(p.targetTime), v: num(p.waveHeight) }; })]);
    if (gw && gw.series) srcs.push(["GFS-Wave", gw.series.map(function (p) { return { t: Date.parse(p.targetTime), v: num(p.waveHeight) }; })]);
    if (coastal) srcs.push(["CWA", coastalSeries(coastal).map(function (p) { return { t: p.t, v: p.h }; })]);
    var vals = srcs.map(function (s) { return { name: s[0], v: daytimeMean(s[1], tom) }; }).filter(function (s) { return s.v !== null; });
    if (vals.length >= 2) {
      var hi = Math.max.apply(null, vals.map(function (s) { return s.v; })), lo = Math.min.apply(null, vals.map(function (s) { return s.v; })), spread = hi - lo;
      var sorted = vals.map(function (s) { return s.v; }).sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
      var odd = vals.slice().sort(function (a, b) { return Math.abs(b.v - med) - Math.abs(a.v - med); })[0];
      var verdict = spread <= 0.3 ? "Models agree" : spread <= 0.6 ? "Some spread between models" : "Models split";
      out.push('<span class="model-line">' + verdict + " for tomorrow (" + n1(lo) + "–" + n1(hi) + " m" +
        (spread > 0.3 ? "; " + odd.name + " is the outlier at " + n1(odd.v) + " m" : "") + ').</span> <span class="model-vals">' +
        vals.map(function (s) { return s.name + " " + n1(s.v); }).join(" · ") + "</span>");
    }
    setSummary("forecasts", out.length ? out.join(" ") : "Wave forecasts, models and maps");
  }

  /* ---------- Tide ---------- */
  function renderTideSummary(tide, live) {
    // The next three turns, so tomorrow morning's tide is always on the bar;
    // a turn that isn't today carries its day.
    var now = Date.now(), ex = tideExtrema(tide).filter(function (e) { return e.t > now; }).slice(0, 3);
    var bits = ex.map(function (e) {
      var when = dayKey(e.t) === dayKey(now) ? "" : (dayKey(e.t) === dayKey(now + 86400000) ? "tomorrow " : fmtWeekday.format(e.t) + " ");
      return (e.high ? "High " : "Low ") + when + "<b>" + fmtHMx.format(e.t) + "</b> (" + Math.round(e.h) + " cm)";
    });
    var off = tideOffset24h(live);
    if (off && Math.abs(off.avg) >= 3) bits.push("sea running " + signedCm(off.avg) + " vs prediction");
    setSummary("tide", bits.length ? bits.join(" · ") : "Donghe tide chart, sun and moon");
  }

  /* ---------- Observations: wind at each land station ----------
     Strength in knots (light < 8, moderate 8–16, strong > 16); increasing or
     easing when it moved 3 kt or more against the reading ~3 hours earlier. */
  function stationWindLine(id, s) {
    var rs = (s.readings || []).filter(function (r) { return num(r.WindSpeed) !== null; });
    var last = rs[rs.length - 1];
    if (!last) return null;
    var t = new Date(last.DateTime).getTime(), k = kt(num(last.WindSpeed)), dir = num(last.WindDirection);
    var ref = rs.filter(function (r) { return new Date(r.DateTime).getTime() <= t - 2.5 * 3600000; }).pop();
    var trend = ref ? (k - kt(num(ref.WindSpeed)) >= 3 ? "increasing" : kt(num(ref.WindSpeed)) - k >= 3 ? "easing" : "steady") : null;
    var call = id === "C0S810" ? windCallDonghe(num(last.WindSpeed), dir) : null;
    if (call === "light & variable") call = null; // already said "light"
    return { name: STATION_NAME_EN[s.name] || s.name || id, text: Math.round(k) + " kt" + (dir !== null ? " " + degToCompass(dir) : "") + " · " + windStrength(k) + (trend ? ", " + trend : "") + (call ? " · " + call : "") };
  }
  function renderObservationSummary(history) {
    var order = ["C0S810", "C0SA30", "C0T9I0"];
    var lines = order.filter(function (id) { return history[id]; }).map(function (id) { return stationWindLine(id, history[id]); }).filter(Boolean);
    setSummary("observations", lines.length ? lines.map(function (l) { return "<b>" + escapeHtml(l.name) + "</b> " + l.text; }).join("; ") : "Land-station wind, last 16 hours");
  }

  /* ---------- Buoys: WaveSlave's method, with the user's thresholds ----------
     Over the last 12 hours of readings, average the first three and the last
     three. Height building/dropping at a 0.3 m change (0.15 m was too twitchy
     for these buoys — about half of all windows flagged), period rising/
     dropping at 1 s; otherwise holding. */
  function buoyTrend(st) {
    var rs = (st.Readings || []).map(function (r) { return { t: new Date(r.DateTime).getTime(), h: num(r.WaveHeight), p: num(r.WavePeriod) }; }).filter(function (r) { return r.h !== null; });
    if (rs.length < 4) return null;
    var end = rs[rs.length - 1].t, w = rs.filter(function (r) { return r.t > end - 12 * 3600000; });
    if (w.length < 4) return null;
    var first = w.slice(0, 3), lastN = w.slice(-3);
    var h0 = mean(first.map(function (r) { return r.h; })), h1 = mean(lastN.map(function (r) { return r.h; }));
    var p0 = mean(first.map(function (r) { return r.p; }).filter(function (v) { return v !== null; })), p1 = mean(lastN.map(function (r) { return r.p; }).filter(function (v) { return v !== null; }));
    var peak = w.reduce(function (a, r) { return r.h > a.h ? r : a; });
    var latest = w[w.length - 1];
    return {
      name: st.Label, latest: latest,
      size: h1 - h0 >= 0.3 ? "building" : h0 - h1 >= 0.3 ? "dropping" : "holding",
      period: p0 === null || p1 === null ? null : p1 - p0 >= 1 ? "rising" : p0 - p1 >= 1 ? "dropping" : "holding",
      h0: h0, h1: h1, peak: peak,
    };
  }
  function renderBuoySummary(buoy) {
    var trends = ((buoy.records && buoy.records.Stations) || []).map(buoyTrend).filter(Boolean);
    function short(t) { return "<b>" + escapeHtml(t.name) + "</b> " + n1(t.latest.h) + " m, " + t.size + (t.latest.p !== null ? " · " + n1(t.latest.p) + " s" + (t.period ? ", " + t.period : "") : ""); }
    // The bar shows the two buoys nearest Donghe; each card carries its own trend line.
    var near = trends.filter(function (t) { return t.name === "Chenggong" || t.name === "Taitung"; });
    setSummary("buoys", near.length ? near.map(short).join("; ") : trends.length ? trends.map(short).join("; ") : "Sea state at five buoys, last 24 hours");
  }
  /* ---------- Rain: next 24 h at Donghe, as two 12-hour blocks ----------
     From data/rain.json: the amount band read off CWA's QPF maps at Donghe,
     the chance from CWA's township forecast (see buildRain in the fetch
     script). Always two 12-hour blocks (user's choice 2026-10-14). */
  function rainMmText(mm) {
    if (!mm) return "no rain predicted";
    if (mm.max === null) return mm.min + "+ mm predicted";
    if (mm.min < 1) return "under 1 mm predicted";
    return mm.min + "–" + mm.max + " mm predicted";
  }
  function renderRainSummary(rain) {
    var now = Date.now(), parts = [];
    (rain.blocks || []).forEach(function (b) {
      var s = Date.parse(b.start), e = Date.parse(b.end);
      if (e <= now) return; // an old map whose window has passed
      var span = s <= now ? "until " + fmtHMx.format(e) : fmtHMx.format(s) + "–" + fmtHMx.format(e);
      parts.push((b.pop !== null && b.pop !== undefined ? b.pop + "% chance of rain " : "Rain ") + span + ", " + rainMmText(b.mm));
    });
    if (parts.length) setSummary("qpf", parts.join(" · then "));
  }

  // One-line trend at the top of each buoy's card.
  function buoyTrendText(t) {
    return "Size <b>" + t.size + "</b>" + (t.period ? " · period <b>" + t.period + "</b>" : "") +
      ' <span class="sec-list-sub">(' + n1(t.h0) + " → " + n1(t.h1) + " m on average over 12 h · peak " + n1(t.peak.h) + " m at " + fmtHMx.format(t.peak.t) + ")</span>";
  }

  loadAll();
})();
