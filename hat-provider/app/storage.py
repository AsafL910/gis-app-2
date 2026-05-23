import json
from typing import Any

from .config import SETS_MANIFEST_PATH


def load_manifest() -> dict[str, Any]:
    if not SETS_MANIFEST_PATH.exists():
        raise FileNotFoundError(
            f"Manifest file was not found at {SETS_MANIFEST_PATH}. Start the management service first."
        )
    return json.loads(SETS_MANIFEST_PATH.read_text(encoding="utf-8"))


def list_map_sets() -> list[dict[str, Any]]:
    return list(load_manifest().get("sets", []))


def get_map_set(set_id: str) -> dict[str, Any]:
    for map_set in list_map_sets():
        if map_set.get("id") == set_id:
            return map_set
    raise KeyError(f'Map set "{set_id}" was not found in the shared manifest.')

