# Terrain Client Demo

This is a standalone example client, not part of the GIS services themselves.

It demonstrates how a consumer can:

- load available sets from `map-provider`
- optionally skip sets and browse the global WMTS layer catalog
- fetch set-scoped WMTS layer metadata
- fetch set-scoped terrain RGB metadata from `hat-provider`
- render the selected WMTS map plus a terrain RGB overlay in OpenLayers
- inspect elevation values on hover from the terrain RGB tiles

## Run

```powershell
cd D:\Courses\MAPS\israel\glb-demo\gis-app2\example-client
npm install
npm run dev
```

The Vite dev server proxies:

- `/map-provider-api` -> `http://localhost:8003`
- `/hat-provider-api` -> `http://localhost:8004`

So make sure `map-provider` and `hat-provider` are already running before opening the demo.

When running the client inside Docker Compose, those proxy targets are overridden to:

- `MAP_PROVIDER_PROXY_TARGET=http://map-provider:8003`
- `HAT_PROVIDER_PROXY_TARGET=http://hat-provider:8004`
