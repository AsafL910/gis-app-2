from pydantic import BaseModel, ConfigDict, Field


class CatalogAssetSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    path: str
    size: int


class CatalogSetSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    name: str
    description: str
    maps: list[CatalogAssetSchema]
    dtm_layers: list[CatalogAssetSchema] = Field(alias="dtmLayers")
    vrt_path: str = Field(alias="vrtPath")


class CatalogResponseSchema(BaseModel):
    sets: list[CatalogSetSchema]


class CatalogTileMatrixSchema(BaseModel):
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


class CatalogTileMatrixSetSchema(BaseModel):
    identifier: str
    supported_crs: str
    bounds: tuple[float, float, float, float]
    top_left_corner: list[float]


class CatalogBoundsNativeSchema(BaseModel):
    crs: str
    extent: tuple[float, float, float, float]


class CatalogBoundsSchema(BaseModel):
    epsg4326: tuple[float, float, float, float] | None
    native: CatalogBoundsNativeSchema


class CatalogWmtsLayerSchema(BaseModel):
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
    tile_matrix_set: CatalogTileMatrixSetSchema
    tile_matrices: list[CatalogTileMatrixSchema]
    bounds: CatalogBoundsSchema


class CatalogSkippedLayerSchema(BaseModel):
    identifier: str
    name: str
    path: str
    reason: str


class CatalogServiceSchema(BaseModel):
    name: str
    capabilities_url: str
    demo_url: str
    kvp_url: str
    base_url: str


class CatalogLayersResponseSchema(BaseModel):
    layers: list[CatalogWmtsLayerSchema]
    skipped_layers: list[CatalogSkippedLayerSchema]
    service: CatalogServiceSchema
