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
  var ASSET_VERSION = "2026-09-22a";
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
      renderMoonWidget();
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

  function renderMoonWidget() {
    var el = document.getElementById("moonWidget");
    if (!el) return;
    var info = moonPhaseInfo(new Date());
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

  /* --- Independent wave forecast (Open-Meteo Marine API / NOAA GFS-Wave) ---
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

  function loadAll() {
    fetchJSON("data/township.json").then(renderTownship).catch(function (e) { showError("townshipTable", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/coastal.json").then(renderCoastal).catch(function (e) { showError("coastalTable", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/tide.json").then(renderTide).catch(function (e) { showError("tideChart", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/stations-history.json").then(renderStationsHistory).catch(function (e) { showError("stationContainer", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/buoy.json").then(renderBuoy).catch(function (e) { showError("buoyContainer", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/openwave.json").then(renderOpenWave).catch(function (e) { showError("openWaveChart", "Couldn't load this data (" + e.message + ")"); });

    fetchJSON("data/typhoon.json").then(renderTyphoon).catch(function () { /* no feed, panel stays hidden */ });

    fetchJSON("data/astronomy.json").then(renderAstronomy).catch(function () { /* section stays empty */ });

    fetchJSON("data/update-log.json").then(function (log) {
      updateLog = log;
      renderAllUpdateLines();
    }).catch(function () { /* no update lines until the log exists */ });

    fetchJSON("data/meta.json")
      .then(renderFreshness)
      .catch(function () { renderFreshness(null); });
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

      // Swell arrival. The model's own timing leads because it accounts for
      // refraction and island shadowing; the great-circle figure follows as a
      // rough cross-check, and the two disagreeing is expected (dispersion
      // means the first energy to arrive runs faster than the reported
      // period). Only shown when the swell bearing actually matches this
      // storm — see the attribution in buildTyphoon.
      if (s.swell) {
        var sw = s.swell;
        var txt = "Swell expected to arrive <strong>" + fmtDonghe(sw.targetTime) + "</strong> (" +
          n1(sw.heightM) + "m, " + n1(sw.periodS) + "s from " + degToCompass(sw.dirDeg) + ")";
        if (sw.peak && sw.peak.targetTime !== sw.targetTime) {
          txt += " and grow to <strong>" + n1(sw.peak.heightM) + "m, " + n1(sw.peak.periodS) + "s</strong> by " +
            fmtDonghe(sw.peak.targetTime);
        }
        // No "Swell" label here — the sentence already starts with the word.
        html += '<p class="typhoon-swell">🌊 ' + txt + "</p>";
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

    // Formation alerts — between "watching an area" and a numbered warning.
    // Listed before invests because an alert means JTWC thinks something is
    // about to happen, and it carries a hard decision deadline.
    (data.alerts || []).forEach(function (a) {
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
    renderUpdateLine("townshipUpdated", "township");
    renderUpdateLine("tideUpdated", "tide");
  }

  /* ---------- Sunrise / sunset / astronomical calendar ----------
     From CWA's own per-year astronomy files (see buildAstronomy in
     scripts/fetch-data.mjs). The calendar genuinely has gaps — most days
     carry no phenomenon and no solar term — so anything missing is simply
     omitted rather than rendered as a dash. */
  function renderAstronomy(data) {
    var el = document.getElementById("astronomy");
    var srcEl = document.getElementById("astroSource");
    if (!el) return;
    function showSource(on) { if (srcEl) srcEl.hidden = !on; }
    try {
      var todayKey = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      var d = data && data.days && data.days[todayKey];
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

  loadAll();
})();
