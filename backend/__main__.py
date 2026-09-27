import time
import urllib.request

import uvicorn
from config import log_file_path
from routes import app

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

if __name__ == "__main__":
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:4149/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=1.0):
            pass
        time.sleep(0.5)
    except Exception:
        pass

    uvicorn.run(app, host="127.0.0.1", port=4149, log_config=LOG_CONFIG)
