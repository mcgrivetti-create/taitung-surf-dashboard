(function () {
  "use strict";

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
  function sixHourTicks(xMin, xMax) {
    var ticks = [];
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
    t.setHours((Math.floor(t.getHours() / 6) + 1) * 6);
    var prevDay = new Date(start).getDate();
    while (t.getTime() <= xMax) {
      var day = t.getDate();
      ticks.push({
        x: t.getTime(),
        label: label(t.getTime()),
        sublabel: day !== prevDay ? t.toLocaleDateString("en-US", { weekday: "short" }) : "",
      });
      prevDay = day;
      t = new Date(t.getTime() + 6 * 3600 * 1000);
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
      var times = (elements["浪高"] || elements["風速"] || []).slice(0, 16);
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
          fmtTime(t.DataTime), n1(waveHeight(i)), n1(wavePeriod(i)),
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
        var windScaleSeries = times.map(function (t, i) { return { x: xs[i], y: beaufortScale(windSpeed(i)) }; });
        var waveSVG = lineChartSVG(waveSeries, waveChartOpts(waveSeries, { width: 640, height: 190, xTicks: xTicks }));
        var windSVG = lineChartSVG(windScaleSeries, { width: 640, height: 140, unit: "", yMin: 0, xTicks: xTicks });
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
        var series = readings.map(function (r) { return { x: new Date(r.DateTime).getTime(), y: Number(r.WindScale) }; });
        var xMin = series.length ? series[0].x : Date.now();
        var xMax = series.length ? series[series.length - 1].x : Date.now();
        var xTicks = historySixHourTicks(xMin, xMax);
        // Beaufort tiers, same idea as waveChartOpts: a stable axis so the three
        // station cards stay comparable, stepping up only when it's really blowing.
        var bMax = 0;
        series.forEach(function (p) { if (isFinite(p.y) && p.y > bMax) bMax = p.y; });
        var svg = lineChartSVG(series, {
          width: 600, height: 120, area: true, unit: "", padLeft: 26,
          yMin: 0, yMax: bMax <= 6 ? 6 : 12, gridStep: bMax <= 6 ? 1 : 2,
          xTicks: xTicks,
        });

        html += '<div class="buoy-card">';
        html += "<h3>" + name + " <span class=\"en\">(" + id + ")</span></h3>";
        html += '<div class="buoy-chart-label">Wind Scale (Beaufort) — last 16h</div>' + (svg || '<p class="loading">Still collecting data (populates hourly)</p>');
        html += '<div class="buoy-stats">';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Wind Speed</span><span class="buoy-stat-value">' + (latest.WindSpeed !== undefined ? n1(latest.WindSpeed) : "—") + ' m/s</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Direction</span><span class="buoy-stat-value">' + (latest.WindDirection !== undefined ? latest.WindDirection + "°" : "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Scale</span><span class="buoy-stat-value">' + (latest.WindScale !== undefined ? latest.WindScale : "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">As of</span><span class="buoy-stat-value">' + fmtTime(latest.DateTime) + '</span></div>';
        html += "</div>";

        // Full 16-hour reading list under the chart (same pattern as the buoy cards).
        var stationRows = readings.slice().reverse().map(function (r) {
          return [
            fmtHour(r.DateTime),
            n1(r.WindSpeed),
            r.WindDirection !== undefined ? r.WindDirection + "°" + dirArrowHtml(r.WindDirection) : "",
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
            h.wave_direction[i] !== undefined ? Math.round(h.wave_direction[i]) + "°" + dirArrowHtml(h.wave_direction[i]) : "",
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

    fetchJSON("data/meta.json").then(function (meta) {
      var el = document.getElementById("lastUpdated");
      if (el && meta && meta.updatedAt) {
        el.textContent = "Updated " + fmtTime(meta.updatedAt);
      }
    }).catch(function () { /* ignore */ });
  }

  document.addEventListener("click", function (ev) {
    if (ev.target && ev.target.id === "tidePrevBtn") renderTideDay(tideDayIndex - 1);
    if (ev.target && ev.target.id === "tideNextBtn") renderTideDay(tideDayIndex + 1);
  });

  loadAll();
})();
