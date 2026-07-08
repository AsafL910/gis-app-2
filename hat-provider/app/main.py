from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import Response

from .config import RGB_ELEVATION_FORMULA, TILE_SIZE
from .storage import get_map_set, list_map_sets
from .models import GpkgSourceMetadata
from .services.gpkg_reader import inspect_sources
from .services.terrain_rendering import (
    inspect_vrt_source_paths,
    render_terrain_rgb_tile,
)


API_PREFIX = "/api/v1"
HAT_PREFIX = f"{API_PREFIX}/hat"
LEGACY_HAT_PREFIX = "/api/hat"

app = FastAPI(
    title="Hat Provider",
    version="1.0.0",
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
    redoc_url=None,
)

api_router = APIRouter(prefix=HAT_PREFIX, tags=["hat"])
legacy_router = APIRouter(prefix=LEGACY_HAT_PREFIX, include_in_schema=False)


def _source_entries(map_set: dict[str, object]) -> list[dict[str, object]]:
    source_entries = map_set.get("dtmLayers") or map_set.get("maps") or []
    if not isinstance(source_entries, list) or not source_entries:
        raise RuntimeError(f'Map set "{map_set.get("name", "")}" does not contain any GeoPackage sources.')

    normalized_entries: list[dict[str, object]] = []
    for index, source_entry in enumerate(source_entries):
        if not isinstance(source_entry, dict):
            continue
        source_path = str(source_entry.get("absolutePath") or source_entry.get("path") or "").strip()
        if not source_path:
            continue
        normalized_entries.append(
            {
                "path": source_path,
                "priority": int(source_entry.get("priority", index)),
            }
        )

    if not normalized_entries:
        raise RuntimeError(f'Map set "{map_set.get("name", "")}" does not contain any readable GeoPackage sources.')

    ordered_paths: list[str] = []
    vrt_path = str(map_set.get("vrtPath", "")).strip()
    if vrt_path:
        try:
            ordered_paths = list(inspect_vrt_source_paths(vrt_path))
        except Exception:
            ordered_paths = []

    if ordered_paths:
        by_path = {entry["path"]: entry for entry in normalized_entries}
        ordered_entries = [by_path[path] for path in ordered_paths if path in by_path]
        leftovers = [entry for entry in normalized_entries if entry["path"] not in ordered_paths]
        ordered_entries.extend(sorted(leftovers, key=lambda item: (item["priority"], item["path"])))
        if ordered_entries:
            return ordered_entries

    return sorted(normalized_entries, key=lambda item: (item["priority"], item["path"]))


def _source_paths(map_set: dict[str, object]) -> tuple[str, ...]:
    return tuple(entry["path"] for entry in _source_entries(map_set))


def _require_vrt_path(map_set: dict[str, object]) -> str:
    vrt_path = str(map_set.get("vrtPath", "")).strip()
    if not vrt_path:
        raise RuntimeError(f'Map set "{map_set.get("name", "")}" is missing a vrtPath value.')
    return vrt_path


def _serialize_source(source: GpkgSourceMetadata) -> dict[str, object]:
    return {
        "path": source.path,
        "crs": source.crs,
        "resolution": source.resolution,
        "bounds": source.bounds,
    }


def _build_set_payload(map_set: dict[str, object], source_set: tuple[GpkgSourceMetadata, ...], set_id: str) -> dict[str, object]:
    return {
        "id": map_set.get("id", ""),
        "name": map_set.get("name", ""),
        "description": map_set.get("description", ""),
        "provider": "hat-provider",
        "format": "image/png",
        "scheme": "xyz",
        "tileMatrixSet": "EPSG:4326",
        "tileSize": TILE_SIZE,
        "encodingFormula": RGB_ELEVATION_FORMULA,
        "tileUrlTemplate": f"/api/v1/hat/sets/{set_id}/tiles/{{z}}/{{x}}/{{y}}.png",
        "tileUrlTemplate4326": f"/api/v1/hat/sets/{set_id}/tiles/{{z}}/{{x}}/{{y}}.png",
        "vrtPath": map_set.get("vrtPath", ""),
        "sources": [_serialize_source(source) for source in source_set],
    }


def _list_sets_impl() -> dict[str, list[dict[str, object]]]:
    payload: list[dict[str, object]] = []
    for map_set in list_map_sets():
        try:
            source_set = inspect_sources(_source_paths(map_set))
        except Exception as exc:
            payload.append(
                {
                    "id": map_set.get("id", ""),
                    "name": map_set.get("name", ""),
                    "description": map_set.get("description", ""),
                    "status": "error",
                    "error": str(exc),
                }
            )
            continue

        payload.append(
            {
                "id": map_set.get("id", ""),
                "name": map_set.get("name", ""),
                "description": map_set.get("description", ""),
                "status": "ready",
                "provider": "hat-provider",
                "format": "image/png",
                "scheme": "xyz",
                "tileMatrixSet": "EPSG:4326",
                "tileSize": TILE_SIZE,
                "encodingFormula": RGB_ELEVATION_FORMULA,
                "tileUrlTemplate": f"/api/v1/hat/sets/{map_set.get('id', '')}/tiles/{{z}}/{{x}}/{{y}}.png",
                "tileUrlTemplate4326": f"/api/v1/hat/sets/{map_set.get('id', '')}/tiles/{{z}}/{{x}}/{{y}}.png",
                "vrtPath": map_set.get("vrtPath", ""),
                "sources": [_serialize_source(source) for source in source_set],
            }
        )

    return {"sets": payload}


def _get_set_impl(set_id: str) -> dict[str, object]:
    map_set = get_map_set(set_id)
    source_set = inspect_sources(_source_paths(map_set))
    return _build_set_payload(map_set, source_set, set_id)


def _tile_impl(set_id: str, z: int, x: int, y: int) -> Response:
    map_set = get_map_set(set_id)
    tile = render_terrain_rgb_tile(_source_paths(map_set), _require_vrt_path(map_set), z, x, y)
    return Response(content=tile, media_type="image/png")


@app.get("/")
def root() -> dict[str, object]:
    return {
        "service": "hat-provider",
        "healthUrl": "/health",
        "setsUrl": f"{HAT_PREFIX}/sets",
        "docsUrl": f"{API_PREFIX}/docs",
        "openApiUrl": f"{API_PREFIX}/openapi.json",
    }


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@api_router.get("/sets")
def list_sets() -> dict[str, list[dict[str, object]]]:
    return _list_sets_impl()


@legacy_router.get("/sets")
def legacy_list_sets() -> dict[str, list[dict[str, object]]]:
    return _list_sets_impl()


@api_router.get("/sets/{set_id}")
def get_set(set_id: str) -> dict[str, object]:
    try:
        return _get_set_impl(set_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@legacy_router.get("/sets/{set_id}")
def legacy_get_set(set_id: str) -> dict[str, object]:
    try:
        return _get_set_impl(set_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@api_router.get("/sets/{set_id}/tiles/{z}/{x}/{y}.png")
def terrain_tile(set_id: str, z: int, x: int, y: int):
    try:
        return _tile_impl(set_id, z, x, y)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@legacy_router.get("/sets/{set_id}/tiles/{z}/{x}/{y}.png")
def legacy_terrain_tile(set_id: str, z: int, x: int, y: int):
    try:
        return _tile_impl(set_id, z, x, y)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@legacy_router.get("/sets/{set_id}/tiles/EPSG4326/{z}/{x}/{y}.png", include_in_schema=False)
def legacy_terrain_tile_4326(set_id: str, z: int, x: int, y: int):
    try:
        return _tile_impl(set_id, z, x, y)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


app.include_router(api_router)
app.include_router(legacy_router)
