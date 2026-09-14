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
  var STATION_NAME_EN = { "東河": "Donghe", "都歷": "Dulih", "豐濱": "Fengbin" };

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

  /* ---------- Tiny SVG line-chart builder (no external deps) ---------- */
  function lineChartSVG(series, opts) {
    opts = opts || {};
    var w = opts.width || 600, h = opts.height || 160, pad = { t: 14, r: 14, b: 22, l: 34 };
    var xs = series.map(function (p) { return p.x; });
    var ys = series.map(function (p) { return p.y; }).filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (!ys.length) return "";
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var yMin = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, ys);
    var yMax = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, ys);
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    var pd = (yMax - yMin) * 0.1;
    yMin -= pd; yMax += pd;
    function sx(x) { return pad.l + (xMax === xMin ? 0 : (x - xMin) / (xMax - xMin)) * (w - pad.l - pad.r); }
    function sy(y) { return h - pad.b - (y - yMin) / (yMax - yMin) * (h - pad.t - pad.b); }

    var linePts = series.filter(function (p) { return p.y !== null && p.y !== undefined && !isNaN(p.y); })
      .map(function (p) { return sx(p.x) + "," + sy(p.y); });
    var pathD = "M" + linePts.join(" L");
    var areaD = pathD + " L" + sx(xMax) + "," + sy(yMin) + " L" + sx(xMin) + "," + sy(yMin) + " Z";

    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" style="display:block;overflow:visible" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
    if (opts.area) svg += '<path d="' + areaD + '" fill="var(--accent)" opacity="0.15" stroke="none"></path>';
    svg += '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"></path>';

    // y-axis min/max labels
    svg += '<text x="2" y="' + (sy(yMax) + 4) + '" font-size="10" fill="var(--text-dim)">' + Math.round(yMax * 10) / 10 + (opts.unit || "") + '</text>';
    svg += '<text x="2" y="' + (sy(yMin) + 4) + '" font-size="10" fill="var(--text-dim)">' + Math.round(yMin * 10) / 10 + (opts.unit || "") + '</text>';

    // x-axis tick labels
    (opts.xTicks || []).forEach(function (t) {
      svg += '<text x="' + sx(t.x) + '" y="' + (h - 6) + '" font-size="10" fill="var(--text-dim)" text-anchor="middle">' + t.label + "</text>";
    });

    // marker dots
    (opts.markers || []).forEach(function (m) {
      svg += '<circle cx="' + sx(m.x) + '" cy="' + sy(m.y) + '" r="3" fill="var(--accent-2)"></circle>';
      if (m.label) svg += '<text x="' + sx(m.x) + '" y="' + (sy(m.y) - 8) + '" font-size="10" fill="var(--text-dim)" text-anchor="middle">' + m.label + "</text>";
    });

    // "now" vertical line
    if (opts.nowX !== undefined && opts.nowX >= xMin && opts.nowX <= xMax) {
      svg += '<line x1="' + sx(opts.nowX) + '" y1="' + pad.t + '" x2="' + sx(opts.nowX) + '" y2="' + (h - pad.b) + '" stroke="var(--danger)" stroke-width="1" stroke-dasharray="3,3"></line>';
    }

    svg += "</svg>";
    return svg;
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
      var rows = times.map(function (t, i) {
        var wd = windDirRaw(i);
        return [fmtTime(t.DataTime), waveHeight(i), wavePeriod(i), windSpeed(i), wd ? translateDirText(wd) : ""];
      });
      renderTable("coastalTable", ["Time", "Wave Ht (m)", "Wave Period (s)", "Wind (m/s)", "Wind Dir"], rows);
    } catch (e) {
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

    var markers = day.extrema.map(function (p) { return { x: p.t, y: p.h, label: (p.tideEn) + " " + Math.round(p.h) + "cm" }; });
    var xTicks = [0, 6, 12, 18, 24].map(function (hr) { return { x: dayStart + hr * 3600000, label: (hr === 24 ? "24" : hr) + ":00" }; });
    var now = Date.now();
    var svg = lineChartSVG(series, {
      width: 640, height: 170, area: true, unit: "cm",
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

      // Trimmed table: only today + tomorrow
      var rows = [];
      tideDaysCache.slice(0, 2).forEach(function (day) {
        day.extrema.forEach(function (e) {
          rows.push([day.date, fmtTime(new Date(e.t).toISOString()), e.tideEn, Math.round(e.h)]);
        });
      });
      renderTable("tideTable", ["Date", "Time", "Tide", "Height (cm)"], rows);
    } catch (e) {
      showError("tideChart", "Couldn't parse this data (" + e.message + ")");
      showError("tideTable", "Couldn't parse this data (" + e.message + ")");
    }
  }

  /* --- Station observations (O-A0001-001), 8-hour rolling history from stations-history.json --- */
  function renderStationsHistory(history) {
    try {
      var rows = [];
      Object.keys(history).sort().forEach(function (id) {
        var s = history[id];
        var name = STATION_NAME_EN[s.name] || s.name || id;
        (s.readings || []).slice().reverse().forEach(function (r) {
          // WindDirection here is a compass degree (e.g. "44.0"), not Chinese text — no translation needed.
          rows.push([name, fmtHour(r.DateTime), r.WindSpeed, r.WindDirection, r.WindScale]);
        });
      });
      renderTable("stationTable", ["Station", "Time", "Wind Speed (m/s)", "Wind Dir (°)", "Scale"], rows);
    } catch (e) {
      showError("stationTable", "Couldn't parse this data (" + e.message + ")");
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
        var xTicks = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
          var x = xMin + f * (xMax - xMin);
          return { x: x, label: fmtHour(new Date(x).toISOString()) };
        });
        var heightSVG = lineChartSVG(heightSeries, { width: 600, height: 110, area: true, unit: "m", xTicks: xTicks });
        var periodSVG = lineChartSVG(periodSeries, { width: 600, height: 110, unit: "s", xTicks: xTicks });

        html += '<div class="buoy-card">';
        html += "<h3>" + st.Label + " <span class=\"en\">(" + st.StationID + ")</span></h3>";
        html += '<div class="buoy-chart-label">Wave Height — last 24h</div>' + (heightSVG || '<p class="loading">No data</p>');
        html += '<div class="buoy-chart-label">Wave Period — last 24h</div>' + (periodSVG || '<p class="loading">No data</p>');
        html += '<div class="buoy-stats">';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Wave Height</span><span class="buoy-stat-value">' + (latest.WaveHeight || "—") + ' m</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Period</span><span class="buoy-stat-value">' + (latest.WavePeriod || "—") + ' s</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Direction</span><span class="buoy-stat-value">' + (latest.WaveDirectionDescription || "—") + '</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">Sea Temp</span><span class="buoy-stat-value">' + (latest.SeaTemperature || "—") + ' °C</span></div>';
        html += '<div class="buoy-stat"><span class="buoy-stat-label">As of</span><span class="buoy-stat-value">' + fmtTime(latest.DateTime) + '</span></div>';
        html += "</div></div>";
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
        return { x: x, label: new Date(x).toLocaleDateString("en-US", { weekday: "short" }) };
      });
      var svg = lineChartSVG(series, { width: 640, height: 170, area: true, unit: "m", xTicks: xTicks });
      var chartEl = document.getElementById("openWaveChart");
      if (chartEl) chartEl.innerHTML = svg || '<p class="loading">No wave curve available</p>';

      var rows = [];
      h.time.forEach(function (t, i) {
        if (toDate(t).getHours() % 6 === 0) {
          rows.push([
            fmtTime(toDate(t).toISOString()),
            h.wave_height[i],
            h.wave_period[i],
            h.wave_direction[i] !== undefined ? Math.round(h.wave_direction[i]) + "°" : "",
            h.swell_wave_height[i],
            h.swell_wave_period[i],
          ]);
        }
      });
      renderTable("openWaveTable", ["Time", "Wave Ht (m)", "Period (s)", "Direction", "Swell Ht (m)", "Swell Period (s)"], rows.slice(0, 20));
    } catch (e) {
      showError("openWaveChart", "Couldn't parse this data (" + e.message + ")");
      showError("openWaveTable", "Couldn't parse this data (" + e.message + ")");
    }
  }

  function loadAll() {
    fetchJSON("data/township.json").then(renderTownship).catch(function (e) { showError("townshipTable", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/coastal.json").then(renderCoastal).catch(function (e) { showError("coastalTable", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/tide.json").then(renderTide).catch(function (e) { showError("tideTable", "Couldn't load this data (" + e.message + ")"); });
    fetchJSON("data/stations-history.json").then(renderStationsHistory).catch(function (e) { showError("stationTable", "Couldn't load this data (" + e.message + ")"); });
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
