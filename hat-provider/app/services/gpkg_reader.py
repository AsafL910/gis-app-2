import sqlite3
from functools import lru_cache

from ..config import resolve_runtime_path
from ..models import GpkgSourceMetadata, TileMatrixMetadata, TileTableMetadata


def _quote_sql_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


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
            FROM {_quote_sql_identifier(table_name)}
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

    cursor.execute(f'SELECT tile_data FROM {_quote_sql_identifier(table_name)} LIMIT 1')
    sample_tile_row = cursor.fetchone()
    mime_type, file_extension = _detect_tile_format(sample_tile_row[0] if sample_tile_row else None)

    bounds = tuple(float(value) for value in row[3:7])
    return TileTableMetadata(
        table_name=table_name,
        identifier=str(row[1] or table_name),
        srs_id=srs_id,
        supported_crs=supported_crs,
        bounds=bounds,
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

    bounds = (
        min(table.bounds[0] for table in tables),
        min(table.bounds[1] for table in tables),
        max(table.bounds[2] for table in tables),
        max(table.bounds[3] for table in tables),
    )
    return GpkgSourceMetadata(path=str(resolved_source), tables=tables, bounds=bounds)


def inspect_sources(source_paths: tuple[str, ...]) -> tuple[GpkgSourceMetadata, ...]:
    return tuple(inspect_gpkg_source(source_path) for source_path in source_paths)


def _bounds_contain(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def read_exact_tile(
    source_path: str,
    table: TileTableMetadata,
    zoom_level: int,
    tile_col: int,
    tile_row: int,
    request_bounds: tuple[float, float, float, float] | None = None,
) -> bytes | None:
    matrix = table.tile_matrix_by_zoom(zoom_level)
    if matrix is None or not (matrix.min_tile_col <= tile_col <= matrix.max_tile_col and matrix.min_tile_row <= tile_row <= matrix.max_tile_row):
        return None

    if request_bounds is not None and not _bounds_contain(table.bounds, request_bounds):
        return None

    resolved_source = resolve_runtime_path(source_path)
    with sqlite3.connect(resolved_source) as conn:
        cursor = conn.cursor()
        cursor.execute(
            f'SELECT tile_data FROM {_quote_sql_identifier(table.table_name)} WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
            (zoom_level, tile_col, tile_row),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return bytes(row[0])
    return None
