# Portable RGB GeoPackage Converter

This folder is self-contained.

## What this project does

This project turns a DEM / terrain raster into a Terrain-RGB tile pyramid stored in a GeoPackage.

The pipeline is:

1. Read the source GeoTIFF elevation raster.
2. Reproject it to `EPSG:4326` so the output matches the standard geodetic tile grid.
3. Encode elevation into 24-bit RGB values using the Terrain-RGB formula.
4. Cut the RGB raster into XYZ PNG tiles with `gdal2tiles`.
5. Wrap those tiles into a GeoPackage table called `terrain_rgb`.

The important part is that the map is not a styled vector layer. It is a tiled raster pyramid where each pixel stores elevation in RGB:

- `elevation = base + ((R * 256^2) + (G * 256) + B) * interval`
- default `base = -10000`
- default `interval = 0.1`

If a pixel is nodata, the RGB value is written as black (`0,0,0`).

## How to use it

1. Put one or more `.tif` or `.tiff` files into `input/`.
2. Double-click `Run-RgbGpkg.cmd`.
3. Pick the file number.
4. Enter the output name you want.
5. If needed, choose automatic zoom or enter the minimum and maximum zoom levels.

You can also run the launcher with flags, for example:

```powershell
.\Run-RgbGpkg.cmd -AutoZoom
.\Run-RgbGpkg.cmd -MinZoom 5 -MaxZoom 11
```

The result is written to `output/` as a GeoPackage tile pyramid.

## Recreating the workflow manually

If you want to do the same work in QGIS, GDAL, ArcGIS, or another GIS tool, these are the same logical steps:

### 1) Inspect the source raster

Open the GeoTIFF and confirm:

- the CRS of the source raster
- the pixel size / resolution
- whether nodata values are defined
- the elevation range

In QGIS you can check this in **Layer Properties -> Information**.

### 2) Reproject to `EPSG:4326`

The tile pyramid is built in geodetic coordinates, so the raster must be reprojected to WGS84 first.

In QGIS:

- Use **Raster -> Projections -> Warp (Reproject)**
- Set the target CRS to `EPSG:4326`
- Use a resampling method such as **Lanczos** for smoother elevation output
- Preserve nodata handling if the source has nodata

Equivalent GDAL concept:

```powershell
gdalwarp -t_srs EPSG:4326 -r lanczos -dstnodata none input.tif warped.tif
```

### 3) Encode elevation into Terrain-RGB

Convert each elevation value into a 24-bit integer and split it into RGB channels.

Formula:

```text
encoded = round((elevation - base) / interval)
R = floor(encoded / 65536)
G = floor((encoded % 65536) / 256)
B = encoded % 256
```

To reverse it later:

```text
elevation = base + ((R * 65536) + (G * 256) + B) * interval
```

In a GIS that supports raster math, this is usually done by:

- creating a single 24-bit integer elevation raster
- splitting that integer into three 8-bit bands
- exporting as a 3-band RGB GeoTIFF

If your tool can't directly build RGB from raster math, you can do this with GDAL, Python, or raster calculator steps.

### 4) Build tiles

Generate geodetic XYZ tiles from the RGB raster.

In GDAL terms this is the same as:

```powershell
python -m osgeo_utils.gdal2tiles -p geodetic --xyz -n -w none -z MIN-MAX rgb.tif tiles/
```

That produces a folder tree like:

```text
tiles/z/x/y.png
```

### 5) Package the tiles

The final GeoPackage is a container that stores the tile PNGs in a table called `terrain_rgb`.

If you do this manually, the key pieces are:

- `gpkg_contents`
- `gpkg_tile_matrix_set`
- `gpkg_tile_matrix`
- a tile table with `zoom_level`, `tile_column`, `tile_row`, and `tile_data`

The script in this folder handles that wrapping automatically. Most users won't need to build the GeoPackage by hand unless they are integrating with their own tooling.

## Zoom selection

- `--auto-zoom` computes the highest useful zoom from the final WGS84 pixel size.
- If you choose manual zooms, lower zooms are coarser and higher zooms are more detailed.
- The default auto workflow also keeps the pyramid from going beyond the source resolution.

Notes:

- The bundled `runtime/` folder was copied from the repo's Pixi-built `height-server` environment.
- No separate Python, GDAL, or Anaconda install is needed on the target machine.
- `pixi-x86_64-pc-windows-msvc.msi` is included only as a fallback if you ever want to rebuild or refresh the Pixi runtime on a clean machine.
- The conversion keeps the Terrain-RGB encoding with `base=-10000` and `interval=0.1`.
- `GPKG` mode uses `gdal2tiles` in geodetic `XYZ` mode and then only wraps the generated PNG tiles into a GeoPackage. No post-tile resampling is performed after tiling.
- `AutoZoom` computes the highest useful zoom from the reprojected source resolution and does not exceed it.
