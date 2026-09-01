from __future__ import annotations

import argparse
import os
import math
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from osgeo import gdal, osr


gdal.UseExceptions()
gdal.SetConfigOption("GDAL_TIFF_INTERNAL_BIGTIFF", "YES")
gdal.SetConfigOption("BIGTIFF_DEF", "YES")

GPKG_APP_ID = 0x47504B47  # "GPKG"
DESCRIPTION = "Terrain-RGB tile pyramid wrapped without pixel changes"


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
            "BLOCKXSIZE=256",
            "BLOCKYSIZE=256",
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
    target_res: float | None = None,
) -> tuple[Path, tuple[float, float, float, float]]:
    src_ds = gdal.Open(str(src_path))
    if src_ds is None:
        raise FileNotFoundError(f"Could not open {src_path}")

    src_band = src_ds.GetRasterBand(1)
    src_nodata = src_band.GetNoDataValue()

    warped_path = work_dir / "warped.vrt"
    rgb_path = work_dir / "rgb.tif"

    warp_kwargs = {
        "format": "VRT",
        "dstSRS": target_srs,
        "dstNodata": None,
        "resampleAlg": gdal.GRA_Lanczos,
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
    max_zoom = int(math.ceil(math.log2(360.0 / (256.0 * res_deg))))
    return max(0, min(max_zoom, max_zoom_limit))


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
        "-v",
        "--processes",
        str(processes),
        "-r",
        "near",
        "-z",
        f"{min_zoom}-{max_zoom}",
        str(rgb_path),
        str(tiles_dir),
    ]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"gdal2tiles failed with exit code {result.returncode}")
    log("      Tile pyramid ready.")


def create_gpkg(tile_dir: Path, output_path: Path, identifier: str, source_name: str, bbox: tuple[float, float, float, float], min_zoom: int, max_zoom: int) -> None:
    log("[3/4] Wrapping tiles into GeoPackage...")
    if output_path.exists():
        output_path.unlink()

    conn = sqlite3.connect(str(output_path))
    try:
        conn.execute("PRAGMA application_id = 1196444487")
        conn.execute("PRAGMA user_version = 10200")
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

            CREATE TABLE terrain_rgb (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                zoom_level INTEGER NOT NULL,
                tile_column INTEGER NOT NULL,
                tile_row INTEGER NOT NULL,
                tile_data BLOB NOT NULL,
                UNIQUE (zoom_level, tile_column, tile_row)
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

        conn.executescript(
            """
            CREATE TRIGGER terrain_rgb_tile_column_insert BEFORE INSERT ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''terrain_rgb'' violates constraint: tile_column cannot be < 0') WHERE (NEW.tile_column < 0);
              SELECT RAISE(ABORT, 'insert on table ''terrain_rgb'' violates constraint: tile_column must by < matrix_width specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_column < (SELECT matrix_width FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb') AND zoom_level = NEW.zoom_level));
            END;
            CREATE TRIGGER terrain_rgb_tile_column_update BEFORE UPDATE OF tile_column ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''terrain_rgb'' violates constraint: tile_column cannot be < 0') WHERE (NEW.tile_column < 0);
              SELECT RAISE(ABORT, 'update on table ''terrain_rgb'' violates constraint: tile_column must by < matrix_width specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_column < (SELECT matrix_width FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb') AND zoom_level = NEW.zoom_level));
            END;
            CREATE TRIGGER terrain_rgb_tile_row_insert BEFORE INSERT ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''terrain_rgb'' violates constraint: tile_row cannot be < 0') WHERE (NEW.tile_row < 0);
              SELECT RAISE(ABORT, 'insert on table ''terrain_rgb'' violates constraint: tile_row must by < matrix_height specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_row < (SELECT matrix_height FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb') AND zoom_level = NEW.zoom_level));
            END;
            CREATE TRIGGER terrain_rgb_tile_row_update BEFORE UPDATE OF tile_row ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''terrain_rgb'' violates constraint: tile_row cannot be < 0') WHERE (NEW.tile_row < 0);
              SELECT RAISE(ABORT, 'update on table ''terrain_rgb'' violates constraint: tile_row must by < matrix_height specified for table and zoom level in gpkg_tile_matrix') WHERE NOT (NEW.tile_row < (SELECT matrix_height FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb') AND zoom_level = NEW.zoom_level));
            END;
            CREATE TRIGGER terrain_rgb_zoom_insert BEFORE INSERT ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'insert on table ''terrain_rgb'' violates constraint: zoom_level not specified for table in gpkg_tile_matrix') WHERE NOT (NEW.zoom_level IN (SELECT zoom_level FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb')));
            END;
            CREATE TRIGGER terrain_rgb_zoom_update BEFORE UPDATE OF zoom_level ON terrain_rgb FOR EACH ROW BEGIN
              SELECT RAISE(ABORT, 'update on table ''terrain_rgb'' violates constraint: zoom_level not specified for table in gpkg_tile_matrix') WHERE NOT (NEW.zoom_level IN (SELECT zoom_level FROM gpkg_tile_matrix WHERE lower(table_name) = lower('terrain_rgb')));
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

        conn.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ( "terrain_rgb", "tiles", identifier, DESCRIPTION, bbox[0], bbox[1], bbox[2], bbox[3], 4326),
        )
        conn.execute(
            "INSERT INTO gpkg_tile_matrix_set (table_name, srs_id, min_x, min_y, max_x, max_y) VALUES (?, ?, ?, ?, ?, ?)",
            ("terrain_rgb", 4326, -180.0, -90.0, 180.0, 270.0),
        )

        for zoom in range(min_zoom, max_zoom + 1):
            matrix = 2 ** zoom
            pixel = 360.0 / (matrix * 256.0)
            conn.execute(
                "INSERT INTO gpkg_tile_matrix (table_name, zoom_level, matrix_width, matrix_height, tile_width, tile_height, pixel_x_size, pixel_y_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("terrain_rgb", zoom, matrix, matrix, 256, 256, pixel, pixel),
            )

        conn.execute(
            "INSERT INTO gpkg_metadata (id, md_scope, md_standard_uri, mime_type, metadata) VALUES (?, ?, ?, ?, ?)",
            (
                1,
                "dataset",
                "http://gdal.org",
                "text/xml",
                f"<GDALMultiDomainMetadata>\n  <Metadata>\n    <MDI key=\"NAME\">{source_name}</MDI>\n  </Metadata>\n</GDALMultiDomainMetadata>\n",
            ),
        )
        conn.execute(
            "INSERT INTO gpkg_metadata_reference (reference_scope, table_name, column_name, row_id_value, md_file_id, md_parent_id) VALUES (?, ?, ?, ?, ?, ?)",
            ("table", "terrain_rgb", None, None, 1, None),
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

        tile_root = tile_dir
        if not tile_root.exists():
            raise FileNotFoundError(f"Missing gdal2tiles output at {tile_root}")

        total_tiles = sum(
            1
            for z_dir in tile_root.iterdir()
            if z_dir.is_dir() and z_dir.name.isdigit()
            for x_dir in z_dir.iterdir()
            if x_dir.is_dir() and x_dir.name.isdigit()
            for _ in x_dir.glob("*.png")
        )
        imported_tiles = 0
        blobs = 0
        for z_dir in sorted([p for p in tile_root.iterdir() if p.is_dir() and p.name.isdigit()], key=lambda p: int(p.name)):
            zoom = int(z_dir.name)
            zoom_tiles = 0
            log(f"      Zoom {zoom}: importing tiles...")
            for x_dir in sorted([p for p in z_dir.iterdir() if p.is_dir() and p.name.isdigit()], key=lambda p: int(p.name)):
                tile_column = int(x_dir.name)
                for png_path in sorted(x_dir.glob("*.png"), key=lambda p: int(p.stem)):
                    tile_row = int(png_path.stem)
                    conn.execute(
                        "INSERT INTO terrain_rgb (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                        (zoom, tile_column, tile_row, sqlite3.Binary(png_path.read_bytes())),
                    )
                    blobs += 1
                    zoom_tiles += 1
                    imported_tiles += 1
                    if total_tiles:
                        percent = int(round((imported_tiles / total_tiles) * 100))
                        if imported_tiles == total_tiles or imported_tiles % 50 == 0:
                            log(f"        Imported {imported_tiles}/{total_tiles} tiles ({percent}% done).")
            log(f"        {zoom_tiles} tiles imported at zoom {zoom}.")

        conn.commit()
        if blobs == 0:
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
                log(
                    f"      Pruned {table_pruned} of {table_total} tiles from {table_name} ({(table_pruned / table_total * 100):.2f}% removed)"
                )
            else:
                log(f"      No transparent tiles found in {table_name}.")

        conn.commit()
        if pruned_tiles:
            conn.execute("VACUUM")
        return total_tiles, pruned_tiles
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
def build_gpkg(src_path: Path, output_path: Path, target_srs: str, base: float, interval: float, min_zoom: int | None, max_zoom: int | None, auto_zoom: bool) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        work_dir = Path(tmpdir)
        if auto_zoom:
            src_ds = gdal.Open(str(src_path))
            if src_ds is None:
                raise FileNotFoundError(f"Could not open {src_path}")
            temp_vrt_path = work_dir / "temp_warp.vrt"
            try:
                temp_warp_ds = gdal.Warp(str(temp_vrt_path), src_ds, format="VRT", dstSRS=target_srs)
                if temp_warp_ds is None:
                    raise RuntimeError("Failed to create temporary VRT to determine zoom level")
                gt = temp_warp_ds.GetGeoTransform()
                res_deg = abs(gt[1])
            finally:
                temp_warp_ds = None
                src_ds = None
                try:
                    if temp_vrt_path.exists():
                        temp_vrt_path.unlink()
                except Exception:
                    pass

            if res_deg <= 0:
                raise ValueError("Cannot compute automatic zoom from a non-positive pixel size")
            auto_max_zoom = int(math.ceil(math.log2(360.0 / (256.0 * res_deg))))
            log(f"      Auto zoom ceiling selected: {auto_max_zoom}")
            if max_zoom is None:
                max_zoom = auto_max_zoom
            else:
                max_zoom = min(max_zoom, auto_max_zoom)
            if min_zoom is None:
                min_zoom = max(0, max_zoom - 6)

        if min_zoom is None or max_zoom is None:
            raise ValueError("gpkg output requires either --auto-zoom or both --min-zoom and --max-zoom")

        if min_zoom > max_zoom:
            raise ValueError("Computed or supplied minimum zoom cannot be greater than the final maximum zoom")

        # Compute exact target resolution in degrees per pixel matching the selected max_zoom
        target_res = 360.0 / ((2 ** max_zoom) * 256.0)

        # Warp the float elevation data directly to target_res, then encode to RGB
        rgb_path, bbox = encode_terrain_rgb(src_path, work_dir, target_srs, base, interval, target_res=target_res)

        tiles_dir = work_dir / "tiles"
        tiles_dir.mkdir(parents=True, exist_ok=True)
        processes = max(1, min(8, (os.cpu_count() or 1)))
        run_gdal2tiles(rgb_path, tiles_dir, min_zoom, max_zoom, processes)
        source_name = f"{output_path.stem}.tif"
        create_gpkg(tiles_dir, output_path, output_path.stem, source_name, bbox, min_zoom, max_zoom)
        log("[4/4] Pruning transparent tiles...")
        total_tiles, pruned_tiles = prune_transparent_tiles(output_path)
        removed_percent = (pruned_tiles / total_tiles * 100) if total_tiles else 0.0
        log(f"      Pruned {pruned_tiles} of {total_tiles} tiles ({removed_percent:.2f}% removed).")
        log("[4/4] Finished.")



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a terrain-RGB GeoPackage from a GeoTIFF.")
    parser.add_argument("input", type=Path, help="Input GeoTIFF")
    parser.add_argument("output", type=Path, help="Output GeoPackage")
    parser.add_argument("--target-srs", default="EPSG:4326", help="Target CRS for reprojection")
    parser.add_argument("--base", type=float, default=-10000.0, help="Terrain-RGB base value")
    parser.add_argument("--interval", type=float, default=0.1, help="Terrain-RGB interval value")
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
    build_gpkg(args.input, output_path, args.target_srs, args.base, args.interval, args.min_zoom, args.max_zoom, args.auto_zoom)


if __name__ == "__main__":
    main()
