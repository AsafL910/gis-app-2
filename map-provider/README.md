# Map Provider

`map-provider` is a lightweight, dynamic GeoPackage-backed WMTS service.

Its job is simple:
- inspect GeoPackage files at runtime
- publish only what the GeoPackage metadata actually says is available
- serve tiles without inventing static grid rules
- stay small and predictable so it can adapt to new map packages without code churn

## Core Principle

This service must never depend on hard-coded global grid assumptions such as:
- fixed `EPSG:4326` matrix sets
- fixed world origins like `[-180, 180]`
- fixed zoom ladders
- fixed tile coordinate ranges
- fixed output formats
- assumptions that a GeoPackage contains only one tile table

If a GeoPackage can be served, the service should derive everything from the package itself:
- tile tables from `gpkg_contents`
- matrix set bounds from `gpkg_tile_matrix_set`
- zoom levels, matrix sizes, tile sizes, and resolutions from `gpkg_tile_matrix`
- CRS information from `gpkg_spatial_ref_sys`
- tile format from the stored tile blobs

If the service cannot derive required metadata from the GeoPackage, it should reject or skip that layer explicitly rather than silently falling back to static grid data.

## Why This Matters

The whole point of `map-provider` is portability.

Moving the codebase or introducing a new `.gpkg` should not require rewriting grid configuration. If someone adds static WMTS assumptions here, the service stops being a general GeoPackage server and becomes a fragile special-case server for only the maps it was tested with.

When changing this service, prefer:
- runtime inspection over configuration duplication
- metadata-driven behavior over guessed behavior
- explicit failure over silent fallback
- lightweight logic over map-specific branching

## Responsibilities

- read map sets from the shared `data/` volume
- inspect GeoPackage tile metadata dynamically
- expose global and set-specific WMTS layer catalogs
- serve WMTS tiles directly from GeoPackage tile tables
- serve a React + Vite + OpenLayers demo page from the same container
- report skipped map layers when a GeoPackage tile table is unreadable or missing required metadata

## Runtime Contract

Expected inputs:

- `data/sets/*.json`
- global `.gpkg` files under `data/`
- per-set manifests and VRT files under `data/sets/`

Primary endpoints:

- `GET /api/sets`
- `GET /api/layers`
- `GET /api/sets/{setId}/layers`
- `GET /wmts?SERVICE=WMTS&REQUEST=GetCapabilities`
- `GET /api/wmts/sets/{setId}?SERVICE=WMTS&REQUEST=GetCapabilities`
- `GET /wmts/{layerId}/{tileMatrixSet}/{tileMatrix}/{tileRow}/{tileCol}.{ext}`
- `GET /api/wmts/sets/{setId}/{layerId}/{tileMatrixSet}/{tileMatrix}/{tileRow}/{tileCol}.{ext}`

## Debug Logging

Deep GeoPackage diagnostics are available, but only when explicitly enabled.

Set:

```env
GPKG_DEBUG_LOGGING=true
```

When enabled, the service logs:
- candidate GeoPackages being inspected
- discovered tile tables
- derived CRS, bounds, zoom levels, matrix sizes, and tile ranges
- skip reasons for invalid or incomplete GeoPackages
- request-time failures such as wrong matrix set, wrong zoom, out-of-range tile coordinates, or missing tile rows

By default these logs stay off so normal service output remains clean.

## Frontend Demo

The embedded frontend lives under [frontend](D:\Courses\MAPS\israel\glb-demo\gis-app2\map-provider\frontend).

It lets you:
- inspect published WMTS-ready layers
- preview tiles from the same metadata-driven service contract
- surface layer publication issues without manually querying the database

## Change Guardrails

Before merging changes to `map-provider`, verify:
- no new static grid constants were introduced as a fallback for real layer metadata
- CRS, bounds, resolutions, matrix ids, and tile limits still come from the GeoPackage
- failures remain explicit and observable
- the service still behaves like a general GeoPackage server, not a server customized for one dataset
