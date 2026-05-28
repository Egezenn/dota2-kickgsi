(function () {
  console.log("[Dota 2 GSI Kick Prediction] Content script loaded.");

  let ws = null;
  let reconnectTimeout = null;

  function getAuthToken() {
    // 1. Attempt to extract the token from the session_token cookie (primary method on Kick.com)
    try {
      const match = document.cookie.match(/(^|;)\s*session_token\s*=\s*([^;]+)/);
      if (match) {
        const val = decodeURIComponent(match[2]);
        if (val && val.includes("|") && /^\d+\|[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
      }
    } catch (e) {
      console.error("[Dota 2 GSI Kick Prediction] Error reading session cookie:", e);
    }

    // 2. Fallback to localStorage or sessionStorage
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
      console.error("[Dota 2 GSI Kick Prediction] Error reading storage:", e);
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

    chrome.storage.local.get(["enabled"], (res) => {
      if (res.enabled === false) {
        console.log("[Dota 2 GSI Kick Prediction] WebSocket connection skipped (extension is disabled).");
        isAttemptingConnection = false;
        return;
      }

      if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        isAttemptingConnection = false;
        return;
      }

      if (ws) {
        isClosingIntentionally = true;
        ws.close();
      }

      console.log("[Dota 2 GSI Kick Prediction] Connecting to GSI Server WebSocket...");
      ws = new WebSocket("ws://127.0.0.1:3000/ws");

      ws.onopen = () => {
        isConnected = true;
        hasAlertedOffline = false;
        isAttemptingConnection = false;
        console.log("[Dota 2 GSI Kick Prediction] WebSocket connection established.");

        chrome.storage.local.get(["lockedSlug"], (innerRes) => {
          let urlToSend = window.location.href;
          if (innerRes.lockedSlug) {
            urlToSend = `https://dashboard.kick.com/moderator/${innerRes.lockedSlug}`;
            console.log("[Dota 2 GSI Kick Prediction] Using locked channel slug:", innerRes.lockedSlug);
          }
          ws.send(JSON.stringify({ type: "init", url: urlToSend }));
        });
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[Dota 2 GSI Kick Prediction] Received event:", data);

          if (data.action === "create") {
            await handleCreatePrediction(data);
          } else if (data.action === "resolve") {
            await handleResolvePrediction(data);
          }
        } catch (err) {
          console.error("[Dota 2 GSI Kick Prediction] Error handling WebSocket message:", err);
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
          console.log("[Dota 2 GSI Kick Prediction] WebSocket server disconnected. Retrying in 5 seconds...");
        } else {
          console.log(
            "[Dota 2 GSI Kick Prediction] Local GSI background server is offline. (Ensure DotaKickGSI-Windows.exe is running on your PC!) Retrying in 5 seconds...",
          );
          if (!hasAlertedOffline) {
            hasAlertedOffline = true;
            console.warn(
              "[Dota 2 GSI Kick Prediction] Local background server is offline. " +
                "Please make sure 'DotaKickGSI-Windows.exe' (or your OS binary) is running to automate stream predictions.",
            );
          }
        }
        isConnected = false;
        clearTimeout(reconnectTimeout);

        chrome.storage.local.get(["enabled"], (res) => {
          if (res.enabled !== false) {
            reconnectTimeout = setTimeout(connectWebSocket, 5000);
          }
        });
      };

      ws.onerror = () => {
        // Silently close to let ws.onclose handle the diagnostic printing cleanly
        ws.close();
      };
    });
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

    console.log("[Dota 2 GSI Kick Prediction] Creating prediction via browser fetch...");
    console.log(
      "[Dota 2 GSI Kick Prediction] - Token present:",
      !!token,
      token ? token.substring(0, 10) + "..." : "null",
    );
    console.log("[Dota 2 GSI Kick Prediction] - XSRF present:", !!xsrf, xsrf ? xsrf.substring(0, 10) + "..." : "null");
    console.log("[Dota 2 GSI Kick Prediction] - Headers:", JSON.stringify(headers));
    console.log("[Dota 2 GSI Kick Prediction] - Body outcomes:", JSON.stringify(data.outcomes));
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
        console.log("[Dota 2 GSI Kick Prediction] Prediction created successfully:", resData);
        ws.send(
          JSON.stringify({
            type: "created_success",
            prediction_id: resData.data.id,
            outcomes: resData.data.outcomes,
          }),
        );
      } else {
        console.error("[Dota 2 GSI Kick Prediction] Fail to create prediction:", resData);
        ws.send(JSON.stringify({ type: "error", message: resData.message || "Failed to create" }));
      }
    } catch (e) {
      console.error("[Dota 2 GSI Kick Prediction] Fetch error during creation:", e);
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

    console.log("[Dota 2 GSI Kick Prediction] Resolving prediction via browser fetch...");
    try {
      // Step 1: Lock the prediction first
      console.log("[Dota 2 GSI Kick Prediction] - Step 1: Locking prediction...");
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
        console.error("[Dota 2 GSI Kick Prediction] Fail to lock prediction:", lockResData);
        ws.send(JSON.stringify({ type: "error", message: lockResData.message || "Failed to lock" }));
        return;
      }
      console.log("[Dota 2 GSI Kick Prediction] Prediction locked successfully:", lockResData);

      // Step 2: Resolve the locked prediction
      console.log("[Dota 2 GSI Kick Prediction] - Step 2: Resolving prediction to winner...");
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
        console.log("[Dota 2 GSI Kick Prediction] Prediction resolved successfully:", resolveResData);
        ws.send(
          JSON.stringify({
            type: "resolved_success",
            prediction_id: predictionId,
          }),
        );
      } else {
        console.error("[Dota 2 GSI Kick Prediction] Fail to resolve prediction:", resolveResData);
        ws.send(JSON.stringify({ type: "error", message: resolveResData.message || "Failed to resolve" }));
      }
    } catch (e) {
      console.error("[Dota 2 GSI Kick Prediction] Fetch error during resolution process:", e);
      ws.send(JSON.stringify({ type: "error", message: e.toString() }));
    }
  }

  // Listen for storage changes from the popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.enabled) {
        if (changes.enabled.newValue === false) {
          console.log("[Dota 2 GSI Kick Prediction] Disabled via popup. Closing WebSocket.");
          if (ws) {
            isClosingIntentionally = true;
            ws.close();
          }
          clearTimeout(reconnectTimeout);
        } else {
          // Only connect if not already connecting or open
          if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            console.log("[Dota 2 GSI Kick Prediction] Enabled via popup. Connecting...");
            connectWebSocket();
          }
        }
      }
      if (changes.lockedSlug) {
        if (changes.lockedSlug.newValue !== changes.lockedSlug.oldValue) {
          console.log("[Dota 2 GSI Kick Prediction] Locked slug updated. Reconnecting to sync with server...");
          connectWebSocket(true);
        }
      }
    }
  });

  // Start WebSocket connection
  connectWebSocket();
})();
