from __future__ import annotations

import argparse
import os
import math
import sqlite3
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import Callable

import numpy as np
from osgeo import gdal, osr


gdal.UseExceptions()

GPKG_APP_ID = 0x47504B47  # "GPKG"
DESCRIPTION = "Terrain-RGB tile pyramid wrapped without pixel changes"
NATIVE_DESCRIPTION = "Terrain-RGB native-resolution base layer"
TILE_SIZE = 256

RESAMPLE_ALG_MAP = {
    "near": gdal.GRA_NearestNeighbour,
    "bilinear": gdal.GRA_Bilinear,
    "cubic": gdal.GRA_Cubic,
    "cubicspline": gdal.GRA_CubicSpline,
    "lanczos": gdal.GRA_Lanczos,
    "average": gdal.GRA_Average,
    "mode": gdal.GRA_Mode,
    "max": getattr(gdal, "GRA_Max", None),
    "min": getattr(gdal, "GRA_Min", None),
    "med": getattr(gdal, "GRA_Med", None),
    "q1": getattr(gdal, "GRA_Q1", None),
    "q3": getattr(gdal, "GRA_Q3", None),
    "rms": getattr(gdal, "GRA_RMS", None),
}
RESAMPLE_ALG_MAP = {name: alg for name, alg in RESAMPLE_ALG_MAP.items() if alg is not None}
if "max" not in RESAMPLE_ALG_MAP:
    raise RuntimeError("GDAL build does not support max resampling")


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def load_user_version_from_pixi() -> int:
    pixi_path = Path(__file__).resolve().parents[1] / "pixi.toml"
    with pixi_path.open("rb") as fh:
        data = tomllib.load(fh)

    workspace = data.get("workspace")
    if not isinstance(workspace, dict):
        raise ValueError("pixi.toml is missing a [workspace] table")

    version_text = workspace.get("version")
    if not isinstance(version_text, str) or not version_text.strip():
        raise ValueError("pixi.toml is missing workspace.version")

    parts = version_text.strip().split(".")
    if len(parts) != 3:
        raise ValueError(f"workspace.version must use semantic versioning, got {version_text!r}")

    try:
        major, minor, patch = (int(part) for part in parts)
    except ValueError as exc:
        raise ValueError(f"workspace.version must contain only integers, got {version_text!r}") from exc

    if major < 0 or minor < 0 or patch < 0:
        raise ValueError(f"workspace.version must not contain negative values, got {version_text!r}")

    return major * 10000 + minor * 100 + patch


def log(message: str) -> None:
    print(message, flush=True)


def compute_bounds(geotransform: tuple[float, float, float, float, float, float], width: int, height: int) -> tuple[float, float, float, float]:
    min_x = geotransform[0]
    max_y = geotransform[3]
    max_x = geotransform[0] + (width * geotransform[1]) + (height * geotransform[2])
    min_y = geotransform[3] + (width * geotransform[4]) + (height * geotransform[5])
    return min_x, min_y, max_x, max_y


def log_gdalinfo(path: Path, label: str) -> None:
    log(f"      {label} gdalinfo:")
    try:
        info = gdal.Info(str(path))
    except Exception as exc:
        log(f"        gdalinfo unavailable: {exc}")
        return

    if not info:
        log("        gdalinfo returned no output")
        return

    for line in info.rstrip().splitlines():
        log(f"        {line}")


def write_rgb_blocks(
    warped_ds: gdal.Dataset,
    rgb_path: Path,
    base: float,
    interval: float,
    src_nodata: float | None,
) -> None:
    warped_band = warped_ds.GetRasterBand(1)
    warped_nodata = warped_band.GetNoDataValue()
    width = warped_ds.RasterXSize
    height = warped_ds.RasterYSize
    block_x, block_y = warped_band.GetBlockSize()
    chunk_x = max(1, block_x)
    chunk_y = max(1, block_y)

    driver = gdal.GetDriverByName("GTiff")
    rgb_ds = driver.Create(
        str(rgb_path),
        width,
        height,
        3,
        gdal.GDT_Byte,
        options=[
            "TILED=YES",
            "COMPRESS=DEFLATE",
            "BIGTIFF=YES",
            "INTERLEAVE=PIXEL",
            f"BLOCKXSIZE={TILE_SIZE}",
            f"BLOCKYSIZE={TILE_SIZE}",
        ],
    )
    if rgb_ds is None:
        raise RuntimeError("Failed to create intermediate RGB GeoTIFF")

    try:
        rgb_ds.SetGeoTransform(warped_ds.GetGeoTransform())
        rgb_ds.SetProjection(warped_ds.GetProjection())

        for yoff in range(0, height, chunk_y):
            ysize = min(chunk_y, height - yoff)
            percent = int(round(((yoff + ysize) / height) * 100))
            log(f"      Encoding rows {yoff + 1}-{yoff + ysize} of {height} ({percent}% done)...")
            for xoff in range(0, width, chunk_x):
                xsize = min(chunk_x, width - xoff)
                arr = warped_band.ReadAsArray(xoff, yoff, xsize, ysize).astype(np.float64)

                if warped_nodata is not None:
                    mask = np.isclose(arr, warped_nodata)
                elif src_nodata is not None:
                    mask = np.isclose(arr, src_nodata)
                else:
                    mask = None

                encoded = np.rint((arr - base) / interval).astype(np.int64)
                encoded = np.clip(encoded, 0, 16777215)

                red = ((encoded >> 16) & 255).astype(np.uint8)
                green = ((encoded >> 8) & 255).astype(np.uint8)
                blue = (encoded & 255).astype(np.uint8)

                if mask is not None and mask.any():
                    red[mask] = 0
                    green[mask] = 0
                    blue[mask] = 0

                rgb_ds.GetRasterBand(1).WriteArray(red, xoff, yoff)
                rgb_ds.GetRasterBand(2).WriteArray(green, xoff, yoff)
                rgb_ds.GetRasterBand(3).WriteArray(blue, xoff, yoff)

        rgb_ds.FlushCache()
    finally:
        rgb_ds = None


def encode_terrain_rgb(
    src_path: Path,
    work_dir: Path,
    target_srs: str,
    base: float,
    interval: float,
    resample_alg: str,
    target_res: float | None = None,
    output_name: str = "rgb.tif",
) -> tuple[Path, tuple[float, float, float, float]]:
    src_ds = gdal.Open(str(src_path))
    if src_ds is None:
        raise FileNotFoundError(f"Could not open {src_path}")

    src_band = src_ds.GetRasterBand(1)
    src_nodata = src_band.GetNoDataValue()

    warped_path = work_dir / "warped.vrt"
    rgb_path = work_dir / output_name

    warp_kwargs = {
        "format": "VRT",
        "dstSRS": target_srs,
        "dstNodata": None,
        "resampleAlg": RESAMPLE_ALG_MAP[resample_alg],
        "multithread": True,
    }
    if src_nodata is not None:
        warp_kwargs["srcNodata"] = src_nodata
    if target_res is not None:
        warp_kwargs["xRes"] = target_res
        warp_kwargs["yRes"] = target_res

    try:
        log("[1/4] Reprojecting and encoding RGB...")
        warped_ds = gdal.Warp(str(warped_path), src_ds, **warp_kwargs)
        if warped_ds is None:
            raise RuntimeError("gdal.Warp failed")

        log(f"      Warped VRT created at {warped_path.name}.")

        try:
            write_rgb_blocks(warped_ds, rgb_path, base, interval, src_nodata)
        finally:
            warped_ds = None

        log("      RGB GeoTIFF ready.")

        rgb_check_ds = gdal.Open(str(rgb_path))
        if rgb_check_ds is None:
            raise RuntimeError("Failed to reopen RGB GeoTIFF for bounds inspection")
        try:
            gt = rgb_check_ds.GetGeoTransform()
            width = rgb_check_ds.RasterXSize
            height = rgb_check_ds.RasterYSize
        finally:
            rgb_check_ds = None
        return rgb_path, compute_bounds(gt, width, height)
    except Exception:
        log("      Conversion error diagnostics:")
        log_gdalinfo(src_path, "Input")
        if warped_path.exists():
            log_gdalinfo(warped_path, "Warped")
        if rgb_path.exists():
            log_gdalinfo(rgb_path, "RGB")
        raise


def compute_auto_zoom(rgb_path: Path, max_zoom_limit: int = 30) -> int:
    rgb_ds = gdal.Open(str(rgb_path))
    if rgb_ds is None:
        raise RuntimeError("Failed to reopen RGB GeoTIFF to determine zoom level")
    gt = rgb_ds.GetGeoTransform()
    rgb_ds = None
    res_deg = abs(gt[1])
    if res_deg <= 0:
        raise ValueError("Cannot compute automatic zoom from a non-positive pixel size")
    max_zoom = int(math.floor(math.log2(360.0 / (256.0 * res_deg))))
    return max(0, min(max_zoom, max_zoom_limit))


def compute_tile_matrix_size(width: int, height: int) -> tuple[int, int]:
    return math.ceil(width / TILE_SIZE), math.ceil(height / TILE_SIZE)


def create_terrain_rgb_schema(conn: sqlite3.Connection, table_name: str) -> None:
    table_identifier = quote_identifier(table_name)
    table_name_sql = table_name.replace("'", "''")

    conn.executescript(
        f"""
        CREATE TABLE {table_identifier} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zoom_level INTEGER NOT NULL,
            tile_column INTEGER NOT NULL,
            tile_row INTEGER NOT NULL,
            tile_data BLOB NOT NULL,
            UNIQUE (zoom_level, tile_column, tile_row)
        );
        CREATE TRIGGER {table_name}_tile_column_insert BEFORE INSERT ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'insert on table ''{table_name}'' violates constraint: tile_column cannot be < 0') WHERE (NEW.tile_column < 0);
          SELECT RAISE(ABORT, 'insert on table ''{table_name}'' violates constraint: tile_column must by < matrix_width specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_column < (SELECT matrix_width FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}') AND zoom_level = NEW.zoom_level));
        END;
        CREATE TRIGGER {table_name}_tile_column_update BEFORE UPDATE OF tile_column ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'update on table ''{table_name}'' violates constraint: tile_column cannot be < 0') WHERE (NEW.tile_column < 0);
          SELECT RAISE(ABORT, 'update on table ''{table_name}'' violates constraint: tile_column must by < matrix_width specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_column < (SELECT matrix_width FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}') AND zoom_level = NEW.zoom_level));
        END;
        CREATE TRIGGER {table_name}_tile_row_insert BEFORE INSERT ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'insert on table ''{table_name}'' violates constraint: tile_row cannot be < 0') WHERE (NEW.tile_row < 0);
          SELECT RAISE(ABORT, 'insert on table ''{table_name}'' violates constraint: tile_row must by < matrix_height specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_row < (SELECT matrix_height FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}') AND zoom_level = NEW.zoom_level));
        END;
        CREATE TRIGGER {table_name}_tile_row_update BEFORE UPDATE OF tile_row ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'update on table ''{table_name}'' violates constraint: tile_row cannot be < 0') WHERE (NEW.tile_row < 0);
          SELECT RAISE(ABORT, 'update on table ''{table_name}'' violates constraint: tile_row must by < matrix_height specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_row < (SELECT matrix_height FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}') AND zoom_level = NEW.zoom_level));
        END;
        CREATE TRIGGER {table_name}_zoom_insert BEFORE INSERT ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'insert on table ''{table_name}'' violates constraint: zoom_level not specified for table in gpkg_tile_matrix') WHERE NOT (NEW.zoom_level IN (SELECT zoom_level FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}')));
        END;
        CREATE TRIGGER {table_name}_zoom_update BEFORE UPDATE OF zoom_level ON {table_identifier} FOR EACH ROW BEGIN
          SELECT RAISE(ABORT, 'update on table ''{table_name}'' violates constraint: zoom_level not specified for table in gpkg_tile_matrix') WHERE NOT (NEW.zoom_level IN (SELECT zoom_level FROM gpkg_tile_matrix WHERE lower(table_name) = lower('{table_name_sql}')));
        END;
        """
    )


def register_terrain_rgb_table(
    conn: sqlite3.Connection,
    table_name: str,
    identifier: str,
    description: str,
    bbox: tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
) -> None:
    conn.execute(
        "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (table_name, "tiles", identifier, description, bbox[0], bbox[1], bbox[2], bbox[3], 4326),
    )
    conn.execute(
        "INSERT INTO gpkg_tile_matrix_set (table_name, srs_id, min_x, min_y, max_x, max_y) VALUES (?, ?, ?, ?, ?, ?)",
        (table_name, 4326, -180.0, -90.0, 180.0, 270.0),
    )

    for zoom in range(min_zoom, max_zoom + 1):
        matrix = 2 ** zoom
        pixel = 360.0 / (matrix * 256.0)
        conn.execute(
            "INSERT INTO gpkg_tile_matrix (table_name, zoom_level, matrix_width, matrix_height, tile_width, tile_height, pixel_x_size, pixel_y_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (table_name, zoom, matrix, matrix, TILE_SIZE, TILE_SIZE, pixel, pixel),
        )


def register_native_terrain_rgb_table(
    conn: sqlite3.Connection,
    table_name: str,
    identifier: str,
    description: str,
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
    pixel_x_size: float,
    pixel_y_size: float,
) -> None:
    conn.execute(
        "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (table_name, "tiles", identifier, description, bbox[0], bbox[1], bbox[2], bbox[3], 4326),
    )
    conn.execute(
        "INSERT INTO gpkg_tile_matrix_set (table_name, srs_id, min_x, min_y, max_x, max_y) VALUES (?, ?, ?, ?, ?, ?)",
        (table_name, 4326, bbox[0], bbox[1], bbox[2], bbox[3]),
    )
    matrix_width, matrix_height = compute_tile_matrix_size(width, height)
    conn.execute(
        "INSERT INTO gpkg_tile_matrix (table_name, zoom_level, matrix_width, matrix_height, tile_width, tile_height, pixel_x_size, pixel_y_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (table_name, 0, matrix_width, matrix_height, TILE_SIZE, TILE_SIZE, pixel_x_size, pixel_y_size),
    )


def import_tiles_for_table(
    conn: sqlite3.Connection,
    table_name: str,
    tile_root: Path,
    zoom_filter: Callable[[int], bool],
) -> tuple[int, int]:
    table_identifier = quote_identifier(table_name)
    total_tiles = 0
    imported_tiles = 0

    for z_dir in sorted([p for p in tile_root.iterdir() if p.is_dir() and p.name.isdigit()], key=lambda p: int(p.name)):
        zoom = int(z_dir.name)
        if not zoom_filter(zoom):
            continue

        zoom_tiles = 0
        log(f"      Zoom {zoom}: importing tiles into {table_name}...")
        for x_dir in sorted([p for p in z_dir.iterdir() if p.is_dir() and p.name.isdigit()], key=lambda p: int(p.name)):
            tile_column = int(x_dir.name)
            for png_path in sorted(x_dir.glob("*.png"), key=lambda p: int(p.stem)):
                tile_row = int(png_path.stem)
                conn.execute(
                    f"INSERT INTO {table_identifier} (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    (zoom, tile_column, tile_row, sqlite3.Binary(png_path.read_bytes())),
                )
                total_tiles += 1
                zoom_tiles += 1
                imported_tiles += 1
        log(f"        {zoom_tiles} tiles imported at zoom {zoom}.")

    return total_tiles, imported_tiles


def import_raster_tiles_for_table(
    conn: sqlite3.Connection,
    table_name: str,
    rgb_path: Path,
    work_dir: Path,
) -> tuple[int, int]:
    table_identifier = quote_identifier(table_name)
    rgb_ds = gdal.Open(str(rgb_path))
    if rgb_ds is None:
        raise FileNotFoundError(f"Could not open {rgb_path}")

    if rgb_ds.RasterCount < 3:
        raise RuntimeError(f"{rgb_path} does not contain a 3-band RGB raster")

    width = rgb_ds.RasterXSize
    height = rgb_ds.RasterYSize
    total_tiles = 0
    imported_tiles = 0
    matrix_width, matrix_height = compute_tile_matrix_size(width, height)
    total_expected = matrix_width * matrix_height
    tile_png_path = work_dir / f"{table_name}.png"
    mem_driver = gdal.GetDriverByName("MEM")
    if mem_driver is None:
        raise RuntimeError("GDAL MEM driver is unavailable")

    for yoff in range(0, height, TILE_SIZE):
        ysize = min(TILE_SIZE, height - yoff)
        tile_row = yoff // TILE_SIZE
        for xoff in range(0, width, TILE_SIZE):
            xsize = min(TILE_SIZE, width - xoff)
            tile_column = xoff // TILE_SIZE
            window = rgb_ds.ReadAsArray(xoff, yoff, xsize, ysize)
            if window is None:
                raise RuntimeError(f"Failed to read {table_name} tile at {xoff},{yoff}")

            if window.ndim == 2:
                window = window[np.newaxis, ...]
            if window.shape[0] < 3:
                raise RuntimeError(f"{rgb_path} returned fewer than 3 bands while importing {table_name}")

            padded = np.zeros((3, TILE_SIZE, TILE_SIZE), dtype=np.uint8)
            padded[:, :ysize, :xsize] = window[:3]

            tile_ds = mem_driver.Create("", TILE_SIZE, TILE_SIZE, 3, gdal.GDT_Byte)
            if tile_ds is None:
                raise RuntimeError("Failed to create in-memory PNG tile")

            try:
                for band_index in range(3):
                    tile_ds.GetRasterBand(band_index + 1).WriteArray(padded[band_index])

                if tile_png_path.exists():
                    tile_png_path.unlink()
                translated = gdal.Translate(str(tile_png_path), tile_ds, format="PNG")
                if translated is None:
                    raise RuntimeError("Failed to encode PNG tile")
                translated = None

                conn.execute(
                    f"INSERT INTO {table_identifier} (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    (0, tile_column, tile_row, sqlite3.Binary(tile_png_path.read_bytes())),
                )
                total_tiles += 1
                imported_tiles += 1
                if total_expected:
                    percent = int(round((imported_tiles / total_expected) * 100))
                    if imported_tiles == total_expected or imported_tiles % 50 == 0:
                        log(f"        Imported {imported_tiles}/{total_expected} tiles ({percent}% done).")
            finally:
                tile_ds = None

    return total_tiles, imported_tiles


def run_gdal2tiles(rgb_path: Path, tiles_dir: Path, min_zoom: int, max_zoom: int, processes: int) -> None:
    log(f"[2/4] Cutting tiles with gdal2tiles ({min_zoom}-{max_zoom})...")
    cmd = [
        sys.executable,
        "-m",
        "osgeo_utils.gdal2tiles",
        "-p",
        "geodetic",
        "--xyz",
        "-n",
        "-w",
        "none",
        "-q",
        "--processes",
        str(processes),
        "-z",
        f"{min_zoom}-{max_zoom}",
        str(rgb_path),
        str(tiles_dir),
    ]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"gdal2tiles failed with exit code {result.returncode}")
    log("      Tile pyramid ready.")


def create_gpkg(
    display_tile_dir: Path,
    native_rgb_path: Path,
    output_path: Path,
    identifier: str,
    source_name: str,
    display_bbox: tuple[float, float, float, float],
    native_bbox: tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
) -> None:
    log("[3/4] Wrapping tiles into GeoPackage...")
    if output_path.exists():
        output_path.unlink()

    conn = sqlite3.connect(str(output_path))
    try:
        conn.execute("PRAGMA application_id = 1196444487")
        conn.execute(f"PRAGMA user_version = {load_user_version_from_pixi()}")
        conn.execute("PRAGMA foreign_keys = ON")

        conn.executescript(
            """
            CREATE TABLE gpkg_spatial_ref_sys (
                srs_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL PRIMARY KEY,
                organization TEXT NOT NULL,
                organization_coordsys_id INTEGER NOT NULL,
                definition TEXT NOT NULL,
                description TEXT
            );

            CREATE TABLE gpkg_contents (
                table_name TEXT NOT NULL PRIMARY KEY,
                data_type TEXT NOT NULL,
                identifier TEXT UNIQUE,
                description TEXT DEFAULT '',
                last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                min_x DOUBLE,
                min_y DOUBLE,
                max_x DOUBLE,
                max_y DOUBLE,
                srs_id INTEGER,
                CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
            );

            CREATE TABLE gpkg_geometry_columns (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                geometry_type_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL,
                z TINYINT NOT NULL,
                m TINYINT NOT NULL,
                CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
                CONSTRAINT uk_gc_table_name UNIQUE (table_name),
                CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
                CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
            );

            CREATE TABLE gpkg_metadata (
                id INTEGER CONSTRAINT m_pk PRIMARY KEY ASC NOT NULL,
                md_scope TEXT NOT NULL DEFAULT 'dataset',
                md_standard_uri TEXT NOT NULL,
                mime_type TEXT NOT NULL DEFAULT 'text/xml',
                metadata TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE gpkg_metadata_reference (
                reference_scope TEXT NOT NULL,
                table_name TEXT,
                column_name TEXT,
                row_id_value INTEGER,
                timestamp DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                md_file_id INTEGER NOT NULL,
                md_parent_id INTEGER,
                CONSTRAINT crmr_mfi_fk FOREIGN KEY (md_file_id) REFERENCES gpkg_metadata(id),
                CONSTRAINT crmr_mpi_fk FOREIGN KEY (md_parent_id) REFERENCES gpkg_metadata(id)
            );

            CREATE TABLE gpkg_ogr_contents(
                table_name TEXT NOT NULL PRIMARY KEY,
                feature_count INTEGER DEFAULT NULL
            );

            CREATE TABLE gpkg_extensions (
                table_name TEXT,
                column_name TEXT,
                extension_name TEXT NOT NULL,
                definition TEXT NOT NULL,
                scope TEXT NOT NULL,
                CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name)
            );

            CREATE TABLE gpkg_tile_matrix (
                table_name TEXT NOT NULL,
                zoom_level INTEGER NOT NULL,
                matrix_width INTEGER NOT NULL,
                matrix_height INTEGER NOT NULL,
                tile_width INTEGER NOT NULL,
                tile_height INTEGER NOT NULL,
                pixel_x_size DOUBLE NOT NULL,
                pixel_y_size DOUBLE NOT NULL,
                CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level),
                CONSTRAINT fk_tmm_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name)
            );

            CREATE TABLE gpkg_tile_matrix_set (
                table_name TEXT NOT NULL PRIMARY KEY,
                srs_id INTEGER NOT NULL,
                min_x DOUBLE NOT NULL,
                min_y DOUBLE NOT NULL,
                max_x DOUBLE NOT NULL,
                max_y DOUBLE NOT NULL,
                CONSTRAINT fk_gtms_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
                CONSTRAINT fk_gtms_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
            );
            """
        )

        conn.executescript(
            """
            CREATE TRIGGER gpkg_tile_matrix_matrix_height_insert BEFORE INSERT ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''gpkg_tile_matrix'' violates constraint: matrix_height cannot be less than 1') WHERE (NEW.matrix_height < 1);
            END;
            CREATE TRIGGER gpkg_tile_matrix_matrix_height_update BEFORE UPDATE OF matrix_height ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''gpkg_tile_matrix'' violates constraint: matrix_height cannot be less than 1') WHERE (NEW.matrix_height < 1);
            END;
            CREATE TRIGGER gpkg_tile_matrix_matrix_width_insert BEFORE INSERT ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''gpkg_tile_matrix'' violates constraint: matrix_width cannot be less than 1') WHERE (NEW.matrix_width < 1);
            END;
            CREATE TRIGGER gpkg_tile_matrix_matrix_width_update BEFORE UPDATE OF matrix_width ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''gpkg_tile_matrix'' violates constraint: matrix_width cannot be less than 1') WHERE (NEW.matrix_width < 1);
            END;
            CREATE TRIGGER gpkg_tile_matrix_pixel_x_size_insert BEFORE INSERT ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''gpkg_tile_matrix'' violates constraint: pixel_x_size must be greater than 0') WHERE NOT (NEW.pixel_x_size > 0);
            END;
            CREATE TRIGGER gpkg_tile_matrix_pixel_x_size_update BEFORE UPDATE OF pixel_x_size ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''gpkg_tile_matrix'' violates constraint: pixel_x_size must be greater than 0') WHERE NOT (NEW.pixel_x_size > 0);
            END;
            CREATE TRIGGER gpkg_tile_matrix_pixel_y_size_insert BEFORE INSERT ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''gpkg_tile_matrix'' violates constraint: pixel_y_size must be greater than 0') WHERE NOT (NEW.pixel_y_size > 0);
            END;
            CREATE TRIGGER gpkg_tile_matrix_pixel_y_size_update BEFORE UPDATE OF pixel_y_size ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''gpkg_tile_matrix'' violates constraint: pixel_y_size must be greater than 0') WHERE NOT (NEW.pixel_y_size > 0);
            END;
            CREATE TRIGGER gpkg_tile_matrix_zoom_level_insert BEFORE INSERT ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''gpkg_tile_matrix'' violates constraint: zoom_level cannot be less than 0') WHERE (NEW.zoom_level < 0);
            END;
            CREATE TRIGGER gpkg_tile_matrix_zoom_level_update BEFORE UPDATE OF zoom_level ON gpkg_tile_matrix FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''gpkg_tile_matrix'' violates constraint: zoom_level cannot be less than 0') WHERE (NEW.zoom_level < 0);
            END;
            """
        )

        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            (
                "Undefined Cartesian",
                -1,
                "NONE",
                -1,
                "undefined",
                "undefined",
            ),
        )
        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            (
                "Undefined geographic",
                0,
                "NONE",
                0,
                "undefined",
                "undefined",
            ),
        )
        srs = osr.SpatialReference()
        srs.ImportFromEPSG(4326)
        conn.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
            (
                "WGS 84 geodetic",
                4326,
                "EPSG",
                4326,
                srs.ExportToWkt(),
                "longitude/latitude coordinates in WGS 84",
            ),
        )

        create_terrain_rgb_schema(conn, "terrain_rgb_native")
        native_rgb_ds = gdal.Open(str(native_rgb_path))
        if native_rgb_ds is None:
            raise FileNotFoundError(f"Could not open {native_rgb_path}")
        try:
            native_gt = native_rgb_ds.GetGeoTransform()
            native_width = native_rgb_ds.RasterXSize
            native_height = native_rgb_ds.RasterYSize
        finally:
            native_rgb_ds = None

        register_native_terrain_rgb_table(
            conn,
            "terrain_rgb_native",
            f"{identifier}_native",
            NATIVE_DESCRIPTION,
            native_bbox,
            native_width,
            native_height,
            abs(native_gt[1]),
            abs(native_gt[5]),
        )

        create_terrain_rgb_schema(conn, "terrain_rgb")
        register_terrain_rgb_table(
            conn,
            "terrain_rgb",
            identifier,
            DESCRIPTION,
            display_bbox,
            min_zoom,
            max_zoom,
        )

        conn.execute(
            "INSERT INTO gpkg_metadata (id, md_scope, md_standard_uri, mime_type, metadata) VALUES (?, ?, ?, ?, ?)",
            (
                1,
                "dataset",
                "http://gdal.org",
                "text/xml",
                f"""<GDALMultiDomainMetadata>
  <Metadata>
    <MDI key="NAME">{source_name}</MDI>
  </Metadata>
</GDALMultiDomainMetadata>
""",
            ),
        )
        conn.execute(
            "INSERT INTO gpkg_metadata_reference (reference_scope, table_name, column_name, row_id_value, md_file_id, md_parent_id) VALUES (?, ?, ?, ?, ?, ?)",
            ("table", "terrain_rgb", None, None, 1, None),
        )
        conn.execute(
            "INSERT INTO gpkg_metadata_reference (reference_scope, table_name, column_name, row_id_value, md_file_id, md_parent_id) VALUES (?, ?, ?, ?, ?, ?)",
            ("table", "terrain_rgb_native", None, None, 1, None),
        )
        conn.execute(
            "INSERT INTO gpkg_extensions (table_name, column_name, extension_name, definition, scope) VALUES (?, ?, ?, ?, ?)",
            (
                "gpkg_metadata",
                None,
                "gpkg_metadata",
                "http://www.geopackage.org/spec120/#extension_metadata",
                "read-write",
            ),
        )
        conn.execute(
            "INSERT INTO gpkg_extensions (table_name, column_name, extension_name, definition, scope) VALUES (?, ?, ?, ?, ?)",
            (
                "gpkg_metadata_reference",
                None,
                "gpkg_metadata",
                "http://www.geopackage.org/spec120/#extension_metadata",
                "read-write",
            ),
        )

        tile_root = display_tile_dir
        if not tile_root.exists():
            raise FileNotFoundError(f"Missing gdal2tiles output at {tile_root}")

        imported_tiles = 0
        _, display_imported = import_tiles_for_table(
            conn,
            "terrain_rgb",
            tile_root,
            lambda zoom: True,
        )
        imported_tiles += display_imported
        _, native_imported = import_raster_tiles_for_table(
            conn,
            "terrain_rgb_native",
            native_rgb_path,
            display_tile_dir.parent,
        )
        imported_tiles += native_imported

        conn.commit()
        if imported_tiles == 0:
            raise RuntimeError("No PNG tiles were found to wrap into the GeoPackage")
        log("      GeoPackage ready.")
    finally:
        conn.close()

def tile_has_transparency(tile_blob: bytes) -> bool:
    mem_path = "/vsimem/prune_tile.png"
    gdal.FileFromMemBuffer(mem_path, tile_blob)
    try:
        tile_ds = gdal.Open(mem_path)
        if tile_ds is None:
            return True

        if tile_ds.RasterCount < 4:
            return False

        alpha_band = tile_ds.GetRasterBand(4)
        alpha = alpha_band.ReadAsArray()
        if alpha is None:
            return True
        return bool(np.any(alpha < 255))
    finally:
        gdal.Unlink(mem_path)


def prune_transparent_tiles(output_path: Path) -> tuple[int, int]:
    conn = sqlite3.connect(str(output_path))
    conn.row_factory = sqlite3.Row
    total_tiles = 0
    pruned_tiles = 0

    try:
        table_rows = conn.execute(
            "SELECT table_name FROM gpkg_contents WHERE data_type = 'tiles' ORDER BY table_name"
        ).fetchall()
        if not table_rows:
            raise RuntimeError(f"No tile tables were found in {output_path}")

        for table_row in table_rows:
            table_name = table_row["table_name"]
            if table_name == "terrain_rgb_native":
                continue
            table_identifier = '"' + table_name.replace('"', '""') + '"'
            delete_rows: list[tuple[int, int, int]] = []
            table_total = 0
            table_pruned = 0

            rows = conn.execute(
                f"SELECT zoom_level, tile_column, tile_row, tile_data FROM {table_identifier} ORDER BY zoom_level, tile_row, tile_column"
            ).fetchall()
            for row in rows:
                total_tiles += 1
                table_total += 1
                if tile_has_transparency(row["tile_data"]):
                    pruned_tiles += 1
                    table_pruned += 1
                    delete_rows.append((row["zoom_level"], row["tile_column"], row["tile_row"]))

            if delete_rows:
                conn.executemany(
                    f"DELETE FROM {table_identifier} WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                    delete_rows,
                )
                conn.execute(
                    "UPDATE gpkg_contents SET last_change = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE table_name = ?",
                    (table_name,),
                )

        conn.commit()
        if pruned_tiles:
            conn.execute("VACUUM")
        return total_tiles, pruned_tiles
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
def build_gpkg(
    src_path: Path,
    output_path: Path,
    target_srs: str,
    base: float,
    interval: float,
    resample_alg: str,
    min_zoom: int | None,
    max_zoom: int | None,
    auto_zoom: bool,
) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        work_dir = Path(tmpdir)
        native_rgb_path, native_bbox = encode_terrain_rgb(
            src_path,
            work_dir,
            target_srs,
            base,
            interval,
            resample_alg,
            output_name="native_rgb.tif",
        )
        if auto_zoom:
            auto_max_zoom = compute_auto_zoom(native_rgb_path)
            log(f"      Auto zoom ceiling selected: {auto_max_zoom}")
            if max_zoom is None:
                max_zoom = auto_max_zoom
            else:
                max_zoom = min(max_zoom, auto_max_zoom)
            if min_zoom is None:
                min_zoom = max(0, max_zoom - 6)
        if min_zoom is not None and max_zoom is not None and min_zoom > max_zoom:
            raise ValueError("Computed or supplied minimum zoom cannot be greater than the final maximum zoom")
        tiles_dir = work_dir / "tiles"
        tiles_dir.mkdir(parents=True, exist_ok=True)
        processes = max(1, min(8, (os.cpu_count() or 1)))
        if min_zoom is None or max_zoom is None:
            raise ValueError("gpkg output requires either --auto-zoom or both --min-zoom and --max-zoom")
        display_target_res = 360.0 / ((2 ** max_zoom) * 256.0)
        display_rgb_path, display_bbox = encode_terrain_rgb(
            src_path,
            work_dir,
            target_srs,
            base,
            interval,
            resample_alg,
            target_res=display_target_res,
            output_name="display_rgb.tif",
        )
        run_gdal2tiles(display_rgb_path, tiles_dir, min_zoom, max_zoom, processes)
        source_name = f"{output_path.stem}.tif"
        create_gpkg(
            tiles_dir,
            native_rgb_path,
            output_path,
            output_path.stem,
            source_name,
            display_bbox,
            native_bbox,
            min_zoom,
            max_zoom,
        )
        total_tiles, pruned_tiles = prune_transparent_tiles(output_path)
        log(f"[4/4] Pruned {pruned_tiles} of {total_tiles} tiles from resampled layers.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a terrain-RGB GeoPackage from a GeoTIFF.")
    parser.add_argument("input", type=Path, help="Input GeoTIFF")
    parser.add_argument("output", type=Path, help="Output GeoPackage")
    parser.add_argument("--target-srs", default="EPSG:4326", help="Target CRS for reprojection")
    parser.add_argument("--base", type=float, default=-10000.0, help="Terrain-RGB base value")
    parser.add_argument("--interval", type=float, default=0.1, help="Terrain-RGB interval value")
    parser.add_argument(
        "--resample-alg",
        choices=sorted(RESAMPLE_ALG_MAP),
        default="max",
        help="GDAL resampling algorithm used during reprojection",
    )
    parser.add_argument("--min-zoom", type=int, help="Minimum zoom level for output")
    parser.add_argument("--max-zoom", type=int, help="Maximum zoom level for output")
    parser.add_argument("--auto-zoom", action="store_true", help="Automatically choose the highest useful zoom from the input resolution")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = args.output if args.output.suffix else args.output.with_suffix(".gpkg")
    if not args.auto_zoom and (args.min_zoom is None or args.max_zoom is None):
        raise ValueError("gpkg output requires --min-zoom and --max-zoom unless --auto-zoom is set")
    if args.min_zoom is not None and args.max_zoom is not None and args.min_zoom > args.max_zoom:
        raise ValueError("--min-zoom cannot be greater than --max-zoom")
    build_gpkg(
        args.input,
        output_path,
        args.target_srs,
        args.base,
        args.interval,
        args.resample_alg,
        args.min_zoom,
        args.max_zoom,
        args.auto_zoom,
    )


if __name__ == "__main__":
    main()
