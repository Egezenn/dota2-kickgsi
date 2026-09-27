import json
import logging
import os
from datetime import datetime

from config import exe_dir, load_config, save_config
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logging.info("WebSocket client connected.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logging.info("WebSocket client disconnected.")

    async def broadcast(self, message: dict):
        logging.info(f"Broadcasting: {message}")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logging.error(f"Error sending message to connection: {e}")


app = FastAPI(title="Dota 2 GSI Kick Automator Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

config_data = load_config()
prediction_config = config_data["prediction"]
obs_state = config_data["obs"]
channel_slug = config_data["channel_slug"] or None

manager = ConnectionManager()

current_prediction = None
last_match_id = None
streamer_team = None


@app.post("/reload-config")
async def reload_config_endpoint():
    global config_data, prediction_config, obs_state, channel_slug
    config_data = load_config()
    prediction_config = config_data["prediction"]
    obs_state = config_data["obs"]
    if config_data["channel_slug"]:
        channel_slug = config_data["channel_slug"]
    logging.info(f"Config reloaded: {config_data}")
    await manager.broadcast({"type": "obs_update", "obs": obs_state})
    await manager.broadcast({"type": "config_reloaded", "config": config_data})
    return {"status": "ok", "config": config_data}


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

                msg_type = message.get("type")
                if msg_type == "init":
                    if not channel_slug:
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
                    await manager.broadcast({"type": "obs_update", "obs": obs_state})
                elif msg_type == "reload_config":
                    await reload_config_endpoint()
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


@app.get("/rank-image")
async def rank_image():  # rank8inactive_psd from game vpk
    path = os.path.join(exe_dir, "rank.png")
    if not os.path.exists(path):
        path = os.path.join(exe_dir, "backend", "rank.png")
    return FileResponse(path)


@app.get("/overlay", response_class=HTMLResponse)
async def overlay():
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dota 2 KickGSI Overlay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    #obs-root {
      width: 400px;
      height: 120px;
      background: rgba(11, 14, 17, 0.95);
      border: 1px solid #24272c;
      border-radius: 12px;
      display: flex;
      align-items: center;
      padding: 12px 16px;
      gap: 14px;
    }
    #obs-rank-img {
      width: 80px;
      height: 80px;
      border-radius: 8px;
      object-fit: cover;
      background: #191b1f;
      border: 1px solid #24272c;
    }
    #obs-rank-img.hidden {
      display: none;
    }
    #obs-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #obs-rank {
      font-size: 28px;
      font-weight: 700;
      color: #ffffff;
    }
    #obs-wl {
      font-size: 14px;
      font-weight: 600;
      color: #53fc18;
    }
  </style>
</head>
<body>
  <div id="obs-root">
    <img id="obs-rank-img" src="/rank-image" alt="Rank" />
    <div id="obs-info">
      <div id="obs-rank">1000</div>
      <div id="obs-wl">0W - 0L</div>
    </div>
  </div>
  <script>
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const rankEl = document.getElementById("obs-rank");
    const wlEl = document.getElementById("obs-wl");
    const imgEl = document.getElementById("obs-rank-img");

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "obs_update") {
          const obs = data.obs || {};
          rankEl.textContent = obs.rank ?? 1000;
          wlEl.textContent = `${obs.wins ?? 0}W - ${obs.losses ?? 0}L`;
        }
      } catch (e) {
        console.error("Overlay parse error:", e);
      }
    };
  </script>
</body>
</html>"""
    return html


@app.post("/shutdown")
def shutdown():
    logging.info("Shutdown requested by another instance. Exiting.")
    os._exit(0)


@app.post("/gsi")
async def handle_gsi(request: Request):
    global current_prediction, last_match_id, streamer_team

    try:
        payload = await request.json()
        if payload:
            logging.info(f"Received GSI payload: {json.dumps(payload)}")
    except Exception as e:
        logging.error(f"Error parsing GSI payload JSON: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON")

    map_data = payload.get("map", {})
    player_data = payload.get("player", {})
    hero_data = payload.get("hero", {})

    if not map_data or not player_data:
        return {"status": "waiting_for_game"}

    match_id = map_data.get("matchid")
    game_state = map_data.get("game_state")
    win_team = map_data.get("win_team", "none")

    hero_name = hero_data.get("name") or player_data.get("name") or "Unknown"
    if hero_name.startswith("npc_dota_hero_"):
        hero_name = hero_name[len("npc_dota_hero_") :]
    hero_name = hero_name.replace("_", " ").title()

    if player_data.get("team_name"):
        streamer_team = player_data["team_name"].lower()

    if (
        game_state
        in [
            "DOTA_GAMERULES_STATE_TEAM_SHOWCASE",
            "DOTA_GAMERULES_STATE_PRE_GAME",
            "DOTA_GAMERULES_STATE_GAME_PLAY",
            "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
        ]
        and match_id
        and match_id != "0"
    ):
        if match_id != last_match_id and current_prediction is None:
            last_match_id = match_id

            title_template = prediction_config["title_template"]
            title = title_template.replace("<match-id>", match_id)
            title = title.replace("<hero>", hero_name)

            now = datetime.now()
            time_str = now.strftime("%H:%M")
            title = title.replace("<time>", time_str)
            outcomes = prediction_config["outcomes"]

            command = {
                "action": "create",
                "channel_slug": channel_slug,
                "title": title,
                "outcomes": outcomes,
                "duration": prediction_config["duration"],
            }
            await manager.broadcast(command)
            logging.info(f"Broadcasted prediction creation command for match {match_id}")

    elif game_state == "DOTA_GAMERULES_STATE_POST_GAME" and current_prediction:
        prediction_id = current_prediction.get("id")
        outcomes = current_prediction.get("outcomes", [])

        if prediction_id and outcomes and win_team != "none":
            winning_side = "radiant" if win_team == "goodguys" else "dire"
            streamer_won = streamer_team == winning_side

            outcomes = prediction_config["outcomes"]
            target_title = outcomes[0] if streamer_won else outcomes[1]
            winning_outcome_id = None
            for o in outcomes:
                if o.get("title") == target_title:
                    winning_outcome_id = o.get("id")
                    break

            if winning_outcome_id:
                command = {
                    "action": "resolve",
                    "channel_slug": channel_slug,
                    "prediction_id": prediction_id,
                    "winning_outcome_id": winning_outcome_id,
                }
                await manager.broadcast(command)
                logging.info(f"Broadcasted prediction resolution command for {target_title}")
                current_prediction = None

                delta = obs_state["rank_delta"]
                if streamer_won:
                    obs_state["wins"] += 1
                    obs_state["rank"] += delta
                else:
                    obs_state["losses"] += 1
                    obs_state["rank"] -= delta
                config_data["obs"] = obs_state
                save_config(config_data)
                await manager.broadcast({"type": "obs_update", "obs": obs_state})
            else:
                logging.error(f"Could not map outcome for {target_title} in synced outcomes {outcomes}")

    elif player_data.get("activity") == "menu":
        if current_prediction or last_match_id:
            logging.info("Returned to menu. Resetting prediction and match states.")
            current_prediction = None
            last_match_id = None

    return {"status": "ok", "game_state": game_state, "match_id": match_id}
