# GIS Management Application

Distributed GIS demo workspace with three components:

- `map-manager`: Node.js + TypeScript + Express management service
- `terrain-calculator`: Python + FastAPI + GDAL terrain service
- `map-manager-ui`: React + Vite + MUI dashboard
- `map-provider`: Python WMTS provider with a React + Vite + OpenLayers demo frontend

The shared `data/` folder is the current source of truth.

## Shared data contract

The management service creates and maintains:

- `data/sets.json`: file-backed manifest of all map sets
- `data/sets/<setId>/map/*`: uploaded map GeoPackages
- `data/sets/<setId>/dtm/*`: uploaded DTM GeoPackages
- `data/sets/<setId>/<setId>.vrt`: generated GDAL VRT for DTM queries

DTM ordering is persisted in `sets.json` as highest-resolution-first.
During VRT generation the XML source order is reversed so GDAL overlap precedence still favors the highest-priority layers.

## Docker demo

The repository now includes:

- [docker-compose.yml](D:\Courses\MAPS\israel\glb-demo\gis-app2\docker-compose.yml)
- [map-manager/Dockerfile](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager\Dockerfile)
- [terrain-calculator/Dockerfile](D:\Courses\MAPS\israel\glb-demo\gis-app2\terrain-calculator\Dockerfile)
- [map-manager-ui/Dockerfile](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager-ui\Dockerfile)
- [map-provider/Dockerfile](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-provider\Dockerfile)

All data-sharing services mount the same host folder:

- `./data -> /app/data`

Compose startup:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2
docker compose up --build
```

Published ports:

- Management API: `http://localhost:4000`
- Terrain API: `http://localhost:8000`
- Management dashboard: `http://localhost:5173`
- Map provider demo: `http://localhost:8003`

## Management service

Location: [map-manager](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager)

Endpoints:

- `GET /api/sets`
- `POST /api/sets`
- `PUT /api/sets/:id/dtm-order`
- `DELETE /api/sets/:id`

`POST /api/sets` expects `multipart/form-data` with:

- `name`
- `description`
- `maps`: repeated `.gpkg` files
- `dtms`: repeated `.gpkg` files in priority order

Run after installing Node dependencies:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager
npm install
npm run dev
```

Notes:

- VRT generation uses `gdalinfo -json` to inspect the primary DTM.
- GDAL must be available on `PATH` for the management service at runtime.

## Terrain calculation service

Location: [terrain-calculator](D:\Courses\MAPS\israel\glb-demo\gis-app2\terrain-calculator)

Run with Pixi:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\terrain-calculator
pixi run dev
```

Endpoint:

- `POST /api/terrain/calculate`

Example request:

```json
{
  "setId": "set_123",
  "query": {
    "type": "point",
    "coordinates": [219600.0, 631450.0]
  }
}
```

Supported query shapes:

- `point`
- `path`
- `bbox`

Elevation decoding formula:

```text
elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
```

## Frontend

Location: [map-manager-ui](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager-ui)

Run after installing Node dependencies:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\map-manager-ui
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://localhost:4000`.

## Map provider

Location: [map-provider](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-provider)

The provider reads `data/sets.json`, exposes set-specific WMTS endpoints, and serves a React/OpenLayers demo from the same service.

Key endpoints:

- `GET /api/sets`
- `GET /api/sets/:setId/layers`
- `GET /api/wmts/sets/:setId/WMTSCapabilities.xml`
- `GET /api/wmts/sets/:setId/:layerId/EPSG4326/:tileMatrix/:tileRow/:tileCol.png`

Notes:

- Only raster GeoPackages readable by `rasterio` and already in `EPSG:4326` are published as WMTS-ready overlays.
- Unsupported or non-raster map assets are listed in the demo as skipped layers with a reason.

## Current assumptions

- No SQL database yet; `data/sets.json` is the only persisted catalog.
- Terrain queries are evaluated in the raster CRS used by the VRT.
- The generated VRT assumes DTM layers are compatible for stacking as RGB rasters.
- The provider demo assumes WMTS-previewable map layers are raster GeoPackages in `EPSG:4326`.
