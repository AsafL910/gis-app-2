from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from .config import RGB_ELEVATION_FORMULA, TILE_SIZE
from .storage import get_map_set, list_map_sets
from .terrain_tiles import inspect_vrt_sources, render_terrain_rgb_tile, render_terrain_rgb_tile_4326


app = FastAPI(title="Hat Provider", version="0.1.0")


def _require_vrt_path(map_set: dict[str, object]) -> str:
    vrt_path = str(map_set.get("vrtPath", "")).strip()
    if not vrt_path:
        raise RuntimeError(f'Map set "{map_set.get("id", "")}" is missing a vrtPath value.')
    return vrt_path


@app.get("/")
def root() -> dict[str, object]:
    return {
        "service": "hat-provider",
        "healthUrl": "/health",
        "setsUrl": "/api/hat/sets",
    }


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/hat/sets")
def list_sets() -> dict[str, list[dict[str, object]]]:
    payload: list[dict[str, object]] = []
    for map_set in list_map_sets():
        try:
            source_set = inspect_vrt_sources(_require_vrt_path(map_set))
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
                "tileUrlTemplate": f"/api/hat/sets/{map_set.get('id', '')}/tiles/{{z}}/{{x}}/{{y}}.png",
                "tileUrlTemplate4326": f"/api/hat/sets/{map_set.get('id', '')}/tiles/EPSG4326/{{z}}/{{x}}/{{y}}.png",
                "vrtPath": source_set.vrt_path,
                "sources": [
                    {
                        "path": source.path,
                        "crs": source.crs,
                        "resolution": source.resolution,
                        "bounds3857": source.bounds_3857,
                    }
                    for source in source_set.sources
                ],
            }
        )

    return {"sets": payload}


@app.get("/api/hat/sets/{set_id}")
def get_set(set_id: str) -> dict[str, object]:
    try:
        map_set = get_map_set(set_id)
        source_set = inspect_vrt_sources(_require_vrt_path(map_set))
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

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
        "tileUrlTemplate": f"/api/hat/sets/{set_id}/tiles/{{z}}/{{x}}/{{y}}.png",
        "tileUrlTemplate4326": f"/api/hat/sets/{set_id}/tiles/EPSG4326/{{z}}/{{x}}/{{y}}.png",
        "vrtPath": source_set.vrt_path,
        "sources": [
            {
                "path": source.path,
                "crs": source.crs,
                "resolution": source.resolution,
                "bounds3857": source.bounds_3857,
            }
            for source in source_set.sources
        ],
    }


@app.get("/api/hat/sets/{set_id}/tiles/{z}/{x}/{y}.png")
def terrain_tile(set_id: str, z: int, x: int, y: int):
    try:
        map_set = get_map_set(set_id)
        tile = render_terrain_rgb_tile(_require_vrt_path(map_set), z, x, y)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return Response(content=tile, media_type="image/png")


@app.get("/api/hat/sets/{set_id}/tiles/EPSG4326/{z}/{x}/{y}.png")
def terrain_tile_4326(set_id: str, z: int, x: int, y: int):
    try:
        map_set = get_map_set(set_id)
        tile = render_terrain_rgb_tile_4326(_require_vrt_path(map_set), z, x, y)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return Response(content=tile, media_type="image/png")
