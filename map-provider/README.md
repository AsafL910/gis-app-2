# Map Provider

`map-provider` is now a set-aware GeoPackage WMTS service backed by the shared `data/sets.json` manifest.

## Responsibilities

- read map sets from the shared `data/` volume
- expose set-specific WMTS layer catalogs and tile endpoints
- serve a React + Vite + OpenLayers demo page from the same container
- report skipped map layers when a GeoPackage is not raster-readable or not in `EPSG:4326`

## Runtime contract

Expected inputs:

- `data/sets.json`
- `data/sets/<setId>/map/*.gpkg`

Primary endpoints:

- `GET /api/sets`
- `GET /api/sets/{setId}/layers`
- `GET /api/wmts/sets/{setId}/WMTSCapabilities.xml`
- `GET /api/wmts/sets/{setId}/{layerId}/EPSG4326/{tileMatrix}/{tileRow}/{tileCol}.png`

## Frontend demo

The embedded frontend lives under [frontend](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-provider\frontend).

It lets you:

- choose a map set
- inspect map assets recorded for the set
- toggle WMTS-ready overlays in an OpenLayers preview
- see why a map asset was skipped when it cannot be exposed as WMTS
