from typing import Literal

from pydantic import BaseModel, Field, model_validator


Coordinate = tuple[float, float]


class PointQuery(BaseModel):
    type: Literal["point"]
    coordinates: Coordinate


class PathQuery(BaseModel):
    type: Literal["path"]
    coordinates: list[Coordinate] = Field(min_length=1)


class BboxSampling(BaseModel):
    columns: int = Field(default=5, ge=1, le=200)
    rows: int = Field(default=5, ge=1, le=200)


class BboxQuery(BaseModel):
    type: Literal["bbox"]
    bbox: tuple[float, float, float, float]
    sampling: BboxSampling = Field(default_factory=BboxSampling)

    @model_validator(mode="after")
    def validate_bbox(self) -> "BboxQuery":
        min_x, min_y, max_x, max_y = self.bbox
        if min_x >= max_x or min_y >= max_y:
            raise ValueError("bbox must be [minX, minY, maxX, maxY] with positive width and height")
        return self


TerrainQuery = PointQuery | PathQuery | BboxQuery


class TerrainCalculationRequest(BaseModel):
    set_id: str = Field(alias="setId")
    query: TerrainQuery


class SampleResult(BaseModel):
    coordinate: Coordinate
    elevation: float | None
    pixel: tuple[int, int] | None


class TerrainCalculationResponse(BaseModel):
    set_id: str = Field(alias="setId")
    vrt_path: str = Field(alias="vrtPath")
    query_type: str = Field(alias="queryType")
    encoding_formula: str = Field(alias="encodingFormula")
    samples: list[SampleResult]
