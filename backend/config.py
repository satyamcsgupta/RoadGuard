import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent


def load_backend_env() -> None:
    env_path = BACKEND_DIR / ".env"
    if not env_path.is_file():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip():
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
