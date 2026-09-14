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

  /* --- Township forecast (F-D0047-093) --- */
  function renderTownship(data) {
    try {
      var loc = data.records.locations[0].location[0];
      var elements = {};
      loc.weatherElement.forEach(function (we) { elements[we.elementName] = we.time; });
      var times = (elements.Wx || elements.T || []).slice(0, 8);
      var rows = times.map(function (t, i) {
        var start = t.startTime || (t.dataTime);
        function val(name) {
          var arr = elements[name];
          if (!arr || !arr[i]) return "";
          var ev = arr[i].elementValue || arr[i].parameterSet || arr[i];
          if (Array.isArray(ev)) return ev[0].value || ev[0].parameterName || "";
          if (ev && ev.value !== undefined) return ev.value;
          return "";
        }
        return [fmtTime(start), val("Wx"), val("T") + "°C", val("PoP12") + "%", val("WS") ];
      });
      renderTable("townshipTable", ["時間", "天氣", "氣溫", "降雨機率", "風速"], rows);
    } catch (e) {
      showError("townshipTable", "資料格式解析失敗 (" + e.message + ")");
    }
  }

  /* --- Coastal 3-day forecast (F-D0047-095) --- */
  function renderCoastal(data) {
    try {
      var loc = data.records.locations[0].location[0];
      var elements = {};
      loc.weatherElement.forEach(function (we) { elements[we.elementName] = we.time; });
      var times = (elements.WaveHeight || elements.WH || elements.WindSpeed || []).slice(0, 12);
      var rows = times.map(function (t, i) {
        var start = t.startTime || t.dataTime;
        function val(name) {
          var arr = elements[name];
          if (!arr || !arr[i]) return "";
          var ev = arr[i].elementValue;
          if (Array.isArray(ev)) return ev[0].value || "";
          return "";
        }
        return [fmtTime(start), val("WaveHeight") || val("WH"), val("WavePeriod") || val("WP"), val("WindSpeed") || val("WS"), val("WindDirection") || val("WD")];
      });
      renderTable("coastalTable", ["時間", "浪高(m)", "浪週期(s)", "風速", "風向"], rows);
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

  /* --- Buoy / sea state (O-B0076-001) --- */
  function renderBuoy(data) {
    try {
      var stations = data.records.Station || data.records.SeaSurfaceObs || [];
      var rows = stations.map(function (s) {
        var we = s.WeatherElement || s.SeaSurfaceObs || {};
        return [s.StationName || s.StationId, fmtTime(s.ObsTime && s.ObsTime.DateTime), we.WaveHeight, we.WavePeriod, we.SeaTemperature || we.WaterTemperature, we.WindSpeed];
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
