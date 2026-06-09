from dataclasses import dataclass
from functools import lru_cache
from math import log, pi, tan
import sqlite3
import struct
import zlib
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
import rasterio
from fastapi import HTTPException
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds as window_from_bounds
from rasterio.warp import transform_bounds

from .config import TILE_SIZE, resolve_runtime_path


WEB_MERCATOR_HALF_WORLD = 20037508.342789244
WEB_MERCATOR_RADIUS = 6378137.0


@dataclass(frozen=True)
class TileMatrixMetadata:
    zoom_level: int
    matrix_width: int
    matrix_height: int
    tile_width: int
    tile_height: int
    pixel_x_size: float
    pixel_y_size: float
    min_tile_col: int
    max_tile_col: int
    min_tile_row: int
    max_tile_row: int


@dataclass(frozen=True)
class TileTableMetadata:
    table_name: str
    identifier: str
    srs_id: int
    supported_crs: str
    native_bounds: tuple[float, float, float, float]
    bounds_3857: tuple[float, float, float, float]
    tile_matrices: tuple[TileMatrixMetadata, ...]
    mime_type: str
    file_extension: str

    @property
    def min_zoom(self) -> int:
        return self.tile_matrices[0].zoom_level

    @property
    def max_zoom(self) -> int:
        return self.tile_matrices[-1].zoom_level

    @property
    def resolution(self) -> float:
        return min(matrix.pixel_x_size for matrix in self.tile_matrices)

    def tile_matrix_by_zoom(self, zoom_level: int) -> TileMatrixMetadata | None:
        for matrix in self.tile_matrices:
            if matrix.zoom_level == zoom_level:
                return matrix
        return None


@dataclass(frozen=True)
class GpkgSourceMetadata:
    path: str
    tables: tuple[TileTableMetadata, ...]
    bounds_3857: tuple[float, float, float, float]

    @property
    def crs(self) -> str:
        if not self.tables:
            return ""
        return self.tables[0].supported_crs

    @property
    def resolution(self) -> float:
        if not self.tables:
            return 0.0
        return min(table.resolution for table in self.tables)


WEB_MERCATOR_CRS = CRS.from_epsg(3857)
WGS84_CRS = CRS.from_epsg(4326)
WEB_MERCATOR_MIN = -WEB_MERCATOR_HALF_WORLD
WEB_MERCATOR_MAX = WEB_MERCATOR_HALF_WORLD
WGS84_MIN_X = -180.0
WGS84_MAX_X = 180.0
WGS84_MIN_Y = -90.0
WGS84_MAX_Y = 90.0
GEODETIC_TILE_ORIGIN_X = -180.0
GEODETIC_TILE_ORIGIN_Y = 270.0


def _encode_png(data: np.ndarray) -> bytes:
    with MemoryFile() as memfile:
        with memfile.open(
            driver="PNG",
            width=data.shape[2],
            height=data.shape[1],
            count=data.shape[0],
            dtype="uint8",
        ) as dst:
            dst.write(data.astype(np.uint8))
        return memfile.read()


@lru_cache(maxsize=1)
def blank_png() -> bytes:
    rgba = np.zeros((4, TILE_SIZE, TILE_SIZE), dtype=np.uint8)
    return _encode_png(rgba)


def _intersects(
    left_a: float,
    bottom_a: float,
    right_a: float,
    top_a: float,
    left_b: float,
    bottom_b: float,
    right_b: float,
    top_b: float,
) -> bool:
    return not (right_a <= left_b or right_b <= left_a or top_a <= bottom_b or top_b <= bottom_a)


def xyz_tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    matrix_size = 2**z
    if x < 0 or y < 0 or x >= matrix_size or y >= matrix_size:
        raise HTTPException(status_code=404, detail="Requested tile is outside the XYZ matrix")

    span = (WEB_MERCATOR_MAX - WEB_MERCATOR_MIN) / matrix_size
    min_x = WEB_MERCATOR_MIN + (x * span)
    max_x = min_x + span
    max_y = WEB_MERCATOR_MAX - (y * span)
    min_y = max_y - span
    return min_x, min_y, max_x, max_y


def xyz4326_tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    matrix_size = 2**z
    if x < 0 or y < 0 or x >= matrix_size or y >= matrix_size:
        raise HTTPException(status_code=404, detail="Requested tile is outside the EPSG:4326 XYZ matrix")

    tile_span = (WGS84_MAX_X - WGS84_MIN_X) / matrix_size
    min_x = GEODETIC_TILE_ORIGIN_X + (x * tile_span)
    max_x = min_x + tile_span
    max_y = GEODETIC_TILE_ORIGIN_Y - (y * tile_span)
    min_y = max_y - tile_span
    return min_x, min_y, max_x, max_y


def _web_mercator_x(lon: float) -> float:
    return lon * WEB_MERCATOR_HALF_WORLD / 180.0


def _web_mercator_y(lat: float) -> float:
    clamped_lat = max(min(lat, 89.999999), -89.999999)
    return log(tan((90.0 + clamped_lat) * pi / 360.0)) * WEB_MERCATOR_RADIUS


def _bounds_4326_to_3857(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    min_x, min_y, max_x, max_y = bounds
    return (_web_mercator_x(min_x), _web_mercator_y(min_y), _web_mercator_x(max_x), _web_mercator_y(max_y))


def _detect_tile_format(tile_blob: bytes | None) -> tuple[str, str]:
    if not tile_blob:
        return "image/png", "png"
    if tile_blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if tile_blob.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if tile_blob.startswith(b"RIFF") and tile_blob[8:12] == b"WEBP":
        return "image/webp", "webp"
    return "application/octet-stream", "bin"


def _resolve_vrt_source(vrt_path: Path, source_node: ElementTree.Element) -> Path:
    raw_path = (source_node.text or "").strip()
    if not raw_path:
        raise RuntimeError(f"VRT source entry is empty in {vrt_path}")

    relative_to_vrt = source_node.attrib.get("relativeToVRT") == "1"
    if relative_to_vrt:
        candidate = (vrt_path.parent / raw_path).resolve()
        if candidate.exists():
            return candidate

    return resolve_runtime_path(raw_path)


@lru_cache(maxsize=128)
def inspect_vrt_source_paths(vrt_path: str) -> tuple[str, ...]:
    resolved_vrt = resolve_runtime_path(vrt_path)
    if not resolved_vrt.exists():
        raise FileNotFoundError(f"VRT file does not exist at {resolved_vrt}")

    tree = ElementTree.parse(resolved_vrt)
    paths: list[str] = []
    seen: set[str] = set()

    for source_node in tree.findall(".//SourceFilename"):
        source_path = _resolve_vrt_source(resolved_vrt, source_node)
        normalized = str(source_path)
        if normalized in seen:
            continue
        seen.add(normalized)
        paths.append(normalized)

    if not paths:
        raise RuntimeError(f"No source GeoPackages were found in {resolved_vrt}")

    return tuple(paths)


def _read_spatial_ref(cursor: sqlite3.Cursor, srs_id: int) -> str:
    cursor.execute(
        """
        SELECT organization, organization_coordsys_id, definition
        FROM gpkg_spatial_ref_sys
        WHERE srs_id = ?
        """,
        (srs_id,),
    )
    row = cursor.fetchone()
    if not row:
        return str(srs_id)

    organization = str(row[0] or "")
    organization_coordsys_id = int(row[1] or 0)
    definition = str(row[2] or "")
    if organization.upper() == "EPSG" and organization_coordsys_id > 0:
        return f"EPSG:{organization_coordsys_id}"
    if organization and organization_coordsys_id > 0:
        return f"{organization}:{organization_coordsys_id}"
    return definition or str(srs_id)


def _read_tile_matrices(cursor: sqlite3.Cursor, table_name: str) -> tuple[TileMatrixMetadata, ...]:
    cursor.execute(
        f"""
        SELECT
            m.zoom_level,
            m.matrix_width,
            m.matrix_height,
            m.tile_width,
            m.tile_height,
            m.pixel_x_size,
            m.pixel_y_size,
            COALESCE(stats.min_tile_col, 0),
            COALESCE(stats.max_tile_col, m.matrix_width - 1),
            COALESCE(stats.min_tile_row, 0),
            COALESCE(stats.max_tile_row, m.matrix_height - 1)
        FROM gpkg_tile_matrix AS m
        LEFT JOIN (
            SELECT
                zoom_level,
                MIN(tile_column) AS min_tile_col,
                MAX(tile_column) AS max_tile_col,
                MIN(tile_row) AS min_tile_row,
                MAX(tile_row) AS max_tile_row
            FROM "{table_name}"
            GROUP BY zoom_level
        ) AS stats
            ON stats.zoom_level = m.zoom_level
        WHERE m.table_name = ?
        ORDER BY m.zoom_level
        """,
        (table_name,),
    )
    rows = cursor.fetchall()
    return tuple(
        TileMatrixMetadata(
            zoom_level=int(row[0]),
            matrix_width=int(row[1]),
            matrix_height=int(row[2]),
            tile_width=int(row[3]),
            tile_height=int(row[4]),
            pixel_x_size=float(row[5]),
            pixel_y_size=float(row[6]),
            min_tile_col=int(row[7]),
            max_tile_col=int(row[8]),
            min_tile_row=int(row[9]),
            max_tile_row=int(row[10]),
        )
        for row in rows
    )


def _inspect_table(cursor: sqlite3.Cursor, table_name: str) -> TileTableMetadata:
    cursor.execute(
        """
        SELECT table_name, identifier, srs_id, min_x, min_y, max_x, max_y
        FROM gpkg_contents
        WHERE table_name = ? AND data_type = 'tiles'
        """,
        (table_name,),
    )
    row = cursor.fetchone()
    if not row:
        raise RuntimeError(f'GeoPackage table "{table_name}" is missing gpkg_contents metadata')

    srs_id = int(row[2])
    supported_crs = _read_spatial_ref(cursor, srs_id)
    if supported_crs != "EPSG:4326":
        raise RuntimeError(f'GeoPackage table "{table_name}" must use EPSG:4326, found {supported_crs}')

    tile_matrices = _read_tile_matrices(cursor, table_name)
    if not tile_matrices:
        raise RuntimeError(f'GeoPackage table "{table_name}" is missing gpkg_tile_matrix rows')

    cursor.execute(f'SELECT tile_data FROM "{table_name}" LIMIT 1')
    sample_tile_row = cursor.fetchone()
    mime_type, file_extension = _detect_tile_format(sample_tile_row[0] if sample_tile_row else None)

    native_bounds = tuple(float(value) for value in row[3:7])
    bounds_3857 = _bounds_4326_to_3857(native_bounds)
    return TileTableMetadata(
        table_name=table_name,
        identifier=str(row[1] or table_name),
        srs_id=srs_id,
        supported_crs=supported_crs,
        native_bounds=native_bounds,
        bounds_3857=bounds_3857,
        tile_matrices=tile_matrices,
        mime_type=mime_type,
        file_extension=file_extension,
    )


@lru_cache(maxsize=128)
def inspect_gpkg_source(source_path: str) -> GpkgSourceMetadata:
    resolved_source = resolve_runtime_path(source_path)
    if not resolved_source.exists():
        raise FileNotFoundError(f"GeoPackage file does not exist at {resolved_source}")

    with sqlite3.connect(resolved_source) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT table_name
            FROM gpkg_contents
            WHERE data_type = 'tiles'
            ORDER BY table_name
            """
        )
        table_names = [str(row[0]) for row in cursor.fetchall()]
        if not table_names:
            raise RuntimeError(f"No tile tables were found in {resolved_source}")

        tables = tuple(_inspect_table(cursor, table_name) for table_name in table_names)

    bounds_3857 = (
        min(table.bounds_3857[0] for table in tables),
        min(table.bounds_3857[1] for table in tables),
        max(table.bounds_3857[2] for table in tables),
        max(table.bounds_3857[3] for table in tables),
    )
    return GpkgSourceMetadata(path=str(resolved_source), tables=tables, bounds_3857=bounds_3857)


def _tile_coordinate_within_matrix(matrix: TileMatrixMetadata, tile_col: int, tile_row: int) -> bool:
    return matrix.min_tile_col <= tile_col <= matrix.max_tile_col and matrix.min_tile_row <= tile_row <= matrix.max_tile_row


def _read_tile_blob(source_path: str, table: TileTableMetadata, zoom_level: int, tile_col: int, tile_row: int) -> tuple[bytes, str] | None:
    matrix = table.tile_matrix_by_zoom(zoom_level)
    if matrix is None or not _tile_coordinate_within_matrix(matrix, tile_col, tile_row):
        return None

    resolved_source = resolve_runtime_path(source_path)
    with sqlite3.connect(resolved_source) as conn:
        cursor = conn.cursor()
        cursor.execute(
            f'SELECT tile_data FROM "{table.table_name}" WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
            (zoom_level, tile_col, tile_row),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return bytes(row[0]), table.mime_type
    return None


def _read_exact_xyz_tile(source_paths: tuple[str, ...], zoom_level: int, tile_col: int, tile_row: int) -> bytes | None:
    for source_path in reversed(source_paths):
        source = inspect_gpkg_source(source_path)
        for table in source.tables:
            tile = _read_tile_blob(source.path, table, zoom_level, tile_col, tile_row)
            if tile:
                return tile[0]
    return None


def _read_vrt_tile(
    vrt_path: str,
    tile_bounds: tuple[float, float, float, float],
    tile_crs: CRS,
) -> bytes:
    resolved_vrt = resolve_runtime_path(vrt_path)
    with rasterio.open(resolved_vrt) as src:
        if src.count < 3:
            raise RuntimeError(f"Terrain VRT {resolved_vrt} must expose at least 3 bands.")
        if src.crs is None:
            raise RuntimeError(f"Terrain VRT {resolved_vrt} is missing CRS metadata.")

        source_bounds_3857 = transform_bounds(src.crs, WEB_MERCATOR_CRS, *src.bounds, densify_pts=21)
        if tile_crs == WEB_MERCATOR_CRS:
            tile_bounds_3857 = tile_bounds
        else:
            tile_bounds_3857 = transform_bounds(tile_crs, WEB_MERCATOR_CRS, *tile_bounds, densify_pts=21)

        if not _intersects(*tile_bounds_3857, *source_bounds_3857):
            return blank_png()

        read_bounds = transform_bounds(tile_crs, src.crs, *tile_bounds, densify_pts=21)
        window = window_from_bounds(*read_bounds, transform=src.transform)
        raster = src.read(
            [1, 2, 3],
            window=window,
            boundless=True,
            fill_value=0,
            masked=True,
            out_shape=(3, TILE_SIZE, TILE_SIZE),
            resampling=Resampling.nearest,
        )

    rgb = raster.filled(0).astype(np.uint8)
    valid_mask = ~np.all(raster.mask, axis=0)
    if not np.any(valid_mask):
        return blank_png()

    alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
    return _encode_png(np.concatenate([rgb, alpha[np.newaxis, ...]], axis=0))


def render_terrain_rgb_tile(source_paths: tuple[str, ...], vrt_path: str, z: int, x: int, y: int) -> bytes:
    tile = _read_exact_xyz_tile(source_paths, z, x, y)
    if tile is not None:
        return tile
    return _read_vrt_tile(vrt_path, xyz_tile_bounds(z, x, y), WEB_MERCATOR_CRS)


def render_terrain_rgb_tile_4326(source_paths: tuple[str, ...], vrt_path: str, z: int, x: int, y: int) -> bytes:
    tile = _read_exact_xyz_tile(source_paths, z, x, y)
    if tile is not None:
        return tile
    return _read_vrt_tile(vrt_path, xyz4326_tile_bounds(z, x, y), WGS84_CRS)


def inspect_sources(source_paths: tuple[str, ...]) -> tuple[GpkgSourceMetadata, ...]:
    return tuple(inspect_gpkg_source(source_path) for source_path in source_paths)
