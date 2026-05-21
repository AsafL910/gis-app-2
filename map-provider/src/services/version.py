import json
from functools import lru_cache
from pathlib import Path


VERSION_FILE = Path(__file__).resolve().parents[2] / "service-version.json"


@lru_cache(maxsize=1)
def get_version_payload() -> dict:
    return json.loads(VERSION_FILE.read_text(encoding="utf-8"))
