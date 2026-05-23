from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.config import FRONTEND_DIST_DIR
from src.routes.catalog import router as catalog_router
from src.routes.wmts import router as wmts_router


app = FastAPI(
    title="Map Server",
    description="Set-aware GeoPackage WMTS service with OpenLayers demo",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="assets")

@app.get("/")
def root():
    return {
        "service": "map-provider",
        "demoUrl": "/demo",
        "catalogUrl": "/api/sets",
        "healthUrl": "/health"
    }


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
