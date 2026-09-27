// ==UserScript==
// @name         Dota2-KickGSI
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automatically opens and resolves native Kick predictions based on Dota 2 game state.
// @author       Egezenn
// @match        *://dashboard.kick.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kick.com
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG_PREFIX = "[Dota 2 GSI Kick Prediction]";

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function logError(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  let ws = null;
  let reconnectTimeout = null;

  let toggleBtn, popup, enableToggle, reloadBtn, shutdownBtn;
  let statusDot, statusText, statusInterval = null;

  function getStorage(key, defaultValue) {
    try {
      const val = localStorage.getItem(`dota2_kickgsi_${key}`);
      if (val !== null) return JSON.parse(val);
    } catch (e) {
      logError("Error reading storage:", e);
    }
    return defaultValue;
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(`dota2_kickgsi_${key}`, JSON.stringify(value));
    } catch (e) {
      logError("Error writing storage:", e);
    }
  }

  function getAuthToken() {
    try {
      const match = document.cookie.match(
        /(^|;)\s*session_token\s*=\s*([^;]+)/,
      );
      if (match) {
        const val = decodeURIComponent(match[2]);
        if (val && val.includes("|") && /^\d+\|[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
      }
    } catch (e) {
      logError("Error reading session cookie:", e);
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && val.includes("|") && /^\d+\|[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        if (val && val.includes("|") && /^\d+\|[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
      }
    } catch (e) {
      logError("Error reading storage:", e);
    }
    return null;
  }

  let isConnected = false;
  let hasAlertedOffline = false;
  let isClosingIntentionally = false;
  let isAttemptingConnection = false;

  function connectWebSocket(force = false) {
    if (isAttemptingConnection && !force) {
      return;
    }
    isAttemptingConnection = true;

    const enabled = getStorage("enabled", true);
    if (enabled === false) {
      log("WebSocket connection skipped (disabled).");
      isAttemptingConnection = false;
      return;
    }

    if (
      !force &&
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      isAttemptingConnection = false;
      return;
    }

    if (ws) {
      isClosingIntentionally = true;
      ws.close();
    }

    log("Connecting to GSI Server WebSocket...");
    ws = new WebSocket("ws://127.0.0.1:4149/ws");

    ws.onopen = () => {
      isConnected = true;
      hasAlertedOffline = false;
      isAttemptingConnection = false;
      log("WebSocket connection established.");

      ws.send(JSON.stringify({ type: "init", url: window.location.href }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        log("Received event:", data);

        if (data.action === "create") {
          await handleCreatePrediction(data);
        } else if (data.action === "resolve") {
          await handleResolvePrediction(data);
        }
      } catch (err) {
        logError("Error handling WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      isAttemptingConnection = false;
      if (isClosingIntentionally) {
        isClosingIntentionally = false;
        isConnected = false;
        return;
      }

      if (isConnected) {
        log("WebSocket server disconnected. Retrying in 5 seconds...");
      } else {
        log(
          "Local GSI background server is offline. Retrying in 5 seconds...",
        );
        if (!hasAlertedOffline) {
          hasAlertedOffline = true;
          logError(
            "Local background server is offline. Please make sure DotaKickGSI is running.",
          );
        }
      }
      isConnected = false;
      clearTimeout(reconnectTimeout);

      const enabled = getStorage("enabled", true);
      if (enabled !== false) {
        reconnectTimeout = setTimeout(connectWebSocket, 5000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function getXsrfToken() {
    const match = document.cookie.match(/(^|;)\s*XSRF-TOKEN\s*=\s*([^;]+)/);
    return match ? decodeURIComponent(match[2]) : null;
  }

  async function handleCreatePrediction(data) {
    const token = getAuthToken();
    const xsrf = getXsrfToken();
    const slug = data.channel_slug;
    const url = `https://kick.com/api/v2/channels/${slug}/predictions`;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-app-platform": "web",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (xsrf) {
      headers["X-XSRF-TOKEN"] = xsrf;
    }

    log("Creating prediction via browser fetch...");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        credentials: "same-origin",
        body: JSON.stringify({
          title: data.title,
          outcomes: data.outcomes,
          duration: data.duration,
        }),
      });

      const resData = await response.json();
      if (response.ok) {
        log("Prediction created successfully:", resData);
        ws.send(
          JSON.stringify({
            type: "created_success",
            prediction_id: resData.data.id,
            outcomes: resData.data.outcomes,
          }),
        );
      } else {
        logError("Fail to create prediction:", resData);
        ws.send(
          JSON.stringify({
            type: "error",
            message: resData.message || "Failed to create",
          }),
        );
      }
    } catch (e) {
      logError("Fetch error during creation:", e);
      ws.send(JSON.stringify({ type: "error", message: e.toString() }));
    }
  }

  async function handleResolvePrediction(data) {
    const token = getAuthToken();
    const xsrf = getXsrfToken();
    const slug = data.channel_slug;
    const predictionId = data.prediction_id;
    const url = `https://kick.com/api/v2/channels/${slug}/predictions/${predictionId}`;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-app-platform": "web",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (xsrf) {
      headers["X-XSRF-TOKEN"] = xsrf;
    }

    log("Resolving prediction via browser fetch...");
    try {
      log("- Step 1: Locking prediction...");
      const lockResponse = await fetch(url, {
        method: "PATCH",
        headers: headers,
        credentials: "same-origin",
        body: JSON.stringify({
          state: "LOCKED",
        }),
      });

      const lockResData = await lockResponse.json();
      if (!lockResponse.ok) {
        logError("Fail to lock prediction:", lockResData);
        ws.send(
          JSON.stringify({
            type: "error",
            message: lockResData.message || "Failed to lock",
          }),
        );
        return;
      }
      log("Prediction locked successfully:", lockResData);

      log("- Step 2: Resolving prediction to winner...");
      const resolveResponse = await fetch(url, {
        method: "PATCH",
        headers: headers,
        credentials: "same-origin",
        body: JSON.stringify({
          state: "RESOLVED",
          winning_outcome_id: data.winning_outcome_id,
        }),
      });

      const resolveResData = await resolveResponse.json();
      if (resolveResponse.ok) {
        log("Prediction resolved successfully:", resolveResData);
        ws.send(
          JSON.stringify({
            type: "resolved_success",
            prediction_id: predictionId,
          }),
        );
      } else {
        logError("Fail to resolve prediction:", resolveResData);
        ws.send(
          JSON.stringify({
            type: "error",
            message: resolveResData.message || "Failed to resolve",
          }),
        );
      }
    } catch (e) {
      logError("Fetch error during resolution process:", e);
      ws.send(JSON.stringify({ type: "error", message: e.toString() }));
    }
  }

  function initPopup() {
    if (document.getElementById("dota2-kickgsi-popup-root")) {
      return;
    }

    const root = document.createElement("div");
    root.id = "dota2-kickgsi-popup-root";
    root.innerHTML = `
      <div id="dota2-kickgsi-toggle-btn" title="Dota2 KickGSI">⚡</div>
      <div id="dota2-kickgsi-popup" style="display:none;">
        <div class="dota2-kickgsi-header">
          <span>Dota2-KickGSI</span>
          <span id="dota2-kickgsi-status-badge">
            <span id="dota2-kickgsi-status-dot" class="status-dot"></span>
            <span id="dota2-kickgsi-status-text">Checking...</span>
          </span>
        </div>
        <div class="dota2-kickgsi-card">
          <div class="dota2-kickgsi-row">
            <div class="dota2-kickgsi-label-group">
              <span class="dota2-kickgsi-label-title">Prediction Automator</span>
              <span class="dota2-kickgsi-label-desc">Toggle background GSI automation</span>
            </div>
            <label class="dota2-kickgsi-switch">
              <input type="checkbox" id="dota2-kickgsi-enable-toggle" />
              <span class="dota2-kickgsi-slider"></span>
            </label>
          </div>
        </div>
        <button id="dota2-kickgsi-reload-btn" class="dota2-kickgsi-btn dota2-kickgsi-btn-primary">🔄 Reload config.json</button>
        <button id="dota2-kickgsi-shutdown-btn" class="dota2-kickgsi-btn dota2-kickgsi-btn-danger">⚡ Shutdown GSI Server</button>
      </div>
    `;

    document.body.appendChild(root);

    toggleBtn = document.getElementById("dota2-kickgsi-toggle-btn");
    popup = document.getElementById("dota2-kickgsi-popup");
    enableToggle = document.getElementById("dota2-kickgsi-enable-toggle");
    reloadBtn = document.getElementById("dota2-kickgsi-reload-btn");
    shutdownBtn = document.getElementById("dota2-kickgsi-shutdown-btn");
    statusDot = document.getElementById("dota2-kickgsi-status-dot");
    statusText = document.getElementById("dota2-kickgsi-status-text");

    const enabled = getStorage("enabled", true);
    enableToggle.checked = enabled !== false;

    if (enabled !== false) {
      startStatusCheck();
    }

    toggleBtn.addEventListener("click", () => {
      const isVisible = popup.style.display !== "none";
      popup.style.display = isVisible ? "none" : "block";
    });

    enableToggle.addEventListener("change", () => {
      setStorage("enabled", enableToggle.checked);
      log("Automator enabled state set to:", enableToggle.checked);
      if (!enableToggle.checked) {
        if (ws) {
          isClosingIntentionally = true;
          ws.close();
        }
        clearTimeout(reconnectTimeout);
        clearInterval(statusInterval);
        statusInterval = null;
      } else {
        connectWebSocket();
        startStatusCheck();
      }
    });

    function startStatusCheck() {
      clearInterval(statusInterval);
      statusDot.className = "status-dot online";
      statusText.textContent = "Online";
      statusText.style.color = "var(--success, #53fc18)";
      statusInterval = setInterval(checkServerStatus, 2000);
    }

    reloadBtn.addEventListener("click", async () => {
      try {
        reloadBtn.disabled = true;
        reloadBtn.textContent = "Reloading...";
        const response = await fetch("http://127.0.0.1:4149/reload-config", {
          method: "POST",
        });
        if (response.ok) {
          log("Config reloaded successfully from config.json");
          reloadBtn.textContent = "✓ Config Reloaded!";
        } else {
          reloadBtn.textContent = "⚠ Failed to Reload";
        }
      } catch (e) {
        logError("Error reloading config:", e);
        reloadBtn.textContent = "⚠ Server Offline";
      } finally {
        setTimeout(() => {
          reloadBtn.disabled = false;
          reloadBtn.textContent = "🔄 Reload config.json";
        }, 1500);
      }
    });

    async function checkServerStatus() {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1000);

        await fetch("http://127.0.0.1:4149/gsi", {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(id);

        statusDot.className = "status-dot online";
        statusText.textContent = "Online";
        statusText.style.color = "var(--success, #53fc18)";
      } catch (e) {
        statusDot.className = "status-dot offline";
        statusText.textContent = "Offline";
        statusText.style.color = "var(--danger, #ff3333)";
      }
    }

    window.addEventListener("unload", () => {
      clearInterval(statusInterval);
    });

    shutdownBtn.addEventListener("click", async () => {
      if (
        !confirm(
          "Are you sure you want to shut down the local GSI background server?",
        )
      ) {
        return;
      }

      try {
        shutdownBtn.disabled = true;
        shutdownBtn.textContent = "Shutting down...";

        await fetch("http://127.0.0.1:4149/shutdown", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "application/json" },
        });

        log("Shutdown command sent successfully.");
      } catch (e) {
        logError("Error sending shutdown command:", e);
      } finally {
        setTimeout(() => {
          checkServerStatus();
          shutdownBtn.disabled = false;
          shutdownBtn.innerHTML = "⚡ Shutdown GSI Server";
        }, 500);
      }
    });

    const style = document.createElement("style");
    style.textContent = `
      #dota2-kickgsi-popup-root {
        --bg-darker: #0b0e11;
        --bg-dark: #0e1114;
        --bg-card: #191b1f;
        --border: #24272c;
        --text-main: #ffffff;
        --text-muted: #808489;
        --primary: #53fc18;
        --primary-hover: #44e00b;
        --success: #53fc18;
        --danger: #ff3333;
        --danger-hover: #e60000;
        --glow: rgba(83, 252, 24, 0.15);
        font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        width: 280px;
      }
      #dota2-kickgsi-toggle-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, #53fc18, #44e00b);
        color: #000;
        border: none;
        cursor: pointer;
        font-size: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        transition: transform 0.2s;
      }
      #dota2-kickgsi-toggle-btn:hover {
        transform: scale(1.1);
      }
      #dota2-kickgsi-popup {
        position: fixed;
        bottom: 76px;
        right: 20px;
        width: 280px;
        background-color: var(--bg-darker);
        color: var(--text-main);
        padding: 16px;
        border-radius: 12px;
        border: 1px solid var(--border);
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        z-index: 2147483647;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .dota2-kickgsi-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border);
        padding-bottom: 10px;
        font-weight: 700;
        font-size: 14px;
      }
      .dota2-kickgsi-status-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 9999px;
        background-color: rgba(30, 41, 59, 0.5);
        border: 1px solid var(--border);
      }
      .dota2-kickgsi-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: var(--text-muted);
      }
      .dota2-kickgsi-status-dot.online {
        background-color: var(--success);
        box-shadow: 0 0 8px var(--success);
      }
      .dota2-kickgsi-status-dot.offline {
        background-color: var(--danger);
        box-shadow: 0 0 8px var(--danger);
      }
      .dota2-kickgsi-card {
        background-color: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      .dota2-kickgsi-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .dota2-kickgsi-label-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .dota2-kickgsi-label-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-main);
      }
      .dota2-kickgsi-label-desc {
        font-size: 11px;
        color: var(--text-muted);
      }
      .dota2-kickgsi-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      .dota2-kickgsi-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .dota2-kickgsi-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #2e3c56;
        transition: 0.3s;
        border-radius: 24px;
      }
      .dota2-kickgsi-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: #f8fafc;
        transition: 0.3s;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .dota2-kickgsi-switch input:checked + .dota2-kickgsi-slider {
        background: var(--primary);
        box-shadow: 0 0 10px var(--glow);
      }
      .dota2-kickgsi-switch input:checked + .dota2-kickgsi-slider:before {
        transform: translateX(20px);
      }
      .dota2-kickgsi-btn {
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 10px 14px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
      }
      .dota2-kickgsi-btn-primary {
        background: var(--primary);
        color: #000;
      }
      .dota2-kickgsi-btn-primary:hover {
        background: var(--primary-hover);
        transform: translateY(-1px);
      }
      .dota2-kickgsi-btn-danger {
        background: linear-gradient(135deg, var(--danger), #be123c);
        color: #fff;
        box-shadow: 0 4px 10px rgba(239, 68, 68, 0.1);
      }
      .dota2-kickgsi-btn-danger:hover {
        background: linear-gradient(135deg, var(--danger-hover), #9f1239);
        box-shadow: 0 4px 14px rgba(239, 68, 68, 0.25);
        transform: translateY(-1px);
      }
    `;
    document.head.appendChild(style);
  }

  function injectScript() {
    initPopup();
    connectWebSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectScript);
  } else {
    injectScript();
  }
})();
