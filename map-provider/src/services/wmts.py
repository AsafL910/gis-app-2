from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from xml.etree.ElementTree import Element, SubElement, register_namespace, tostring

import sqlite3
from fastapi import HTTPException
from fastapi.responses import Response

from src.config import WMTS_TILE_SIZE, load_wmts_gpkg_layers, resolve_data_path


WGS84 = "EPSG:4326"
WMTS_MATRIX_SET = "EPSG4326"
WORLD_MIN_X = -180.0
WORLD_MAX_X = 180.0
WORLD_MIN_Y = -180.0
WORLD_MAX_Y = 180.0
WORLD_WIDTH = WORLD_MAX_X - WORLD_MIN_X
WORLD_HEIGHT = WORLD_MAX_Y - WORLD_MIN_Y
INITIAL_RESOLUTION = WORLD_HEIGHT / WMTS_TILE_SIZE
OGC_PIXEL_SIZE = 0.00028


@dataclass(frozen=True)
class WmtsLayerMetadata:
    identifier: str
    title: str
    relative_path: str
    absolute_path: Path
    bounds_4326: tuple[float, float, float, float]
    band_count: int


@dataclass(frozen=True)
class SkippedLayer:
    identifier: str
    title: str
    relative_path: str
    reason: str


@dataclass(frozen=True)
class LayerCandidate:
    identifier: str
    title: str
    relative_path: str
    absolute_path: Path


def _published_name(raw_name: str) -> str:
    normalized = Path(raw_name).stem.strip()
    return normalized or raw_name.strip() or "layer"


def _iter_candidates(set_id: str | None = None) -> list[LayerCandidate]:
    candidates: list[LayerCandidate] = []

    if set_id:
        from src.services.catalog import get_catalog_set_or_404

        map_set = get_catalog_set_or_404(set_id)
        for asset in map_set.maps:
            published_name = _published_name(asset.original_name or Path(asset.relative_path).stem)
            candidates.append(
                LayerCandidate(
                    identifier=published_name,
                    title=published_name,
                    relative_path=asset.relative_path,
                    absolute_path=asset.absolute_path,
                )
            )
        return candidates

    for layer_config in load_wmts_gpkg_layers():
        published_name = _published_name(layer_config.title or Path(layer_config.relative_path).stem)
        candidates.append(
            LayerCandidate(
                identifier=published_name,
                title=published_name,
                relative_path=layer_config.relative_path,
                absolute_path=resolve_data_path(layer_config.relative_path),
            )
        )
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


@lru_cache(maxsize=128)
def _inspect_candidate(candidate: LayerCandidate) -> WmtsLayerMetadata | SkippedLayer:
    try:
        with sqlite3.connect(candidate.absolute_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT table_name FROM gpkg_contents WHERE data_type = 'tiles'")
            row = cursor.fetchone()
            if not row:
                return SkippedLayer(
                    identifier=candidate.identifier,
                    title=candidate.title,
                    relative_path=candidate.relative_path,
                    reason="No tiles table found in GeoPackage",
                )

            table_name = row[0]
            cursor.execute("SELECT min_x, min_y, max_x, max_y FROM gpkg_contents WHERE table_name = ?", (table_name,))
            bounds_row = cursor.fetchone()
            if not bounds_row or None in bounds_row:
                bounds_4326 = (-180.0, -90.0, 180.0, 90.0)
            else:
                bounds_4326 = tuple(bounds_row)

            return WmtsLayerMetadata(
                identifier=candidate.identifier,
                title=candidate.title,
                relative_path=candidate.relative_path,
                absolute_path=candidate.absolute_path,
                bounds_4326=bounds_4326,
                band_count=3,
            )
    except Exception as exc:
        return SkippedLayer(
            identifier=candidate.identifier,
            title=candidate.title,
            relative_path=candidate.relative_path,
            reason=f"Unable to read GeoPackage: {exc}",
        )


def list_wmts_layers(set_id: str | None = None) -> list[WmtsLayerMetadata]:
    candidates = _iter_candidates(set_id)
    duplicates = _duplicate_identifiers(candidates)
    layers: list[WmtsLayerMetadata] = []
    for candidate in candidates:
        if candidate.identifier in duplicates:
            continue
        inspected = _inspect_candidate(candidate)
        if isinstance(inspected, WmtsLayerMetadata):
            layers.append(inspected)
    return layers


def list_skipped_wmts_layers(set_id: str | None = None) -> list[SkippedLayer]:
    candidates = _iter_candidates(set_id)
    duplicates = _duplicate_identifiers(candidates)
    skipped: list[SkippedLayer] = []
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
        inspected = _inspect_candidate(candidate)
        if isinstance(inspected, SkippedLayer):
            skipped.append(inspected)
    return skipped


def get_wmts_layer(identifier: str, set_id: str | None = None) -> WmtsLayerMetadata:
    for layer in list_wmts_layers(set_id):
        if layer.identifier == identifier:
            return layer
    raise HTTPException(status_code=404, detail=f'WMTS layer "{identifier}" was not found')


def _matrix_dimensions(tile_matrix: int) -> tuple[int, int]:
    size = 2**tile_matrix
    return size, size


def _tile_bounds(tile_matrix: int, tile_row: int, tile_col: int) -> tuple[float, float, float, float]:
    matrix_width, matrix_height = _matrix_dimensions(tile_matrix)
    if tile_col < 0 or tile_row < 0 or tile_col >= matrix_width or tile_row >= matrix_height:
        raise HTTPException(status_code=404, detail="Requested tile is outside the WMTS matrix")

    tile_span_x = WORLD_WIDTH / matrix_width
    tile_span_y = WORLD_HEIGHT / matrix_height
    min_x = WORLD_MIN_X + tile_col * tile_span_x
    max_x = min_x + tile_span_x
    max_y = WORLD_MAX_Y - tile_row * tile_span_y
    min_y = max_y - tile_span_y
    return min_x, min_y, max_x, max_y


def render_wmts_tile(
    identifier: str,
    tile_matrix_set: str,
    tile_matrix: int,
    tile_row: int,
    tile_col: int,
    set_id: str | None = None,
) -> bytes:
    if tile_matrix_set != WMTS_MATRIX_SET:
        raise HTTPException(status_code=404, detail=f"Unsupported tile matrix set {tile_matrix_set}")

    layer = get_wmts_layer(identifier, set_id)

    with sqlite3.connect(layer.absolute_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT table_name FROM gpkg_contents WHERE data_type = 'tiles'")
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No tiles table found in GeoPackage")

        table_name = row[0]
        query = f'SELECT tile_data FROM "{table_name}" WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
        cursor.execute(query, (tile_matrix, tile_col, tile_row))
        tile = cursor.fetchone()

        if tile:
            return tile[0]

    raise HTTPException(status_code=404, detail="Tile not found")


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
        "WMTS endpoint for EPSG:4326 GeoPackage rasters. Layer names are globally addressable."
    )
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}ServiceType").text = "OGC WMTS"
    SubElement(service_identification, "{http://www.opengis.net/ows/1.1}ServiceTypeVersion").text = "1.0.0"

    operations_metadata = SubElement(capabilities, "{http://www.opengis.net/ows/1.1}OperationsMetadata")
    kvp_url = f"{base_url}/wmts?" if set_id is None else f"{base_url}/api/wmts/sets/{quote(set_id, safe='')}?"
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

        lower_lon, lower_lat, upper_lon, upper_lat = layer.bounds_4326
        wgs84_box = SubElement(layer_el, "{http://www.opengis.net/ows/1.1}WGS84BoundingBox")
        SubElement(wgs84_box, "{http://www.opengis.net/ows/1.1}LowerCorner").text = f"{lower_lon} {lower_lat}"
        SubElement(wgs84_box, "{http://www.opengis.net/ows/1.1}UpperCorner").text = f"{upper_lon} {upper_lat}"

        style_el = SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}Style", {"isDefault": "true"})
        SubElement(style_el, "{http://www.opengis.net/ows/1.1}Identifier").text = "default"
        SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}Format").text = "image/png"
        SubElement(
            layer_el,
            "{http://www.opengis.net/wmts/1.0}ResourceURL",
            {
                "format": "image/png",
                "resourceType": "tile",
                "template": (
                    f"{base_url}/wmts/{quote(layer.identifier, safe='')}/{WMTS_MATRIX_SET}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}.png"
                    if set_id is None
                    else f"{base_url}/api/wmts/sets/{quote(set_id, safe='')}/{quote(layer.identifier, safe='')}/{WMTS_MATRIX_SET}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}.png"
                ),
            },
        )
        link = SubElement(layer_el, "{http://www.opengis.net/wmts/1.0}TileMatrixSetLink")
        SubElement(link, "{http://www.opengis.net/wmts/1.0}TileMatrixSet").text = WMTS_MATRIX_SET

    matrix_set = SubElement(contents, "{http://www.opengis.net/wmts/1.0}TileMatrixSet")
    SubElement(matrix_set, "{http://www.opengis.net/ows/1.1}Identifier").text = WMTS_MATRIX_SET
    SubElement(matrix_set, "{http://www.opengis.net/ows/1.1}SupportedCRS").text = "urn:ogc:def:crs:EPSG::4326"

    for zoom in range(0, 23):
        resolution = INITIAL_RESOLUTION / (2**zoom)
        matrix_width, matrix_height = _matrix_dimensions(zoom)
        tile_matrix = SubElement(matrix_set, "{http://www.opengis.net/wmts/1.0}TileMatrix")
        SubElement(tile_matrix, "{http://www.opengis.net/ows/1.1}Identifier").text = str(zoom)
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}ScaleDenominator").text = str(resolution / OGC_PIXEL_SIZE)
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TopLeftCorner").text = f"{WORLD_MIN_X} {WORLD_MAX_Y}"
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TileWidth").text = str(WMTS_TILE_SIZE)
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}TileHeight").text = str(WMTS_TILE_SIZE)
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}MatrixWidth").text = str(matrix_width)
        SubElement(tile_matrix, "{http://www.opengis.net/wmts/1.0}MatrixHeight").text = str(matrix_height)

    return tostring(capabilities, encoding="utf-8", xml_declaration=True).decode("utf-8")


def list_wmts_payload(base_url: str, set_id: str | None = None) -> dict:
    layers = list_wmts_layers(set_id)
    skipped_layers = list_skipped_wmts_layers(set_id)
    capabilities_url = (
        "/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
        if set_id is None
        else f"/api/wmts/sets/{quote(set_id, safe='')}?SERVICE=WMTS&REQUEST=GetCapabilities"
    )
    rest_base = "/wmts" if set_id is None else f"/api/wmts/sets/{quote(set_id, safe='')}"
    return {
        "layers": [
            {
                "identifier": layer.identifier,
                "name": layer.title,
                "path": layer.relative_path,
                "provider": "wmts",
                "tile_url": (
                    f"/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={quote(layer.identifier, safe='')}&STYLE=default&FORMAT=image/png&TILEMATRIXSET={WMTS_MATRIX_SET}&TILEMATRIX={{z}}&TILEROW={{y}}&TILECOL={{x}}"
                    if set_id is None
                    else f"/api/wmts/sets/{quote(set_id, safe='')}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={quote(layer.identifier, safe='')}&STYLE=default&FORMAT=image/png&TILEMATRIXSET={WMTS_MATRIX_SET}&TILEMATRIX={{z}}&TILEROW={{y}}&TILECOL={{x}}"
                ),
                "rest_tile_url": f"{rest_base}/{quote(layer.identifier, safe='')}/{WMTS_MATRIX_SET}/{{z}}/{{y}}/{{x}}.png",
                "capabilities_url": capabilities_url,
                "demo_url": "/demo",
                "source_modes": ["kvp", "rest"],
                "bounds": {
                    "epsg4326": layer.bounds_4326,
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
            "kvp_url": "/wmts?" if set_id is None else f"/api/wmts/sets/{quote(set_id, safe='')}?",
            "matrix_set": WMTS_MATRIX_SET,
            "crs": WGS84,
            "base_url": base_url,
        },
    }
