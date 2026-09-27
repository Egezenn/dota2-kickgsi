import datetime
import json
import logging
import os
import sys

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

if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
else:
    exe_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

config_file_path = os.path.join(exe_dir, "config.json")
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


def load_config() -> dict:
    with open(config_file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict) -> None:
    with open(config_file_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def get_gsi_path(name: str) -> str:
    import winreg

    k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam")
    steam = winreg.QueryValueEx(k, "SteamPath")[0]
    return os.path.join(
        steam,
        "steamapps",
        "common",
        "dota 2 beta",
        "game",
        "dota",
        "cfg",
        "gamestate_integration",
        f"gamestate_integration_{name}.cfg",
    )

