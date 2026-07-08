from functools import lru_cache
import logging
from pathlib import Path
from urllib.parse import quote
from xml.etree.ElementTree import Element, SubElement, register_namespace, tostring

import sqlite3
from fastapi import HTTPException

from src.config import GPKG_DEBUG_LOGGING, load_wmts_gpkg_layers, resolve_data_path
from src.http_status import HttpStatus
from src.models.wmts import LayerCandidate, SkippedLayer, SpatialRefMetadata, TileMatrixMetadata, WmtsLayerMetadata


OGC_PIXEL_SIZE = 0.00028
logger = logging.getLogger("map_provider.wmts")
logger.disabled = not GPKG_DEBUG_LOGGING


def _candidate_log_context(candidate: LayerCandidate) -> dict[str, str]:
    return {
        "candidate_identifier": candidate.identifier,
        "candidate_title": candidate.title,
        "relative_path": candidate.relative_path,
        "absolute_path": str(candidate.absolute_path),
    }


def _layer_log_context(layer: WmtsLayerMetadata) -> dict[str, str | int | float]:
    return {
        "layer_identifier": layer.identifier,
        "layer_title": layer.title,
        "relative_path": layer.relative_path,
        "absolute_path": str(layer.absolute_path),
        "table_name": layer.table_name,
        "content_identifier": layer.content_identifier,
        "supported_crs": layer.spatial_ref.supported_crs,
        "srs_id": layer.spatial_ref.srs_id,
        "mime_type": layer.mime_type,
        "file_extension": layer.file_extension,
        "native_bounds": layer.native_bounds,
        "matrix_set_bounds": layer.matrix_set_bounds,
        "zoom_levels": [matrix.zoom_level for matrix in layer.tile_matrices],
        "matrix_sizes": [f"{matrix.matrix_width}x{matrix.matrix_height}" for matrix in layer.tile_matrices],
        "tile_sizes": [f"{matrix.tile_width}x{matrix.tile_height}" for matrix in layer.tile_matrices],
        "tile_col_ranges": [f"{matrix.min_tile_col}-{matrix.max_tile_col}" for matrix in layer.tile_matrices],
        "tile_row_ranges": [f"{matrix.min_tile_row}-{matrix.max_tile_row}" for matrix in layer.tile_matrices],
    }


def _skipped_log_context(skipped: "SkippedLayer", candidate: LayerCandidate | None = None) -> dict[str, str]:
    context = {
        "layer_identifier": skipped.identifier,
        "layer_title": skipped.title,
        "relative_path": skipped.relative_path,
        "reason": skipped.reason,
    }
    if candidate:
        context["absolute_path"] = str(candidate.absolute_path)
    return context


def _published_name(raw_name: str) -> str:
    normalized = Path(raw_name).stem.strip()
    return normalized or raw_name.strip() or "layer"


def _set_asset_identifier(asset) -> str:
    base_identifier = _published_name(asset.original_name or Path(asset.relative_path).stem)
    suffix = asset.id[-8:].lower().strip()
    if not suffix:
        return base_identifier
    return f"{base_identifier}-{suffix}"


def _iter_candidates(set_id: str | None = None) -> list[LayerCandidate]:
    candidates: list[LayerCandidate] = []

    if set_id:
        from src.services.catalog import get_catalog_set_or_404

        map_set = get_catalog_set_or_404(set_id)
        for asset in map_set.maps:
            published_name = _set_asset_identifier(asset)
            candidates.append(
                LayerCandidate(
                    identifier=published_name,
                    title=_published_name(asset.original_name or Path(asset.relative_path).stem),
                    relative_path=asset.relative_path,
                    absolute_path=asset.absolute_path,
                )
            )
        logger.info(
            "Prepared set WMTS candidates",
            extra={
                "set_id": set_id,
                "map_asset_count": len(map_set.maps),
                "dtm_asset_count": len(map_set.dtm_layers),
                "candidate_count": len(candidates),
            },
        )
        return candidates

    for layer_config in load_wmts_gpkg_layers():
        published_name = _published_name(layer_config.title or Path(layer_config.relative_path).stem)
        candidates.append(
            LayerCandidate(
                identifier=layer_config.identifier,
                title=published_name,
                relative_path=layer_config.relative_path,
                absolute_path=resolve_data_path(layer_config.relative_path),
            )
        )
    logger.info("Prepared global WMTS candidates", extra={"candidate_count": len(candidates)})
    return candidates


def _duplicate_identifiers(candidates: list[LayerCandidate]) -> set[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for candidate in candidates:
        if candidate.identifier in seen:
            duplicates.add(candidate.identifier)
        else:
            seen.add(candidate.identifier)
    return duplicates


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


def _build_layer_identifier(candidate_identifier: str, content_identifier: str, table_name: str, table_count: int) -> str:
    if table_count <= 1:
        return candidate_identifier

    suffix_source = content_identifier.strip() or table_name.strip() or "tiles"
    suffix = _published_name(suffix_source)
    if suffix == candidate_identifier:
        suffix = f"{suffix}-tiles"
    return f"{candidate_identifier}-{suffix}"


def _read_spatial_ref(cursor: sqlite3.Cursor, srs_id: int) -> SpatialRefMetadata:
    cursor.execute(
        """
        SELECT srs_id, organization, organization_coordsys_id, definition
        FROM gpkg_spatial_ref_sys
        WHERE srs_id = ?
        """,
        (srs_id,),
    )
    row = cursor.fetchone()
    if not row:
        return SpatialRefMetadata(srs_id=srs_id, organization="", organization_coordsys_id=0, definition="")
    return SpatialRefMetadata(
        srs_id=int(row[0]),
        organization=str(row[1] or ""),
        organization_coordsys_id=int(row[2] or 0),
        definition=str(row[3] or ""),
    )


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


@lru_cache(maxsize=128)
def _inspect_candidate(candidate: LayerCandidate) -> tuple[WmtsLayerMetadata | SkippedLayer, ...]:
    try:
        logger.info("Inspecting GeoPackage candidate", extra=_candidate_log_context(candidate))
        with sqlite3.connect(candidate.absolute_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT table_name, identifier, srs_id, min_x, min_y, max_x, max_y
                FROM gpkg_contents
                WHERE data_type = 'tiles'
                ORDER BY table_name
                """
            )
            rows = cursor.fetchall()
            if not rows:
                skipped = SkippedLayer(
                    identifier=candidate.identifier,
                    title=candidate.title,
                    relative_path=candidate.relative_path,
                    reason="No tiles table found in GeoPackage",
                )
                logger.warning("Skipping GeoPackage candidate", extra=_skipped_log_context(skipped, candidate))
                return (skipped,)

            table_count = len(rows)
            logger.info(
                "Discovered tile tables in GeoPackage",
                extra={**_candidate_log_context(candidate), "table_count": table_count, "table_names": [str(row[0]) for row in rows]},
            )
            layers: list[WmtsLayerMetadata | SkippedLayer] = []

            for row in rows:
                table_name = str(row[0])
                content_identifier = str(row[1] or candidate.identifier)
                srs_id = int(row[2])
                native_bounds = tuple(float(value) for value in row[3:7])
                layer_identifier = _build_layer_identifier(candidate.identifier, content_identifier, table_name, table_count)
                layer_title = layer_identifier if table_count > 1 else candidate.title

                cursor.execute(
                    """
                    SELECT min_x, min_y, max_x, max_y
                    FROM gpkg_tile_matrix_set
                    WHERE table_name = ?
                    """,
                    (table_name,),
                )
                matrix_set_row = cursor.fetchone()
                if not matrix_set_row:
                    skipped = SkippedLayer(
                        identifier=layer_identifier,
                        title=layer_title,
                        relative_path=candidate.relative_path,
                        reason=f'GeoPackage table "{table_name}" is missing gpkg_tile_matrix_set metadata',
                    )
                    logger.warning("Skipping GeoPackage table", extra={**_skipped_log_context(skipped, candidate), "table_name": table_name})
                    layers.append(skipped)
                    continue

                matrix_set_bounds = tuple(float(value) for value in matrix_set_row)
                tile_matrices = _read_tile_matrices(cursor, table_name)
                if not tile_matrices:
                    skipped = SkippedLayer(
                        identifier=layer_identifier,
                        title=layer_title,
                        relative_path=candidate.relative_path,
                        reason=f'GeoPackage table "{table_name}" is missing gpkg_tile_matrix rows',
                    )
                    logger.warning("Skipping GeoPackage table", extra={**_skipped_log_context(skipped, candidate), "table_name": table_name})
                    layers.append(skipped)
                    continue

                cursor.execute(f'SELECT tile_data FROM "{table_name}" LIMIT 1')
                sample_tile_row = cursor.fetchone()
                mime_type, file_extension = _detect_tile_format(sample_tile_row[0] if sample_tile_row else None)
                spatial_ref = _read_spatial_ref(cursor, srs_id)
                bounds_4326 = native_bounds if spatial_ref.organization.upper() == "EPSG" and spatial_ref.organization_coordsys_id == 4326 else None

                layer = WmtsLayerMetadata(
                    identifier=layer_identifier,
                    title=layer_title,
                    relative_path=candidate.relative_path,
                    absolute_path=candidate.absolute_path,
                    table_name=table_name,
                    content_identifier=content_identifier,
                    native_bounds=native_bounds,
                    bounds_4326=bounds_4326,
                    matrix_set_bounds=matrix_set_bounds,
                    spatial_ref=spatial_ref,
                    tile_matrices=tile_matrices,
                    mime_type=mime_type,
                    file_extension=file_extension,
                )
                logger.info("GeoPackage table is WMTS-publishable", extra=_layer_log_context(layer))
                layers.append(layer)

            return tuple(layers)
    except Exception as exc:
        skipped = SkippedLayer(
            identifier=candidate.identifier,
            title=candidate.title,
            relative_path=candidate.relative_path,
            reason=f"Unable to read GeoPackage: {exc}",
        )
        logger.exception("Failed to inspect GeoPackage candidate", extra=_candidate_log_context(candidate))
        return (skipped,)


def list_wmts_layers(set_id: str | None = None) -> list[WmtsLayerMetadata]:
    candidates = _iter_candidates(set_id)
    duplicates = _duplicate_identifiers(candidates)
    layers: list[WmtsLayerMetadata] = []
    for candidate in candidates:
        if candidate.identifier in duplicates:
            logger.warning("Skipping duplicate global candidate identifier", extra=_candidate_log_context(candidate))
            continue
        for inspected in _inspect_candidate(candidate):
            if isinstance(inspected, WmtsLayerMetadata):
                layers.append(inspected)

    identifier_counts: dict[str, int] = {}
    for layer in layers:
        identifier_counts[layer.identifier] = identifier_counts.get(layer.identifier, 0) + 1
    unique_layers: list[WmtsLayerMetadata] = []
    for layer in layers:
        if identifier_counts[layer.identifier] == 1:
            unique_layers.append(layer)
        else:
            logger.warning(
                "Skipping duplicate published layer identifier after table expansion",
                extra=_layer_log_context(layer),
            )
    logger.info("Resolved publishable WMTS layers", extra={"published_layer_count": len(unique_layers), "set_id": set_id or ""})
    return unique_layers


def list_skipped_wmts_layers(set_id: str | None = None) -> list[SkippedLayer]:
    candidates = _iter_candidates(set_id)
    duplicates = _duplicate_identifiers(candidates)
    skipped: list[SkippedLayer] = []
    successful_layers: list[WmtsLayerMetadata] = []
    for candidate in candidates:
        if candidate.identifier in duplicates:
            skipped.append(
                SkippedLayer(
                    identifier=candidate.identifier,
                    title=candidate.title,
                    relative_path=candidate.relative_path,
                    reason="Duplicate published layer name. Layer names must be globally unique.",
                )
            )
            continue
        for inspected in _inspect_candidate(candidate):
            if isinstance(inspected, SkippedLayer):
                skipped.append(inspected)
            else:
                successful_layers.append(inspected)

    identifier_counts: dict[str, int] = {}
    for layer in successful_layers:
        identifier_counts[layer.identifier] = identifier_counts.get(layer.identifier, 0) + 1
    for layer in successful_layers:
        if identifier_counts[layer.identifier] > 1:
            skipped.append(
                SkippedLayer(
                    identifier=layer.identifier,
                    title=layer.title,
                    relative_path=layer.relative_path,
                    reason="Duplicate published layer name after GeoPackage table expansion. Layer names must be globally unique.",
                )
            )
    return skipped


def get_wmts_layer(identifier: str, set_id: str | None = None) -> WmtsLayerMetadata:
    for layer in list_wmts_layers(set_id):
        if layer.identifier == identifier:
            return layer
    logger.warning(
        "WMTS layer lookup failed",
        extra={
            "requested_layer_identifier": identifier,
            "set_id": set_id or "",
            "available_layer_identifiers": [layer.identifier for layer in list_wmts_layers(set_id)],
        },
    )
    raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail=f'WMTS layer "{identifier}" was not found')


def render_wmts_tile(
    identifier: str,
    tile_matrix_set: str,
    tile_matrix: int,
    tile_row: int,
    tile_col: int,
    set_id: str | None = None,
) -> tuple[bytes, str]:
    layer = get_wmts_layer(identifier, set_id)
    if tile_matrix_set != layer.matrix_set_identifier:
        logger.warning(
            "Rejected tile request because tile matrix set is unsupported",
            extra={
                **_layer_log_context(layer),
                "requested_tile_matrix_set": tile_matrix_set,
                "requested_tile_matrix": tile_matrix,
                "requested_tile_row": tile_row,
                "requested_tile_col": tile_col,
                "set_id": set_id or "",
            },
        )
        raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail=f"Unsupported tile matrix set {tile_matrix_set}")

    matrix = layer.tile_matrix_by_zoom(tile_matrix)
    if not matrix:
        logger.warning(
            "Rejected tile request because tile matrix is unavailable",
            extra={
                **_layer_log_context(layer),
                "requested_tile_matrix_set": tile_matrix_set,
                "requested_tile_matrix": tile_matrix,
                "requested_tile_row": tile_row,
                "requested_tile_col": tile_col,
                "set_id": set_id or "",
            },
        )
        raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail=f"Tile matrix {tile_matrix} is not available for layer {identifier}")

    if tile_col < matrix.min_tile_col or tile_col > matrix.max_tile_col or tile_row < matrix.min_tile_row or tile_row > matrix.max_tile_row:
        logger.warning(
            "Rejected tile request because coordinates are outside available tile range",
            extra={
                **_layer_log_context(layer),
                "requested_tile_matrix_set": tile_matrix_set,
                "requested_tile_matrix": tile_matrix,
                "requested_tile_row": tile_row,
                "requested_tile_col": tile_col,
                "available_tile_col_range": f"{matrix.min_tile_col}-{matrix.max_tile_col}",
                "available_tile_row_range": f"{matrix.min_tile_row}-{matrix.max_tile_row}",
                "set_id": set_id or "",
            },
        )
        raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail="Requested tile is outside the available tile range")

    with sqlite3.connect(layer.absolute_path) as conn:
        cursor = conn.cursor()
        query = f'SELECT tile_data FROM "{layer.table_name}" WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
        cursor.execute(query, (tile_matrix, tile_col, tile_row))
        tile = cursor.fetchone()

        if tile:
            logger.debug(
                "Served WMTS tile",
                extra={
                    "layer_identifier": layer.identifier,
                    "table_name": layer.table_name,
                    "tile_matrix_set": tile_matrix_set,
                    "tile_matrix": tile_matrix,
                    "tile_row": tile_row,
                    "tile_col": tile_col,
                    "set_id": set_id or "",
                },
            )
            return tile[0], layer.mime_type

    logger.warning(
        "Tile request matched metadata but no tile row was found in GeoPackage",
        extra={
            **_layer_log_context(layer),
            "requested_tile_matrix_set": tile_matrix_set,
            "requested_tile_matrix": tile_matrix,
            "requested_tile_row": tile_row,
            "requested_tile_col": tile_col,
            "set_id": set_id or "",
        },
    )
    raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail="Tile not found")


def _tile_matrix_limits_xml(parent: Element, matrix: TileMatrixMetadata):
    limits = SubElement(parent, "{http://www.opengis.net/wmts/1.0}TileMatrixLimits")
    SubElement(limits, "{http://www.opengis.net/ows/1.1}Identifier").text = str(matrix.zoom_level)
    SubElement(limits, "{http://www.opengis.net/wmts/1.0}MinTileRow").text = str(matrix.min_tile_row)
    SubElement(limits, "{http://www.opengis.net/wmts/1.0}MaxTileRow").text = str(matrix.max_tile_row)
    SubElement(limits, "{http://www.opengis.net/wmts/1.0}MinTileCol").text = str(matrix.min_tile_col)
    SubElement(limits, "{http://www.opengis.net/wmts/1.0}MaxTileCol").text = str(matrix.max_tile_col)


def build_wmts_capabilities_xml(base_url: str, set_id: str | None = None) -> str:
    ns = {
        "wmts": "http://www.opengis.net/wmts/1.0",
        "ows": "http://www.opengis.net/ows/1.1",
        "xlink": "http://www.w3.org/1999/xlink",
    }
    register_namespace("", ns["wmts"])
    register_namespace("ows", ns["ows"])
    register_namespace("xlink", ns["xlink"])

    capabilities = Element("{http://www.opengis.net/wmts/1.0}Capabilities", {"version": "1.0.0"})

    service_identification = SubElement(capabilities, "{http://www.opengis.net/ows/1.1}ServiceIdentification")
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}Title").text = "GeoPackage WMTS"
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}Abstract").text = (
        "WMTS endpoint derived directly from GeoPackage tile metadata."
    )
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}ServiceType").text = "OGC WMTS"
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}ServiceTypeVersion").text = "1.0.0"

    operations_metadata = SubElement(capabilities, "{http://www.opengis.net/ows/1.1}OperationsMetadata")
    kvp_url = f"{base_url}/api/v1/wmts?" if set_id is None else f"{base_url}/api/v1/wmts/sets/{quote(set_id, safe='')}?"
    for operation_name in ["GetCapabilities", "GetTile"]:
        operation = SubElement(operations_metadata, "{http://www.opengis.net/ows/1.1}Operation", {"name": operation_name})
        dcp = SubElement(operation, "{http://www.opengis.net/ows/1.1}DCP")
        http = SubElement(dcp, "{http://www.opengis.net/ows/1.1}HTTP")
        get = SubElement(http, "{http://www.opengis.net/ows/1.1}Get", {"{http://www.w3.org/1999/xlink}href": kvp_url})
        constraint = SubElement(get, "{http://www.opengis.net/ows/1.1}Constraint", {"name": "GetEncoding"})
        allowed_values = SubElement(constraint, "{http://www.opengis.net/ows/1.1}AllowedValues")
        SubElement(allowed_values, "{http://www.opengis.net/ows/1.1}Value").text = "KVP"

    contents = SubElement(capabilities, "{http://www.opengis.net/wmts/1.0}Contents")
    for layer in list_wmts_layers(set_id):
        layer_el = SubElement(contents, "{http://www.opengis.net/wmts/1.0}Layer")
        SubElement(layer_el, "{http://www.opengis.net/ows/1.1}Title").text = layer.title
        SubElement(layer_el, "{http://www.opengis.net/ows/1.1}Identifier").text = layer.identifier

        bbox = SubElement(layer_el, "{http://www.opengis.net/ows/1.1}BoundingBox", {"crs": layer.spatial_ref.supported_crs})
        SubElement(bbox, "{http://www.opengis.net/ows/1.1}LowerCorner").text = f"{layer.native_bounds[0]} {layer.native_bounds[1]}"
        SubElement(bbox, "{http://www.opengis.net/ows/1.1}UpperCorner").text = f"{layer.native_bounds[2]} {layer.native_bounds[3]}"

        if layer.bounds_4326:
            wgs84_box = SubElement(layer_el, "{http://www.opengis.net/ows/1.1}WGS84BoundingBox")
            SubElement(wgs84_box, "{http://www.opengis.net/ows/1.1}LowerCorner").text = f"{layer.bounds_4326[0]} {layer.bounds_4326[1]}"
            SubElement(wgs84_box, "{http://www.opengis.net/ows/1.1}UpperCorner").text = f"{layer.bounds_4326[2]} {layer.bounds_4326[3]}"

        style_el = SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}Style", {"isDefault": "true"})
        SubElement(style_el, "{http://www.opengis.net/ows/1.1}Identifier").text = "default"
        SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}Format").text = layer.mime_type
        SubElement(
            layer_el,
            "{http://www.opengis.net/wmts/1.0}ResourceURL",
            {
                "format": layer.mime_type,
                "resourceType": "tile",
                "template": (
                    f"{base_url}/api/v1/wmts/{quote(layer.identifier, safe='')}/{quote(layer.matrix_set_identifier, safe='')}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}.{layer.file_extension}"
                    if set_id is None
                    else f"{base_url}/api/v1/wmts/sets/{quote(set_id, safe='')}/{quote(layer.identifier, safe='')}/{quote(layer.matrix_set_identifier, safe='')}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}.{layer.file_extension}"
                ),
            },
        )
        link = SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}TileMatrixSetLink")
        SubElement(link, "{http://www.opengis.net/wmts/1.0}TileMatrixSet").text = layer.matrix_set_identifier
        limits = SubElement(link, "{http://www.opengis.net/wmts/1.0}TileMatrixSetLimits")
        for matrix in layer.tile_matrices:
            _tile_matrix_limits_xml(limits, matrix)

    for layer in list_wmts_layers(set_id):
        matrix_set = SubElement(contents, "{http://www.opengis.net/wmts/1.0}TileMatrixSet")
        SubElement(matrix_set, "{http://www.opengis.net/ows/1.1}Identifier").text = layer.matrix_set_identifier
        SubElement(matrix_set, "{http://www.opengis.net/ows/1.1}SupportedCRS").text = layer.spatial_ref.supported_crs
        matrix_set_bbox = SubElement(matrix_set, "{http://www.opengis.net/ows/1.1}BoundingBox", {"crs": layer.spatial_ref.supported_crs})
        SubElement(matrix_set_bbox, "{http://www.opengis.net/ows/1.1}LowerCorner").text = (
            f"{layer.matrix_set_bounds[0]} {layer.matrix_set_bounds[1]}"
        )
        SubElement(matrix_set_bbox, "{http://www.opengis.net/ows/1.1}UpperCorner").text = (
            f"{layer.matrix_set_bounds[2]} {layer.matrix_set_bounds[3]}"
        )

        for matrix in layer.tile_matrices:
            tile_matrix = SubElement(matrix_set, "{http://www.opengis.net/wmts/1.0}TileMatrix")
            SubElement(tile_matrix, "{http://www.opengis.net/ows/1.1}Identifier").text = str(matrix.zoom_level)
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}ScaleDenominator").text = str(matrix.scale_denominator)
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TopLeftCorner").text = (
                f"{layer.matrix_set_bounds[0]} {layer.matrix_set_bounds[3]}"
            )
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TileWidth").text = str(matrix.tile_width)
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TileHeight").text = str(matrix.tile_height)
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}MatrixWidth").text = str(matrix.matrix_width)
            SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}MatrixHeight").text = str(matrix.matrix_height)

    return tostring(capabilities, encoding="utf-8", xml_declaration=True).decode("utf-8")


def list_wmts_payload(base_url: str, set_id: str | None = None) -> dict:
    layers = list_wmts_layers(set_id)
    skipped_layers = list_skipped_wmts_layers(set_id)
    capabilities_url = (
        "/api/v1/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
        if set_id is None
        else f"/api/v1/wmts/sets/{quote(set_id, safe='')}?SERVICE=WMTS&REQUEST=GetCapabilities"
    )
    rest_base = "/api/v1/wmts" if set_id is None else f"/api/v1/wmts/sets/{quote(set_id, safe='')}"
    return {
        "layers": [
            {
                "identifier": layer.identifier,
                "name": layer.title,
                "path": layer.relative_path,
                "provider": "wmts",
                "tile_url": (
                    f"/api/v1/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={quote(layer.identifier, safe='')}&STYLE=default&FORMAT={quote(layer.mime_type, safe='')}&TILEMATRIXSET={quote(layer.matrix_set_identifier, safe='')}&TILEMATRIX={{z}}&TILEROW={{y}}&TILECOL={{x}}"
                    if set_id is None
                    else f"/api/v1/wmts/sets/{quote(set_id, safe='')}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={quote(layer.identifier, safe='')}&STYLE=default&FORMAT={quote(layer.mime_type, safe='')}&TILEMATRIXSET={quote(layer.matrix_set_identifier, safe='')}&TILEMATRIX={{z}}&TILEROW={{y}}&TILECOL={{x}}"
                ),
                "rest_tile_url": f"{rest_base}/{quote(layer.identifier, safe='')}/{quote(layer.matrix_set_identifier, safe='')}/{{z}}/{{y}}/{{x}}.{layer.file_extension}",
                "capabilities_url": capabilities_url,
                "demo_url": "/demo",
                "source_modes": ["kvp", "rest"],
                "format": layer.mime_type,
                "min_zoom": layer.min_zoom,
                "max_zoom": layer.max_zoom,
                "matrix_set": layer.matrix_set_identifier,
                "crs": layer.spatial_ref.supported_crs,
                "tile_matrix_set": {
                    "identifier": layer.matrix_set_identifier,
                    "supported_crs": layer.spatial_ref.supported_crs,
                    "bounds": layer.matrix_set_bounds,
                    "top_left_corner": [layer.matrix_set_bounds[0], layer.matrix_set_bounds[3]],
                },
                "tile_matrices": [
                    {
                        "identifier": str(matrix.zoom_level),
                        "zoom": matrix.zoom_level,
                        "matrix_width": matrix.matrix_width,
                        "matrix_height": matrix.matrix_height,
                        "tile_width": matrix.tile_width,
                        "tile_height": matrix.tile_height,
                        "pixel_x_size": matrix.pixel_x_size,
                        "pixel_y_size": matrix.pixel_y_size,
                        "scale_denominator": matrix.scale_denominator,
                        "min_tile_col": matrix.min_tile_col,
                        "max_tile_col": matrix.max_tile_col,
                        "min_tile_row": matrix.min_tile_row,
                        "max_tile_row": matrix.max_tile_row,
                    }
                    for matrix in layer.tile_matrices
                ],
                "bounds": {
                    "epsg4326": layer.bounds_4326,
                    "native": {
                        "crs": layer.spatial_ref.supported_crs,
                        "extent": layer.native_bounds,
                    },
                },
            }
            for layer in layers
        ],
        "skipped_layers": [
            {
                "identifier": skipped.identifier,
                "name": skipped.title,
                "path": skipped.relative_path,
                "reason": skipped.reason,
            }
            for skipped in skipped_layers
        ],
        "service": {
            "name": "map-server",
            "capabilities_url": capabilities_url,
            "demo_url": "/demo",
            "kvp_url": "/api/v1/wmts?" if set_id is None else f"/api/v1/wmts/sets/{quote(set_id, safe='')}?",
            "base_url": base_url,
        },
    }
