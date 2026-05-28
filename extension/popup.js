document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById("enable-toggle");
  const slugInput = document.getElementById("slug-input");
  const lockBtn = document.getElementById("lock-btn");
  const shutdownBtn = document.getElementById("shutdown-btn");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  let isLocked = false;

  // --- 1. Load Initial State ---
  chrome.storage.local.get(["enabled", "lockedSlug"], (res) => {
    // Enable state (default: true)
    if (res.enabled !== undefined) {
      enableToggle.checked = res.enabled;
    } else {
      enableToggle.checked = true;
      chrome.storage.local.set({ enabled: true });
    }

    // Locked slug state
    if (res.lockedSlug) {
      slugInput.value = res.lockedSlug;
      setLockState(true);
    } else {
      setLockState(false);
    }
  });

  // --- 2. Enable/Disable Automator Toggle ---
  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({ enabled: enableToggle.checked }, () => {
      console.log("[KickPred GSI] Automator enabled state set to:", enableToggle.checked);
    });
  });

  // --- 3. Lock/Unlock Channel Slug ---
  lockBtn.addEventListener("click", () => {
    if (!isLocked) {
      const slugVal = slugInput.value.trim();
      if (!slugVal) {
        alert("Please enter a valid channel slug first!");
        return;
      }
      chrome.storage.local.set({ lockedSlug: slugVal }, () => {
        setLockState(true);
        console.log("[KickPred GSI] Channel slug locked:", slugVal);
      });
    } else {
      chrome.storage.local.remove("lockedSlug", () => {
        setLockState(false);
        console.log("[KickPred GSI] Channel slug unlocked.");
      });
    }
  });

  function setLockState(locked) {
    isLocked = locked;
    if (locked) {
      slugInput.disabled = true;
      lockBtn.textContent = "Unlock";
      lockBtn.style.background = "var(--bg-dark)";
      lockBtn.style.border = "1px solid var(--border)";
      lockBtn.style.color = "var(--text-muted)";
    } else {
      slugInput.disabled = false;
      lockBtn.textContent = "Lock";
      lockBtn.style.background = "var(--primary)";
      lockBtn.style.border = "none";
      lockBtn.style.color = "#000";
    }
  }

  // --- 4. Live Server Status Check ---
  async function checkServerStatus() {
    try {
      // Fetch status (we use /gsi with empty body or a simple fetch, if it replies it's running!)
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1000);

      const response = await fetch("http://127.0.0.1:3000/gsi", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(id);

      statusDot.className = "status-dot online";
      statusText.textContent = "Online";
      statusText.style.color = "var(--success)";
    } catch (e) {
      statusDot.className = "status-dot offline";
      statusText.textContent = "Offline";
      statusText.style.color = "var(--danger)";
    }
  }

  // Poll server status every 2 seconds while popup is open
  checkServerStatus();
  const statusInterval = setInterval(checkServerStatus, 2000);

  // Clean up interval on close
  window.addEventListener("unload", () => {
    clearInterval(statusInterval);
  });

  // --- 5. Shutdown Server Command ---
  shutdownBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to shut down the local GSI background server?")) {
      return;
    }

    try {
      shutdownBtn.disabled = true;
      shutdownBtn.textContent = "Shutting down...";

      await fetch("http://127.0.0.1:3000/shutdown", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      });

      console.log("[KickPred GSI] Shutdown command sent successfully.");
    } catch (e) {
      console.error("[KickPred GSI] Error sending shutdown command:", e);
    } finally {
      // Instantly refresh server status badge
      setTimeout(() => {
        checkServerStatus();
        shutdownBtn.disabled = false;
        shutdownBtn.innerHTML = "⚡ Shutdown GSI Server";
      }, 500);
    }
  });
});
