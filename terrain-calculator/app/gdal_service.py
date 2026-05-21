from dataclasses import dataclass
from math import floor
from pathlib import Path

from osgeo import gdal

gdal.UseExceptions()


@dataclass(frozen=True)
class RasterSample:
    coordinate: tuple[float, float]
    elevation: float | None
    pixel: tuple[int, int] | None


def decode_rgb_elevation(red: int, green: int, blue: int) -> float:
    # Canonical terrain decoding formula agreed for this service:
    # elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
    return -10000 + ((red * 256 * 256 + green * 256 + blue) * 0.1)


def world_to_pixel(geo_transform: tuple[float, float, float, float, float, float], x: float, y: float) -> tuple[int, int]:
    det = geo_transform[1] * geo_transform[5] - geo_transform[2] * geo_transform[4]
    if det == 0:
        raise ValueError("Invalid GeoTransform: determinant is zero.")

    pixel = (geo_transform[5] * (x - geo_transform[0]) - geo_transform[2] * (y - geo_transform[3])) / det
    line = (-geo_transform[4] * (x - geo_transform[0]) + geo_transform[1] * (y - geo_transform[3])) / det
    return floor(pixel), floor(line)


def open_dataset(vrt_path: str):
    dataset = gdal.Open(vrt_path, gdal.GA_ReadOnly)
    if dataset is None:
        raise RuntimeError(f"Unable to open VRT dataset at {vrt_path}")
    return dataset


def sample_coordinate(dataset, coordinate: tuple[float, float]) -> RasterSample:
    geo_transform = dataset.GetGeoTransform(can_return_null=True)
    if geo_transform is None:
        raise RuntimeError("VRT dataset is missing georeferencing information.")

    pixel, line = world_to_pixel(geo_transform, coordinate[0], coordinate[1])

    if pixel < 0 or line < 0 or pixel >= dataset.RasterXSize or line >= dataset.RasterYSize:
        return RasterSample(coordinate=coordinate, elevation=None, pixel=None)

    red = dataset.GetRasterBand(1).ReadAsArray(pixel, line, 1, 1)
    green = dataset.GetRasterBand(2).ReadAsArray(pixel, line, 1, 1)
    blue = dataset.GetRasterBand(3).ReadAsArray(pixel, line, 1, 1)

    if red is None or green is None or blue is None:
        return RasterSample(coordinate=coordinate, elevation=None, pixel=(pixel, line))

    elevation = decode_rgb_elevation(int(red[0][0]), int(green[0][0]), int(blue[0][0]))
    return RasterSample(coordinate=coordinate, elevation=elevation, pixel=(pixel, line))


def sample_path(dataset, coordinates: list[tuple[float, float]]) -> list[RasterSample]:
    return [sample_coordinate(dataset, coordinate) for coordinate in coordinates]


def sample_bbox(
    dataset,
    bbox: tuple[float, float, float, float],
    columns: int,
    rows: int,
) -> list[RasterSample]:
    min_x, min_y, max_x, max_y = bbox
    x_step = (max_x - min_x) / max(columns - 1, 1)
    y_step = (max_y - min_y) / max(rows - 1, 1)

    coordinates: list[tuple[float, float]] = []
    for row in range(rows):
        for column in range(columns):
            x = min_x + (column * x_step)
            y = min_y + (row * y_step)
            coordinates.append((x, y))

    return [sample_coordinate(dataset, coordinate) for coordinate in coordinates]


def ensure_vrt_exists(vrt_path: str) -> str:
    resolved_path = Path(vrt_path)
    if not resolved_path.exists():
        raise FileNotFoundError(f"VRT file does not exist at {resolved_path}")
    return str(resolved_path)
