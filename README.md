# dota2-kickgsi

Automatically create, manage, and resolve native predictions on Kick.com based on real-time events from your Dota 2 game!

## How It Works

1. **Dota 2 Client** sends real-time game state updates to a local Python server (`gsi_server.py`) using Steam's Game State Integration (GSI).
2. **GSI Python Server** parses the game events. On match start or match end, it broadcasts action commands via local WebSockets (`ws://localhost:3000/ws`).
3. **Kick Browser Extension** runs silently in the background of your active **`dashboard.kick.com`** tab (such as your Creator Dashboard or Moderator View). It receives commands from the local server and executes same-origin requests directly inside your browser. No cookies are stored on disk or sent over the network!

## Setup Instructions

Follow these quick steps to get up and running:

### Step 1: Download the Executable & Extension

1. Go to the [GitHub Releases](https://github.com/egezenn/dota2-kickgsi/releases/latest) page of this repository.
2. Download the pre-compiled standalone executable for your operating system:
   - **Windows:** [DotaKickGSI-Windows.exe](https://github.com/egezenn/dota2-kickgsi/releases/latest/download/DotaKickGSI-Windows.exe)
   - **Linux:** [DotaKickGSI-Linux](https://github.com/egezenn/dota2-kickgsi/releases/latest/download/DotaKickGSI-Linux)
   - **macOS:** [DotaKickGSI-macOS](https://github.com/egezenn/dota2-kickgsi/releases/latest/download/DotaKickGSI-macOS)
3. Download the browser extension:
   - **Chrome / Edge / Brave / Vivaldi / Opera / Arc:** [extension.crx](https://github.com/egezenn/dota2-kickgsi/releases/latest/download/extension.crx) (Pre-packaged Chromium extension for easy drag-and-drop installation)

### Step 2: Install the Browser Extension

1. Open Google Chrome (or any Chromium browser).
2. Navigate to `chrome://extensions/` in your browser.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Drag and drop the downloaded **`extension.crx`** file directly from your file manager onto the extensions page. It will automatically prompt to install the extension.

> [!NOTE]
> **Zero Configuration Required! (For Windows)**
>
> - **No API tokens or credentials**: The extension communicates dynamically with your local server via WebSockets.
> - **Fully Automated Dota 2 GSI Setup**: When you first run `DotaKickGSI-Windows.exe`, it automatically locates your Steam directory, configures the required Dota 2 Game State Integration (GSI) files, and safely configures your Steam launch options. Everything works automatically out of the box!
>
> *(Note: Auto-configuration is optimized for Windows; other platforms like Linux or macOS may require manual directory/launch option tweaks).*

> [!WARNING]
> **Firefox / LibreWolf / Waterfox Users:** Rename the downloaded **`extension.zip`** to **`extension.xpi`**, go to `about:addons`, click the gear icon, and select **"Install Add-on From File..."**.
>
> *(Note: Except for LibreWolf/Waterfox which support this out of the box, standard Firefox forks require setting `xpinstall.signatures.required` to `false` in `about:config` to allow unsigned extensions permanently).*

## Running the Automator

1. **Start the Server:** Double-click the downloaded standalone executable (e.g., `DotaKickGSI-Windows.exe`) to start the local background server.
2. **Open Kick Dashboard (Required):** Open your web browser and go to your Kick Creator Dashboard or Moderator Dashboard at **`https://dashboard.kick.com`**. *(Note: The extension is scoped to only run on the `dashboard.kick.com` domain to perform secure same-origin predictions API requests, so keeping a dashboard tab open is required).*
3. **Play Dota 2:** Simply launch Dota 2 with GSI configured, and the automator will automatically manage predictions on your stream!

## 🛠️ Developer Setup (Build from Source)

If you are a developer and want to run the project from source or compile the executables yourself:

1. **Prerequisites:** Install [Python 3.12+](https://www.python.org/downloads/) and [uv](https://github.com/astral-sh/uv).
2. **Start Dev Server:** Run `uv run gsi_server.py` to automatically sync dependencies and start the GSI listener server on port 3000.
3. **Compile Standalone Executables:** To compile local standalone executables for your machine:

   ```powershell
   uv run pyinstaller --onefile --name DotaKickGSI gsi_server.py
   ```
