from dataclasses import dataclass
import re
from pathlib import Path

import rasterio
from rasterio.errors import RasterioIOError
from rasterio.windows import Window

from .config import DATA_ROOT


@dataclass(frozen=True)
class RasterSample:
    coordinate: tuple[float, float]
    elevation: float | None
    pixel: tuple[int, int] | None


def decode_rgb_elevation(red: int, green: int, blue: int) -> float:
    # Canonical terrain decoding formula agreed for this service:
    # elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
    return -10000 + ((red * 256 * 256 + green * 256 + blue) * 0.1)


def open_dataset(vrt_path: str):
    try:
        dataset = rasterio.open(vrt_path)
    except RasterioIOError as exc:
        raise RuntimeError(f"Unable to open VRT dataset at {vrt_path}") from exc

    if dataset.count < 3:
        dataset.close()
        raise RuntimeError(f"Terrain source {vrt_path} must expose at least 3 bands.")
    if dataset.crs is None:
        dataset.close()
        raise RuntimeError(f"Terrain source {vrt_path} is missing CRS metadata.")
    return dataset


def _slugify_set_name(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().replace("\\", "/")).strip("-").lower()
    return slug or "set"


def resolve_set_vrt_path(map_set: dict[str, object]) -> str:
    raw_vrt_path = str(map_set.get("vrtPath", "")).strip()
    if raw_vrt_path and raw_vrt_path.lower().endswith(".vrt"):
        resolved_path = Path(raw_vrt_path)
        if resolved_path.exists():
            return str(resolved_path)

    candidate_names = [
        str(map_set.get("id", "")).strip(),
        _slugify_set_name(str(map_set.get("name", "")).strip()),
    ]
    candidate_paths = []
    for candidate_name in candidate_names:
        if not candidate_name:
            continue
        candidate_paths.append((DATA_ROOT / "sets" / f"{candidate_name}.vrt").resolve())

    if raw_vrt_path:
        candidate_paths.append(Path(raw_vrt_path).resolve())

    for candidate_path in candidate_paths:
        if candidate_path.exists() and candidate_path.suffix.lower() == ".vrt":
            return str(candidate_path)

    checked = ", ".join(str(path) for path in candidate_paths) or raw_vrt_path or "<missing>"
    raise FileNotFoundError(f"Could not resolve a set VRT for terrain calculation. Checked: {checked}")


def sample_coordinate(dataset, coordinate: tuple[float, float]) -> RasterSample:
    row, column = dataset.index(coordinate[0], coordinate[1])

    if column < 0 or row < 0 or column >= dataset.width or row >= dataset.height:
        return RasterSample(coordinate=coordinate, elevation=None, pixel=None)

    window = Window(column, row, 1, 1)
    values = dataset.read([1, 2, 3], window=window)

    elevation = decode_rgb_elevation(int(values[0, 0, 0]), int(values[1, 0, 0]), int(values[2, 0, 0]))
    return RasterSample(coordinate=coordinate, elevation=elevation, pixel=(column, row))


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
