from functools import lru_cache
from xml.etree import ElementTree

from fastapi import HTTPException

from ..config import TILE_SIZE, resolve_runtime_path
from ..http_status import HttpStatus
from .gpkg_reader import inspect_gpkg_source, read_exact_tile


WGS84_HALF_WORLD = 180.0
WGS84_CRS_CODE = 4326
GEODETIC_TILE_ORIGIN_X = -180.0
GEODETIC_TILE_ORIGIN_Y = 270.0


def _load_numpy():
    import numpy as np

    return np


def _load_rasterio():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.io import MemoryFile
    from rasterio.windows import from_bounds as window_from_bounds

    return rasterio, Resampling, MemoryFile, window_from_bounds


def _encode_png(data) -> bytes:
    np = _load_numpy()
    _, _, MemoryFile, _ = _load_rasterio()
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
    np = _load_numpy()
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


def _bounds_contain(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def xyz_tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    matrix_size = 2**z
    if x < 0 or y < 0 or x >= matrix_size or y >= matrix_size:
        raise HTTPException(status_code=HttpStatus.NOT_FOUND, detail="Requested tile is outside the EPSG:4326 XYZ matrix")

    tile_span = (WGS84_HALF_WORLD * 2.0) / matrix_size
    min_x = GEODETIC_TILE_ORIGIN_X + (x * tile_span)
    max_x = min_x + tile_span
    max_y = GEODETIC_TILE_ORIGIN_Y - (y * tile_span)
    min_y = max_y - tile_span
    return min_x, min_y, max_x, max_y


def _resolve_vrt_source(vrt_path, source_node: ElementTree.Element):
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


def _read_vrt_tile(
    vrt_path: str,
    tile_bounds: tuple[float, float, float, float],
) -> bytes:
    rasterio, Resampling, _, window_from_bounds = _load_rasterio()
    resolved_vrt = resolve_runtime_path(vrt_path)
    with rasterio.open(resolved_vrt) as src:
        if src.count < 3:
            raise RuntimeError(f"Terrain VRT {resolved_vrt} must expose at least 3 bands.")
        if src.crs is None:
            raise RuntimeError(f"Terrain VRT {resolved_vrt} is missing CRS metadata.")
        if src.crs.to_epsg() != WGS84_CRS_CODE:
            raise RuntimeError(f"Terrain VRT {resolved_vrt} must use EPSG:4326.")

        if not _intersects(*tile_bounds, *src.bounds):
            return blank_png()

        window = window_from_bounds(*tile_bounds, transform=src.transform)
        raster = src.read(
            [1, 2, 3],
            window=window,
            boundless=True,
            fill_value=0,
            masked=True,
            out_shape=(3, TILE_SIZE, TILE_SIZE),
            resampling=Resampling.nearest,
        )

    np = _load_numpy()
    rgb = raster.filled(0).astype(np.uint8)
    valid_mask = ~np.all(raster.mask, axis=0)
    if not np.any(valid_mask):
        return blank_png()

    alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
    return _encode_png(np.concatenate([rgb, alpha[np.newaxis, ...]], axis=0))


def render_terrain_rgb_tile(source_paths: tuple[str, ...], vrt_path: str, z: int, x: int, y: int) -> bytes:
    tile_bounds = xyz_tile_bounds(z, x, y)
    if source_paths:
        first_source = inspect_gpkg_source(source_paths[0])
        if _bounds_contain(first_source.bounds, tile_bounds):
            tile = _read_exact_tile_for_sources(source_paths, z, x, y, tile_bounds)
            if tile is not None:
                return tile
    return _read_vrt_tile(vrt_path, tile_bounds)


def _read_exact_tile_for_sources(
    source_paths: tuple[str, ...],
    zoom_level: int,
    tile_col: int,
    tile_row: int,
    request_bounds: tuple[float, float, float, float],
) -> bytes | None:
    for source_path in reversed(source_paths):
        source = inspect_gpkg_source(source_path)
        for table in source.tables:
            tile = read_exact_tile(source.path, table, zoom_level, tile_col, tile_row, request_bounds)
            if tile is not None:
                return tile
    return None
