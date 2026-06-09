import json
import re
from typing import Any

from .config import DATA_ROOT, SETS_MANIFEST_PATH


def _slugify_set_name(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().replace("\\", "/")).strip("-").lower()
    return slug or "set"


def load_manifest() -> dict[str, Any]:
    manifest_paths = sorted((DATA_ROOT / "sets").glob("*.json"), key=str)

    if manifest_paths:
        return {
            "version": 1,
            "sets": [json.loads(path.read_text(encoding="utf-8")) for path in manifest_paths],
        }

    if SETS_MANIFEST_PATH.exists():
        return json.loads(SETS_MANIFEST_PATH.read_text(encoding="utf-8"))

    raise FileNotFoundError(
        f"Manifest files were not found under {DATA_ROOT / 'sets'}. Start the management service first."
    )


def list_map_sets() -> list[dict[str, Any]]:
    manifest = load_manifest()
    sets = manifest.get("sets", [])

    hydrated_sets: list[dict[str, Any]] = []
    for map_set in sets:
        if not isinstance(map_set, dict):
            continue
        name = str(map_set.get("name", "")).strip()
        if not name:
            continue
        hydrated_sets.append(
            {
                **map_set,
                "id": map_set.get("id") or _slugify_set_name(name),
            }
        )
    return sorted(hydrated_sets, key=lambda item: str(item.get("name", "")).lower())


def get_map_set(set_id: str) -> dict[str, Any]:
    for map_set in list_map_sets():
        if map_set.get("id") == set_id or map_set.get("name") == set_id:
            return map_set

    raise KeyError(f'Map set "{set_id}" was not found in the shared manifest.')
