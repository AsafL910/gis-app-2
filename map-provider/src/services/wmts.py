from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from xml.etree.ElementTree import Element, SubElement, register_namespace, tostring

import numpy as np
import rasterio
from fastapi import HTTPException
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds as window_from_bounds

from src.config import WMTS_TILE_SIZE, load_wmts_gpkg_layers, resolve_data_path


WGS84_CRS = CRS.from_epsg(4326)
WGS84 = "EPSG:4326"
WMTS_MATRIX_SET = "EPSG4326"
WORLD_MIN_X = -180.0
WORLD_MAX_X = 180.0
WORLD_MIN_Y = -90.0
WORLD_MAX_Y = 90.0
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


def _iter_candidates() -> list[LayerCandidate]:
    candidates: list[LayerCandidate] = []
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


def normalize_to_uint8(data: np.ndarray) -> np.ndarray:
    array = np.asarray(data)

    if array.ndim == 2:
        array = array[np.newaxis, ...]

    if array.shape[0] == 1:
        array = np.repeat(array, 3, axis=0)
    elif array.shape[0] > 3:
        array = array[:3]

    result = np.zeros_like(array, dtype=np.uint8)
    for idx in range(array.shape[0]):
        band = array[idx].astype(np.float32)
        finite = np.isfinite(band)
        if not finite.any():
            continue

        values = band[finite]
        low = float(np.percentile(values, 2))
        high = float(np.percentile(values, 98))
        if high <= low:
            low = float(values.min())
            high = float(values.max())

        if high <= low:
            continue

        scaled = np.clip((band - low) / (high - low), 0.0, 1.0) * 255.0
        result[idx] = scaled.astype(np.uint8)

    return result


@lru_cache(maxsize=128)
def _inspect_candidate(candidate: LayerCandidate) -> WmtsLayerMetadata | SkippedLayer:
    try:
        with rasterio.open(candidate.absolute_path) as src:
            if src.crs != WGS84_CRS:
                return SkippedLayer(
                    identifier=candidate.identifier,
                    title=candidate.title,
                    relative_path=candidate.relative_path,
                    reason=f"Expected a 4326 raster but found {src.crs or 'unknown CRS'}",
                )

            left, bottom, right, top = src.bounds
            return WmtsLayerMetadata(
                identifier=candidate.identifier,
                title=candidate.title,
                relative_path=candidate.relative_path,
                absolute_path=candidate.absolute_path,
                bounds_4326=(left, bottom, right, top),
                band_count=src.count,
            )
    except Exception as exc:
        return SkippedLayer(
            identifier=candidate.identifier,
            title=candidate.title,
            relative_path=candidate.relative_path,
            reason=f"Unable to open as a raster GeoPackage: {exc}",
        )


def list_wmts_layers(set_id: str | None = None) -> list[WmtsLayerMetadata]:
    del set_id
    candidates = _iter_candidates()
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
    del set_id
    candidates = _iter_candidates()
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
    return 2 ** (tile_matrix + 1), 2**tile_matrix


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


def _intersects_bounds(
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


def _prepare_png_bands(data: np.ndarray, alpha: np.ndarray | None) -> np.ndarray:
    array = np.asarray(data)
    if array.ndim == 2:
        array = array[np.newaxis, ...]

    band_count = array.shape[0]
    if band_count == 0:
        array = np.zeros((3, WMTS_TILE_SIZE, WMTS_TILE_SIZE), dtype=np.uint8)
    elif band_count == 1:
        array = normalize_to_uint8(array)
    elif band_count == 2:
        grayscale = normalize_to_uint8(array[:1])
        array = np.concatenate([grayscale, array[1:2].astype(np.uint8)], axis=0)
    elif band_count in {3, 4} and array.dtype == np.uint8:
        array = array[:band_count]
    else:
        core = normalize_to_uint8(array[: min(3, band_count)])
        if band_count >= 4:
            alpha_band = array[3:4].astype(np.uint8)
            array = np.concatenate([core, alpha_band], axis=0)
        else:
            array = core

    if alpha is not None:
        alpha_uint8 = alpha.astype(np.uint8)[np.newaxis, ...]
        if array.shape[0] == 4:
            array[3] = np.minimum(array[3], alpha_uint8[0])
        else:
            array = np.concatenate([array[:3], alpha_uint8], axis=0)

    if array.shape[0] == 2:
        gray = array[:1]
        alpha_band = array[1:2]
        array = np.concatenate([gray, gray, gray, alpha_band], axis=0)

    return array


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
def _blank_png() -> bytes:
    rgba = np.zeros((4, WMTS_TILE_SIZE, WMTS_TILE_SIZE), dtype=np.uint8)
    return _encode_png(rgba)


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
    min_x, min_y, max_x, max_y = _tile_bounds(tile_matrix, tile_row, tile_col)
    if not _intersects_bounds(min_x, min_y, max_x, max_y, *layer.bounds_4326):
        return _blank_png()

    with rasterio.open(layer.absolute_path) as src:
        band_indexes = list(range(1, min(max(src.count, 1), 4) + 1))
        resampling = Resampling.nearest if src.count >= 4 else Resampling.bilinear
        window = window_from_bounds(min_x, min_y, max_x, max_y, transform=src.transform)
        raster = src.read(
            band_indexes,
            window=window,
            out_shape=(len(band_indexes), WMTS_TILE_SIZE, WMTS_TILE_SIZE),
            boundless=True,
            fill_value=0,
            resampling=resampling,
            masked=True,
        )

    data = raster.filled(0)
    valid_mask = (~np.all(raster.mask, axis=0)).astype(np.uint8) * 255
    png_bands = _prepare_png_bands(data, valid_mask)
    return _encode_png(png_bands)


def build_wmts_capabilities_xml(base_url: str, set_id: str | None = None) -> str:
    del set_id
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
    kvp_url = f"{base_url}/wmts?"
    for operation_name in ["GetCapabilities", "GetTile"]:
        operation = SubElement(operations_metadata, "{http://www.opengis.net/ows/1.1}Operation", {"name": operation_name})
        dcp = SubElement(operation, "{http://www.opengis.net/ows/1.1}DCP")
        http = SubElement(dcp, "{http://www.opengis.net/ows/1.1}HTTP")
        get = SubElement(http, "{http://www.opengis.net/ows/1.1}Get", {"{http://www.w3.org/1999/xlink}href": kvp_url})
        constraint = SubElement(get, "{http://www.opengis.net/ows/1.1}Constraint", {"name": "GetEncoding"})
        allowed_values = SubElement(constraint, "{http://www.opengis.net/ows/1.1}AllowedValues")
        SubElement(allowed_values, "{http://www.opengis.net/ows/1.1}Value").text = "KVP"

    contents = SubElement(capabilities, "{http://www.opengis.net/wmts/1.0}Contents")
    for layer in list_wmts_layers():
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
                "template": f"{base_url}/wmts/{quote(layer.identifier, safe='')}/{WMTS_MATRIX_SET}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}.png",
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
    del set_id
    layers = list_wmts_layers()
    skipped_layers = list_skipped_wmts_layers()
    return {
        "layers": [
            {
                "identifier": layer.identifier,
                "name": layer.title,
                "path": layer.relative_path,
                "provider": "wmts",
                "tile_url": f"/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={quote(layer.identifier, safe='')}&STYLE=default&FORMAT=image/png&TILEMATRIXSET={WMTS_MATRIX_SET}&TILEMATRIX={{z}}&TILEROW={{y}}&TILECOL={{x}}",
                "rest_tile_url": f"/wmts/{quote(layer.identifier, safe='')}/{WMTS_MATRIX_SET}/{{z}}/{{y}}/{{x}}.png",
                "capabilities_url": "/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
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
            "capabilities_url": "/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
            "demo_url": "/demo",
            "kvp_url": "/wmts?",
            "matrix_set": WMTS_MATRIX_SET,
            "crs": WGS84,
            "base_url": base_url,
        },
    }
