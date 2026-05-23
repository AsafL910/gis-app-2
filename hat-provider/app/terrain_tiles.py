from dataclasses import dataclass
from functools import lru_cache
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


WEB_MERCATOR_CRS = CRS.from_epsg(3857)
WGS84_CRS = CRS.from_epsg(4326)
WEB_MERCATOR_HALF_WORLD = 20037508.342789244
WEB_MERCATOR_MIN = -WEB_MERCATOR_HALF_WORLD
WEB_MERCATOR_MAX = WEB_MERCATOR_HALF_WORLD
WGS84_MIN_X = -180.0
WGS84_MAX_X = 180.0
WGS84_MIN_Y = -90.0
WGS84_MAX_Y = 90.0
GEODETIC_TILE_ORIGIN_X = -180.0
GEODETIC_TILE_ORIGIN_Y = 270.0


@dataclass(frozen=True)
class SourceMetadata:
    path: str
    crs: str
    bounds: tuple[float, float, float, float]
    bounds_3857: tuple[float, float, float, float]
    resolution: float


@dataclass(frozen=True)
class VrtSourceSet:
    vrt_path: str
    sources: tuple[SourceMetadata, ...]
    bounds_3857: tuple[float, float, float, float]


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


def _unique_vrt_sources(vrt_path: Path) -> list[Path]:
    tree = ElementTree.parse(vrt_path)
    paths: list[Path] = []
    seen: set[str] = set()

    for source_node in tree.findall(".//SourceFilename"):
        source_path = _resolve_vrt_source(vrt_path, source_node)
        normalized = str(source_path)
        if normalized in seen:
            continue
        seen.add(normalized)
        paths.append(source_path)

    if not paths:
        raise RuntimeError(f"No source GeoPackages were found in {vrt_path}")

    return paths


@lru_cache(maxsize=128)
def inspect_vrt_sources(vrt_path: str) -> VrtSourceSet:
    resolved_vrt = resolve_runtime_path(vrt_path)
    if not resolved_vrt.exists():
        raise FileNotFoundError(f"VRT file does not exist at {resolved_vrt}")

    sources: list[SourceMetadata] = []
    for source_path in _unique_vrt_sources(resolved_vrt):
        with rasterio.open(source_path) as src:
            if src.count < 3:
                raise RuntimeError(f"Terrain source {source_path} must expose at least 3 bands.")
            if src.crs is None:
                raise RuntimeError(f"Terrain source {source_path} is missing CRS metadata.")

            native_resolution = max(abs(src.transform.a), abs(src.transform.e))
            bounds_3857 = transform_bounds(src.crs, WEB_MERCATOR_CRS, *src.bounds, densify_pts=21)
            sources.append(
                SourceMetadata(
                    path=str(source_path),
                    crs=src.crs.to_string(),
                    bounds=tuple(float(value) for value in src.bounds),
                    bounds_3857=tuple(float(value) for value in bounds_3857),
                    resolution=float(native_resolution),
                )
            )

    overall_bounds = (
        min(source.bounds_3857[0] for source in sources),
        min(source.bounds_3857[1] for source in sources),
        max(source.bounds_3857[2] for source in sources),
        max(source.bounds_3857[3] for source in sources),
    )
    return VrtSourceSet(vrt_path=str(resolved_vrt), sources=tuple(sources), bounds_3857=overall_bounds)


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
            out_shape=(3, TILE_SIZE, TILE_SIZE),
            boundless=True,
            fill_value=0,
            resampling=Resampling.nearest,
            masked=True,
        )

    rgb = raster.filled(0).astype(np.uint8)
    valid_mask = ~np.all(raster.mask, axis=0)
    if not np.any(valid_mask):
        return blank_png()

    alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
    return _encode_png(np.concatenate([rgb, alpha[np.newaxis, ...]], axis=0))


def render_terrain_rgb_tile(vrt_path: str, z: int, x: int, y: int) -> bytes:
    tile_bounds_3857 = xyz_tile_bounds(z, x, y)
    return _read_vrt_tile(vrt_path, tile_bounds_3857, WEB_MERCATOR_CRS)


def render_terrain_rgb_tile_4326(vrt_path: str, z: int, x: int, y: int) -> bytes:
    tile_bounds_4326 = xyz4326_tile_bounds(z, x, y)
    return _read_vrt_tile(vrt_path, tile_bounds_4326, WGS84_CRS)
