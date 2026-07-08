# Hat Provider

`hat-provider` is a standalone terrain RGB XYZ tile server.

It reads each set's manifest from `data/sets/*.json`, uses the set VRT to establish source precedence, and serves exact tile PNGs directly from the underlying GeoPackages when available.

Selection behavior:

- source precedence follows the VRT source order for direct tile lookup
- when an exact tile is missing, the service falls back to the VRT-backed renderer so coverage stays correct
- runtime raster work only happens on the fallback path

Run locally with Pixi:

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\hat-provider
pixi run dev
```

Endpoints:

- `GET /health`
- `GET /api/v1/hat/sets`
- `GET /api/v1/hat/sets/{setId}`
- `GET /api/v1/hat/sets/{setId}/tiles/{z}/{x}/{y}.png`
- `GET /api/v1/openapi.json`
- `GET /api/v1/docs`
