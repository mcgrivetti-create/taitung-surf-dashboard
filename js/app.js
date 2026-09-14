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

  /* ---------- Windguru widget injection ---------- */
  (function loadWindguru() {
    var container = document.getElementById("windguru-embed");
    if (!container) return;
    var uid = "wg-fwdg-218382-100-" + Date.now();
    container.id = uid;
    window.WGWidgetOverride = window.WGWidgetOverride || {};
    var script = document.createElement("script");
    script.src = "https://www.windguru.cz/js/widget.php";
    script.async = true;
    document.body.appendChild(script);
    var checkInterval = setInterval(function () {
      if (window.GWidget) {
        clearInterval(checkInterval);
        window.GWidget(uid, { d: 1, i: 218382, w: "100%", h: 300, uid: uid });
      }
    }, 200);
    setTimeout(function () { clearInterval(checkInterval); }, 8000);
  })();

  /* ---------- CWA data loading ---------- */
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
      return d.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return iso;
    }
  }

  function renderTable(elId, headers, rows) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="loading">目前無資料</p>';
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

  /* --- Township forecast (F-D0047-039) ---
     Real schema: records.locations[0].location[0].WeatherElement[]
     = { ElementName (Chinese), Time: [{ StartTime, EndTime, ElementValue: {...} }] } */
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
          var v = arr[i].ElementValue[field];
          return v === undefined || v === "" ? "" : v + (unit || "");
        };
      }
      var wx = val("天氣現象", "Weather");
      var temp = val("平均溫度", "Temperature", "°C");
      var pop = val("12小時降雨機率", "ProbabilityOfPrecipitation", "%");
      var wind = val("風速", "WindSpeed", " m/s");
      var rows = times.map(function (t, i) {
        return [fmtTime(t.StartTime), wx(i), temp(i), pop(i), wind(i)];
      });
      renderTable("townshipTable", ["時間", "天氣", "氣溫", "降雨機率", "風速"], rows);
    } catch (e) {
      showError("townshipTable", "資料格式解析失敗 (" + e.message + ")");
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
          var v = arr[i].ElementValue[field];
          return v === undefined ? "" : v;
        };
      }
      var waveHeight = val("浪高", "WaveHeight");
      var wavePeriod = val("浪週期", "WavePeriod");
      var windSpeed = val("風速", "WindSpeed");
      var windDir = val("風向", "WindDirection");
      var rows = times.map(function (t, i) {
        return [fmtTime(t.DataTime), waveHeight(i), wavePeriod(i), windSpeed(i), windDir(i)];
      });
      renderTable("coastalTable", ["時間", "浪高(m)", "浪週期(s)", "風速(m/s)", "風向"], rows);
    } catch (e) {
      showError("coastalTable", "資料格式解析失敗 (" + e.message + ")");
    }
  }

  /* --- Tide forecast (F-A0021-001) --- */
  function renderTide(data) {
    try {
      var tf = (data.records.TideForecasts || data.records.locations)[0];
      var loc = tf.Location || tf;
      var daily = loc.TimePeriods.Daily || loc.TimePeriods;
      var rows = [];
      daily.slice(0, 3).forEach(function (day) {
        (day.Time || []).forEach(function (t) {
          rows.push([day.Date || "", fmtTime(t.DateTime), t.Tide || "", (t.TideHeights && (t.TideHeights.AboveTWVD || t.TideHeights.AboveLocalMSL)) || ""]);
        });
      });
      renderTable("tideTable", ["日期", "時間", "潮汐", "潮高(cm)"], rows);
    } catch (e) {
      showError("tideTable", "資料格式解析失敗 (" + e.message + ")");
    }
  }

  /* --- Station observations (O-A0001-001) --- */
  function renderStations(data) {
    try {
      var stations = data.records.Station || [];
      var rows = stations.map(function (s) {
        var we = s.WeatherElement || {};
        return [s.StationName || s.StationId, fmtTime(s.ObsTime && s.ObsTime.DateTime), we.AirTemperature, we.WindSpeed, we.WindDirection, we.RelativeHumidity];
      });
      renderTable("stationTable", ["測站", "觀測時間", "氣溫(°C)", "風速(m/s)", "風向(°)", "濕度(%)"], rows);
    } catch (e) {
      showError("stationTable", "資料格式解析失敗 (" + e.message + ")");
    }
  }

  /* --- Buoy / sea state (O-B0075-001) ---
     Schema not yet confirmed against a real payload, so this flattens each
     station record to its leaf fields and matches by keyword rather than
     an exact key name — resilient to whatever casing/nesting CWA uses. */
  function flattenLeaves(obj, out) {
    out = out || {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        flattenLeaves(v, out);
      } else if (!Array.isArray(v)) {
        out[k] = v;
      }
    });
    return out;
  }

  function findByKeywords(flat, keywords) {
    var keys = Object.keys(flat);
    for (var i = 0; i < keys.length; i++) {
      var kl = keys[i].toLowerCase();
      if (keywords.every(function (kw) { return kl.indexOf(kw) >= 0; })) return flat[keys[i]];
    }
    return "";
  }

  function renderBuoy(data) {
    try {
      var stations = data.records.Station || [];
      var rows = stations.map(function (s) {
        var flat = flattenLeaves(s);
        return [
          "成功 (46761F)",
          fmtTime(findByKeywords(flat, ["time"])),
          findByKeywords(flat, ["wave", "height"]),
          findByKeywords(flat, ["wave", "period"]),
          findByKeywords(flat, ["sea", "temp"]) || findByKeywords(flat, ["water", "temp"]),
          findByKeywords(flat, ["wind", "speed"]),
        ];
      });
      renderTable("buoyTable", ["測站", "觀測時間", "浪高(m)", "週期(s)", "海溫(°C)", "風速(m/s)"], rows);
    } catch (e) {
      showError("buoyTable", "資料格式解析失敗 (" + e.message + ")");
    }
  }

  function loadAll() {
    fetchJSON("data/township.json").then(renderTownship).catch(function (e) { showError("townshipTable", "無法載入 (" + e.message + ")"); });
    fetchJSON("data/coastal.json").then(renderCoastal).catch(function (e) { showError("coastalTable", "無法載入 (" + e.message + ")"); });
    fetchJSON("data/tide.json").then(renderTide).catch(function (e) { showError("tideTable", "無法載入 (" + e.message + ")"); });
    fetchJSON("data/stations.json").then(renderStations).catch(function (e) { showError("stationTable", "無法載入 (" + e.message + ")"); });
    fetchJSON("data/buoy.json").then(renderBuoy).catch(function (e) { showError("buoyTable", "無法載入 (" + e.message + ")"); });

    fetchJSON("data/meta.json").then(function (meta) {
      var el = document.getElementById("lastUpdated");
      if (el && meta && meta.updatedAt) {
        el.textContent = "更新於 " + fmtTime(meta.updatedAt);
      }
    }).catch(function () { /* ignore */ });
  }

  loadAll();
})();
