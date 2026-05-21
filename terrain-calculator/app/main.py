from fastapi import FastAPI, HTTPException

from .config import RGB_ELEVATION_FORMULA
from .gdal_service import ensure_vrt_exists, open_dataset, sample_bbox, sample_coordinate, sample_path
from .models import BboxQuery, PathQuery, PointQuery, SampleResult, TerrainCalculationRequest, TerrainCalculationResponse
from .storage import get_map_set

app = FastAPI(title="Terrain Calculation Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/api/terrain/calculate", response_model=TerrainCalculationResponse)
def calculate_terrain(payload: TerrainCalculationRequest) -> TerrainCalculationResponse:
    try:
        map_set = get_map_set(payload.set_id)
        vrt_path = ensure_vrt_exists(map_set["vrtPath"])
        dataset = open_dataset(vrt_path)
    except (FileNotFoundError, KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    query = payload.query

    try:
        if isinstance(query, PointQuery):
            samples = [sample_coordinate(dataset, query.coordinates)]
        elif isinstance(query, PathQuery):
            samples = sample_path(dataset, query.coordinates)
        elif isinstance(query, BboxQuery):
            samples = sample_bbox(
                dataset,
                query.bbox,
                query.sampling.columns,
                query.sampling.rows,
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported query type.")
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        dataset = None

    return TerrainCalculationResponse(
        setId=payload.set_id,
        vrtPath=vrt_path,
        queryType=query.type,
        encodingFormula=RGB_ELEVATION_FORMULA,
        samples=[
            SampleResult(
                coordinate=sample.coordinate,
                elevation=sample.elevation,
                pixel=sample.pixel,
            )
            for sample in samples
        ],
    )
