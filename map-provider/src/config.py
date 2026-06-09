import json
import os
import re
from dataclasses import dataclass
from pathlib import Path


DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).resolve().parents[2] / "data"))).resolve()
FRONTEND_DIST_DIR = Path(os.environ.get("FRONTEND_DIST_DIR", str(Path(__file__).resolve().parents[1] / "frontend-dist"))).resolve()
SETS_MANIFEST_PATH = DATA_DIR / "sets.json"
WMTS_TILE_SIZE = 256
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")


def _parse_bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


GPKG_DEBUG_LOGGING = _parse_bool_env("GPKG_DEBUG_LOGGING", default=False)


@dataclass(frozen=True)
class GeoPackageLayerConfig:
    identifier: str
    title: str
    relative_path: str


@dataclass(frozen=True)
class StoredAssetRecord:
    id: str
    original_name: str
    stored_name: str
    relative_path: str
    absolute_path: Path
    size: int


@dataclass(frozen=True)
class MapSetRecord:
    id: str
    name: str
    description: str
    maps: list[StoredAssetRecord]
    dtm_layers: list[StoredAssetRecord]
    vrt_path: str


def _slugify_set_name(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().replace("\\", "/")).strip("-").lower()
    return slug or "set"


def _list_set_manifest_paths() -> list[Path]:
    if not DATA_DIR.exists():
        return []

    return sorted(
        (path for path in DATA_DIR.joinpath("sets").glob("*.json") if path.is_file()),
        key=str,
    )


def _hydrate_map_set(raw_set: dict) -> MapSetRecord:
    name = str(raw_set.get("name", "")).strip()
    if not name:
        raise ValueError("Set manifest is missing a name")

    maps: list[StoredAssetRecord] = []
    dtm_layers: list[StoredAssetRecord] = []

    for raw_map in raw_set.get("maps", []):
        relative_path = str(raw_map.get("relativePath", "")).replace("\\", "/").lstrip("/")
        if not relative_path:
            continue
        maps.append(
            StoredAssetRecord(
                id=str(raw_map.get("id", "")),
                original_name=str(raw_map.get("originalName", "")),
                stored_name=str(raw_map.get("storedName", "")),
                relative_path=relative_path,
                absolute_path=resolve_data_path(relative_path),
                size=int(raw_map.get("size", 0)),
            )
        )

    for raw_dtm in raw_set.get("dtmLayers", []):
        relative_path = str(raw_dtm.get("relativePath", "")).replace("\\", "/").lstrip("/")
        if not relative_path:
            continue
        dtm_layers.append(
            StoredAssetRecord(
                id=str(raw_dtm.get("id", "")),
                original_name=str(raw_dtm.get("originalName", "")),
                stored_name=str(raw_dtm.get("storedName", "")),
                relative_path=relative_path,
                absolute_path=resolve_data_path(relative_path),
                size=int(raw_dtm.get("size", 0)),
            )
        )

    vrt_path = str(raw_set.get("vrtPath", "")).strip()
    if not vrt_path:
        vrt_path = str((DATA_DIR / "sets" / f"{_slugify_set_name(name)}.vrt").resolve())

    return MapSetRecord(
        id=_slugify_set_name(name),
        name=name,
        description=str(raw_set.get("description", "") or ""),
        maps=maps,
        dtm_layers=dtm_layers,
        vrt_path=vrt_path,
    )


def resolve_data_path(relative_path: str) -> Path:
    path = (DATA_DIR / relative_path).resolve()
    if not str(path).startswith(str(DATA_DIR)):
        raise ValueError(f"Path {relative_path} is outside DATA_DIR")
    return path


def _make_identifier(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().replace("\\", "/")).strip("-").lower()
    return slug or "layer"


def _parse_json_layer_entries(raw: str) -> list[dict[str, str]]:
    loaded = json.loads(raw)
    if not isinstance(loaded, list):
        raise ValueError("WMTS_GPKG_LAYERS must be a JSON list")

    entries: list[dict[str, str]] = []
    for item in loaded:
        if isinstance(item, str):
            entries.append({"path": item})
            continue
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            entries.append(
                {
                    "path": item["path"],
                    "name": str(item.get("name") or "").strip(),
                    "title": str(item.get("title") or "").strip(),
                }
            )
            continue
        raise ValueError("WMTS_GPKG_LAYERS entries must be strings or objects with a path field")
    return entries


def _parse_delimited_layer_entries(raw: str) -> list[dict[str, str]]:
    separators = raw.replace(";", "\n").replace(",", "\n")
    entries: list[dict[str, str]] = []
    for part in separators.splitlines():
        path = part.strip()
        if path:
            entries.append({"path": path})
    return entries


def load_wmts_gpkg_layers() -> list[GeoPackageLayerConfig]:
    raw = os.environ.get("WMTS_GPKG_LAYERS", "").strip()
    fallback = os.environ.get("WMTS_GPKG_LIST", "").strip()

    if raw:
        entries = _parse_json_layer_entries(raw)
    elif fallback:
        entries = _parse_delimited_layer_entries(fallback)
    else:
        entries = [
            {"path": str(path.relative_to(DATA_DIR)).replace("\\", "/")}
            for path in sorted(DATA_DIR.rglob("*.gpkg"))
            if path.is_file()
        ]

    configs: list[GeoPackageLayerConfig] = []
    used_identifiers: set[str] = set()

    for entry in entries:
        relative_path = entry["path"].replace("\\", "/").lstrip("/")
        path = resolve_data_path(relative_path)
        if not path.exists() or not path.is_file():
            continue

        title = entry.get("title") or entry.get("name") or path.stem
        base_identifier = _make_identifier(entry.get("name") or path.stem)
        identifier = base_identifier
        suffix = 2
        while identifier in used_identifiers:
            identifier = f"{base_identifier}-{suffix}"
            suffix += 1
        used_identifiers.add(identifier)

        configs.append(
            GeoPackageLayerConfig(
                identifier=identifier,
                title=title,
                relative_path=relative_path,
            )
        )

    return configs


def load_map_sets() -> list[MapSetRecord]:
    manifest_paths = _list_set_manifest_paths()
    if manifest_paths:
        return sorted(
            [_hydrate_map_set(json.loads(path.read_text(encoding="utf-8"))) for path in manifest_paths],
            key=lambda item: item.name.lower(),
        )

    if SETS_MANIFEST_PATH.exists():
        legacy_manifest = json.loads(SETS_MANIFEST_PATH.read_text(encoding="utf-8"))
        return sorted(
            [_hydrate_map_set(raw_set) for raw_set in legacy_manifest.get("sets", [])],
            key=lambda item: item.name.lower(),
        )

    return []
