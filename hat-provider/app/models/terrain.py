from dataclasses import dataclass

Bounds4326 = tuple[float, float, float, float]


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
    bounds: Bounds4326
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
    bounds: Bounds4326

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
