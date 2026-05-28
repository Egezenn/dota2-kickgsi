import datetime
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.request
import webbrowser

import vdf
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Prevent TTY attribute errors in GUI/No-Console compiled environments
if sys.stdout is None or sys.stderr is None:

    class DummyStream:
        def write(self, x):
            pass

        def flush(self):
            pass

        def isatty(self):
            return False

    if sys.stdout is None:
        sys.stdout = DummyStream()
    if sys.stderr is None:
        sys.stderr = DummyStream()

# Calculate log path dynamically to always reside next to the running executable
if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
else:
    exe_dir = os.path.dirname(os.path.abspath(__file__))
log_file_path = os.path.join(exe_dir, "gsi_server.log")

if os.path.exists(log_file_path):
    try:
        mdate = datetime.date.fromtimestamp(os.path.getmtime(log_file_path))
        if mdate < datetime.date.today():
            with open(log_file_path, "w") as f:
                f.truncate(0)
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(log_file_path, encoding="utf-8")],
)

app = FastAPI(title="Dota 2 GSI Kick Automator Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global channel slug (dynamically configured via extension WebSocket on startup)
channel_slug = None


def restart_steam_and_launch_dota(steam_path):
    steam_exe = os.path.join(steam_path, "steam.exe")
    if os.path.exists(steam_exe):
        logging.info("Launch options changed. Restarting Steam to apply changes...")
        try:
            # Signal Steam to exit cleanly
            subprocess.Popen([steam_exe, "-exitsteam"])
            # Give Steam 3 seconds to exit completely
            time.sleep(3.0)
        except Exception as e:
            logging.warning(f"Failed to cleanly close Steam: {e}")

        try:
            # Launch Dota 2 via Steam protocol, which automatically starts Steam with new launch options
            webbrowser.open("steam://rungameid/570")
            logging.info("Launched Dota 2 via Steam protocol.")
        except Exception as e:
            logging.warning(f"Failed to launch Dota 2 via steam:// protocol: {e}")


def auto_setup_steam_launch_options(steam_path):
    if sys.platform != "win32":
        return False
    modified = False
    try:
        userdata_dir = os.path.join(steam_path, "userdata")
        if not os.path.exists(userdata_dir):
            return False
        for user_id in os.listdir(userdata_dir):
            if not user_id.isdigit():
                continue
            vdf_path = os.path.join(userdata_dir, user_id, "config", "localconfig.vdf")
            if not os.path.exists(vdf_path):
                continue
            try:
                with open(vdf_path, "r", encoding="utf-8", errors="ignore") as f:
                    data = vdf.load(f)

                store = data.setdefault("UserLocalConfigStore", {})
                software = store.setdefault("Software", {})
                valve = software.setdefault("Valve", {})
                steam = valve.setdefault("Steam", {})
                apps = steam.setdefault("apps", {})
                dota = apps.setdefault("570", {})
                existing_launch = dota.get("LaunchOptions", "")

                if getattr(sys, "frozen", False):
                    bot_exe_path = os.path.normpath(sys.executable)
                else:
                    bot_exe_path = os.path.normpath(os.path.join(exe_dir, "releases", "DotaKickGSI-Windows.exe"))

                clean = existing_launch
                # Clean up and preserve custom arguments from inside the wrapper
                match = re.search(
                    r'cmd\s+/c\s+["\'].*?DotaKickGSI-Windows\.exe.*?%command%(.*?)["\']', clean, flags=re.IGNORECASE
                )
                if match:
                    extracted_args = match.group(1).strip()
                    clean = re.sub(
                        r'cmd\s+/c\s+["\'].*?DotaKickGSI-Windows\.exe.*?%command%.*?["\']',
                        "",
                        clean,
                        flags=re.IGNORECASE,
                    ).strip()
                    if extracted_args:
                        clean = f"{clean} {extracted_args}" if clean else extracted_args
                else:
                    clean = re.sub(
                        r'cmd\s+/c\s+["\'].*?DotaKickGSI-Windows\.exe.*?%command%.*?["\']',
                        "",
                        clean,
                        flags=re.IGNORECASE,
                    ).strip()

                if "-gamestateintegration" not in clean:
                    clean = f"{clean} -gamestateintegration" if clean else "-gamestateintegration"

                clean = " ".join(clean.split())
                new_launch = f'cmd /c "start "" "{bot_exe_path}" & start "" %command% {clean}"'

                if existing_launch != new_launch:
                    dota["LaunchOptions"] = new_launch
                    with open(vdf_path, "w", encoding="utf-8") as f:
                        vdf.dump(data, f, pretty=True)
                    logging.info(f"Automatically configured Steam launch options for account {user_id}")
                    modified = True
            except Exception as e:
                logging.warning(f"Failed to patch localconfig.vdf for user {user_id}: {e}")
    except Exception as e:
        logging.warning(f"Could not configure Steam launch options: {e}")
    return modified


def auto_setup_gsi():
    if sys.platform != "win32":
        return
    try:
        import winreg

        hkey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam")
        steam_path = winreg.QueryValueEx(hkey, "InstallPath")[0]
        if not steam_path or not os.path.exists(steam_path):
            return

        # Configure Steam launch options automatically
        options_changed = auto_setup_steam_launch_options(steam_path)
        if options_changed:
            restart_steam_and_launch_dota(steam_path)

        paths = [steam_path]
        library_vdf = os.path.join(steam_path, "config", "libraryfolders.vdf")
        if os.path.exists(library_vdf):
            with open(library_vdf, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                found_paths = re.findall(r'"path"\s+"([^"]+)"', content)
                for p in found_paths:
                    normalized = os.path.normpath(p.replace("\\\\", "\\"))
                    if normalized not in paths:
                        paths.append(normalized)

        for path in paths:
            gsi_dir = os.path.join(
                path, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg", "gamestate_integration"
            )
            if os.path.exists(
                os.path.join(path, "steamapps", "common", "dota 2 beta", "game", "bin", "win64", "dota2.exe")
            ):
                os.makedirs(gsi_dir, exist_ok=True)
                cfg_path = os.path.join(gsi_dir, "gamestate_integration_kickbot.cfg")

                cfg_content = (
                    '"Dota 2 Kick Betting Integration"\n'
                    "{\n"
                    '    "uri"           "http://localhost:3000/gsi"\n'
                    '    "timeout"       "5.0"\n'
                    '    "buffer"        "0.1"\n'
                    '    "throttle"      "0.1"\n'
                    '    "heartbeat"     "30.0"\n'
                    '    "data"\n'
                    "    {\n"
                    '        "map"           "1"\n'
                    '        "player"        "1"\n'
                    "    }\n"
                    "}\n"
                )
                with open(cfg_path, "w", encoding="utf-8") as cfg_f:
                    cfg_f.write(cfg_content)
                logging.info(f"Automatically configured GSI at: {cfg_path}")
                return
    except Exception as e:
        logging.warning(f"Could not auto-configure GSI: {e}")


# Run GSI configuration check on startup
auto_setup_gsi()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logging.info("WebSocket client (browser extension) connected.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logging.info("WebSocket client (browser extension) disconnected.")

    async def broadcast(self, message: dict):
        logging.info(f"Broadcasting to extension: {message}")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logging.error(f"Error sending message to extension connection: {e}")


manager = ConnectionManager()

# Global state
current_prediction = None
last_match_id = None
streamer_team = None  # 'radiant' or 'dire'


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global current_prediction, channel_slug
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                logging.info(f"Received message from extension: {message}")

                # Handle client responses
                msg_type = message.get("type")
                if msg_type == "init":
                    url = message.get("url", "")
                    if url:
                        clean_url = url.split("?")[0].rstrip("/")
                        parts = clean_url.split("/")
                        if len(parts) >= 4 and parts[2].endswith("kick.com"):
                            potential_slug = parts[3]
                            if potential_slug in ["popout", "moderator"] and len(parts) >= 5:
                                potential_slug = parts[4]
                            if potential_slug not in ["creator-dashboard", "dashboard", "settings", "chat", ""]:
                                channel_slug = potential_slug
                                logging.info(f"Dynamically registered channel slug: {channel_slug}")
                elif msg_type == "created_success":
                    current_prediction = {
                        "id": message.get("prediction_id"),
                        "outcomes": message.get("outcomes"),
                    }
                    logging.info(f"Active Prediction Sync'd: {current_prediction}")
                elif msg_type == "resolved_success":
                    logging.info("Active Prediction resolved successfully on Kick. Clearing state.")
                    current_prediction = None
                elif msg_type == "error":
                    logging.error(f"Extension reported error: {message.get('message')}")
            except json.JSONDecodeError:
                logging.error("Failed to decode JSON from WebSocket client")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logging.error(f"WebSocket connection error: {e}")
        manager.disconnect(websocket)


@app.post("/shutdown")
def shutdown():
    logging.info("Shutdown requested by another instance. Exiting.")
    os._exit(0)


@app.post("/gsi")
async def handle_gsi(request: Request):
    global current_prediction, last_match_id, streamer_team

    try:
        payload = await request.json()
        logging.info(f"Received GSI payload: {json.dumps(payload)}")
    except Exception as e:
        logging.error(f"Error parsing GSI payload JSON: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON")

    map_data = payload.get("map", {})
    player_data = payload.get("player", {})

    if not map_data or not player_data:
        return {"status": "waiting_for_game"}

    match_id = map_data.get("matchid")
    game_state = map_data.get("game_state")
    win_team = map_data.get("win_team", "none")

    # Track streamer team
    if player_data.get("team_name"):
        streamer_team = player_data["team_name"].lower()  # 'radiant' or 'dire'

    # 1. Trigger prediction creation when game starts
    if (
        game_state in ["DOTA_GAMERULES_STATE_GAME_PLAY", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"]
        and match_id
        and match_id != "0"
    ):
        if match_id != last_match_id and current_prediction is None:
            last_match_id = match_id

            # Send command to extension to open prediction
            command = {
                "action": "create",
                "channel_slug": channel_slug,
                "title": f"Match {match_id}: Will we win?",
                "outcomes": ["Yes (Win)", "No (Lose)"],
                "duration": 300,
            }
            await manager.broadcast(command)
            logging.info(f"Broadcasted prediction creation command for match {match_id}")

    # 2. Trigger prediction resolution when match ends
    elif game_state == "DOTA_GAMERULES_STATE_POST_GAME" and current_prediction:
        prediction_id = current_prediction.get("id")
        outcomes = current_prediction.get("outcomes", [])

        if prediction_id and outcomes and win_team != "none":
            winning_side = "radiant" if win_team == "goodguys" else "dire"
            streamer_won = streamer_team == winning_side

            target_title = "Yes (Win)" if streamer_won else "No (Lose)"
            winning_outcome_id = None
            for o in outcomes:
                if o.get("title") == target_title:
                    winning_outcome_id = o.get("id")
                    break

            if winning_outcome_id:
                # Send command to extension to resolve prediction
                command = {
                    "action": "resolve",
                    "channel_slug": channel_slug,
                    "prediction_id": prediction_id,
                    "winning_outcome_id": winning_outcome_id,
                }
                await manager.broadcast(command)
                logging.info(f"Broadcasted prediction resolution command for {target_title}")
            else:
                logging.error(f"Could not map outcome for {target_title} in synced outcomes {outcomes}")

    # 3. Reset state if player goes to main menu
    elif player_data.get("activity") == "menu":
        if current_prediction or last_match_id:
            logging.info("Returned to menu. Resetting prediction and match states.")
            current_prediction = None
            last_match_id = None

    return {"status": "ok", "game_state": game_state, "match_id": match_id}


if __name__ == "__main__":
    import uvicorn

    LOG_CONFIG = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": "uvicorn.logging.DefaultFormatter",
                "fmt": "%(asctime)s - %(levelname)s - %(message)s",
                "use_colors": False,
            },
            "access": {
                "()": "uvicorn.logging.AccessFormatter",
                "fmt": '%(asctime)s - %(levelname)s - %(client_addr)s - "%(request_line)s" %(status_code)s',
            },
        },
        "handlers": {
            "file": {
                "formatter": "default",
                "class": "logging.FileHandler",
                "filename": log_file_path,
                "encoding": "utf-8",
            },
            "access_file": {
                "formatter": "access",
                "class": "logging.FileHandler",
                "filename": log_file_path,
                "encoding": "utf-8",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["file"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"handlers": ["file"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["access_file"], "level": "INFO", "propagate": False},
        },
    }

    # Shut down any previous instance running on port 3000
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:3000/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=1.0):
            pass
        # Wait for socket to completely release
        time.sleep(0.5)
    except Exception:
        pass

    uvicorn.run(app, host="127.0.0.1", port=3000, log_config=LOG_CONFIG)
