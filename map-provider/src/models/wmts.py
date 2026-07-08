from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SpatialRefMetadata:
    srs_id: int
    organization: str
    organization_coordsys_id: int
    definition: str

    @property
    def supported_crs(self) -> str:
        if self.organization.upper() == "EPSG" and self.organization_coordsys_id > 0:
            return f"urn:ogc:def:crs:EPSG::{self.organization_coordsys_id}"
        if self.organization and self.organization_coordsys_id > 0:
            return f"{self.organization}:{self.organization_coordsys_id}"
        return self.definition or str(self.srs_id)


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

    @property
    def scale_denominator(self) -> float:
        return self.pixel_x_size / 0.00028


@dataclass(frozen=True)
class WmtsLayerMetadata:
    identifier: str
    title: str
    relative_path: str
    absolute_path: Path
    table_name: str
    content_identifier: str
    native_bounds: tuple[float, float, float, float]
    bounds_4326: tuple[float, float, float, float] | None
    matrix_set_bounds: tuple[float, float, float, float]
    spatial_ref: SpatialRefMetadata
    tile_matrices: tuple[TileMatrixMetadata, ...]
    mime_type: str
    file_extension: str

    @property
    def matrix_set_identifier(self) -> str:
        return f"matrixset_{self.identifier}"

    @property
    def min_zoom(self) -> int:
        return self.tile_matrices[0].zoom_level

    @property
    def max_zoom(self) -> int:
        return self.tile_matrices[-1].zoom_level

    def tile_matrix_by_zoom(self, zoom_level: int) -> TileMatrixMetadata | None:
        for matrix in self.tile_matrices:
            if matrix.zoom_level == zoom_level:
                return matrix
        return None


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
