from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from src.config import API_PREFIX, FRONTEND_DIST_DIR, GPKG_DEBUG_LOGGING
from src.routes.catalog import router as catalog_router
from src.services.catalog import list_catalog_sets
from src.services.wmts import list_skipped_wmts_layers, list_wmts_layers
from src.routes.wmts import router as wmts_router


logger = logging.getLogger("map_provider.startup")
logger.disabled = not GPKG_DEBUG_LOGGING


app = FastAPI(
    title="Map Server",
    description="Set-aware GeoPackage WMTS service with OpenLayers demo",
    docs_url=f"{API_PREFIX}/docs",
    redoc_url=None,
    openapi_url=f"{API_PREFIX}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:4174",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="assets")


@app.on_event("startup")
def log_wmts_diagnostics():
    if not GPKG_DEBUG_LOGGING:
        return

    global_layers = list_wmts_layers()
    global_skipped = list_skipped_wmts_layers()
    logger.info(
        "Global WMTS diagnostics complete",
        extra={
            "published_layer_count": len(global_layers),
            "skipped_layer_count": len(global_skipped),
            "published_layer_ids": [layer.identifier for layer in global_layers],
            "skipped_layer_ids": [layer.identifier for layer in global_skipped],
        },
    )

    for skipped in global_skipped:
        logger.warning(
            "Global WMTS layer skipped during startup diagnostics",
            extra={
                "layer_identifier": skipped.identifier,
                "layer_title": skipped.title,
                "relative_path": skipped.relative_path,
                "reason": skipped.reason,
            },
        )

    for map_set in list_catalog_sets():
        if not map_set.maps and map_set.dtm_layers:
            logger.warning(
                "Set has DTM layers but no map assets; set-specific WMTS endpoints will publish no layers",
                extra={
                    "set_id": map_set.id,
                    "set_name": map_set.name,
                    "map_asset_count": len(map_set.maps),
                    "dtm_asset_count": len(map_set.dtm_layers),
                    "dtm_relative_paths": [asset.relative_path for asset in map_set.dtm_layers],
                },
            )

        set_layers = list_wmts_layers(map_set.id)
        set_skipped = list_skipped_wmts_layers(map_set.id)
        logger.info(
            "Set WMTS diagnostics complete",
            extra={
                "set_id": map_set.id,
                "set_name": map_set.name,
                "map_asset_count": len(map_set.maps),
                "dtm_asset_count": len(map_set.dtm_layers),
                "published_layer_count": len(set_layers),
                "skipped_layer_count": len(set_skipped),
                "published_layer_ids": [layer.identifier for layer in set_layers],
                "skipped_layer_ids": [layer.identifier for layer in set_skipped],
            },
        )

        for skipped in set_skipped:
            logger.warning(
                "Set WMTS layer skipped during startup diagnostics",
                extra={
                    "set_id": map_set.id,
                    "set_name": map_set.name,
                    "layer_identifier": skipped.identifier,
                    "layer_title": skipped.title,
                    "relative_path": skipped.relative_path,
                    "reason": skipped.reason,
                },
            )

@app.get("/")
def root():
    return {
        "service": "map-provider",
        "demoUrl": "/demo",
        "swaggerUrl": f"{API_PREFIX}/docs",
        "openApiUrl": f"{API_PREFIX}/openapi.json",
        "catalogUrl": f"{API_PREFIX}/sets",
        "healthUrl": "/health"
    }


@app.get("/swagger", include_in_schema=False)
def swagger():
    return RedirectResponse(url=f"{API_PREFIX}/docs")


@app.get("/demo")
def demo_index():
    index_path = FRONTEND_DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {
        "message": "Map provider frontend was not built. Build the Vite app in map-provider/frontend first."
    }

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(catalog_router)
app.include_router(wmts_router)

@app.get("/demo/{full_path:path}")
def frontend_fallback(full_path: str):
    requested = FRONTEND_DIST_DIR / Path(full_path)
    if requested.is_file():
        return FileResponse(requested)

    index_path = FRONTEND_DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    return {"message": "Frontend artifact not found."}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8003)
