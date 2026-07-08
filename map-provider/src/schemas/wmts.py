from pydantic import BaseModel


class WmtsTileMatrixSchema(BaseModel):
    identifier: str
    zoom: int
    matrix_width: int
    matrix_height: int
    tile_width: int
    tile_height: int
    pixel_x_size: float
    pixel_y_size: float
    scale_denominator: float
    min_tile_col: int
    max_tile_col: int
    min_tile_row: int
    max_tile_row: int


class WmtsTileMatrixSetSchema(BaseModel):
    identifier: str
    supported_crs: str
    bounds: tuple[float, float, float, float]
    top_left_corner: list[float]


class WmtsBoundsNativeSchema(BaseModel):
    crs: str
    extent: tuple[float, float, float, float]


class WmtsBoundsSchema(BaseModel):
    epsg4326: tuple[float, float, float, float] | None
    native: WmtsBoundsNativeSchema


class WmtsLayerSchema(BaseModel):
    identifier: str
    name: str
    path: str
    provider: str
    tile_url: str
    rest_tile_url: str
    capabilities_url: str
    demo_url: str
    source_modes: list[str]
    format: str
    min_zoom: int
    max_zoom: int
    matrix_set: str
    crs: str
    tile_matrix_set: WmtsTileMatrixSetSchema
    tile_matrices: list[WmtsTileMatrixSchema]
    bounds: WmtsBoundsSchema


class WmtsSkippedLayerSchema(BaseModel):
    identifier: str
    name: str
    path: str
    reason: str


class WmtsServiceSchema(BaseModel):
    name: str
    capabilities_url: str
    demo_url: str
    kvp_url: str
    base_url: str


class WmtsPayloadSchema(BaseModel):
    layers: list[WmtsLayerSchema]
    skipped_layers: list[WmtsSkippedLayerSchema]
    service: WmtsServiceSchema
