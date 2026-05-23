# Hat Provider

`hat-provider` is a standalone terrain RGB XYZ tile server.

It reads each set's `vrtPath` from the shared `data/sets.json` manifest, parses the GeoPackages referenced by that VRT, and serves terrain-RGB PNG tiles for web XYZ clients.

Selection behavior:

- tile pixels are read from the GDAL VRT itself, so source precedence follows the VRT order exactly
- the service no longer ranks, mixes, or backfills individual GeoPackages on its own
- PNG output is written losslessly from the VRT-backed read result

Run locally with Pixi:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\hat-provider
pixi run dev
```

Endpoints:

- `GET /health`
- `GET /api/hat/sets`
- `GET /api/hat/sets/{setId}`
- `GET /api/hat/sets/{setId}/tiles/{z}/{x}/{y}.png`
- `GET /api/hat/sets/{setId}/tiles/EPSG4326/{z}/{x}/{y}.png`
