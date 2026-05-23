from fastapi import APIRouter, Request

from src.config import PUBLIC_BASE_URL
from src.services.catalog import list_catalog_sets


router = APIRouter(prefix="/api", tags=["Catalog"])


def _base_url(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


@router.get("/sets")
def list_sets():
    sets = list_catalog_sets()
    return {
        "sets": [
            {
                "id": map_set.id,
                "name": map_set.name,
                "description": map_set.description,
                "maps": [
                    {
                        "id": asset.id,
                        "name": asset.original_name,
                        "path": asset.relative_path,
                        "size": asset.size,
                    }
                    for asset in map_set.maps
                ],
                "dtmLayers": [
                    {
                        "id": asset.id,
                        "name": asset.original_name,
                        "path": asset.relative_path,
                        "size": asset.size,
                    }
                    for asset in map_set.dtm_layers
                ],
                "vrtPath": map_set.vrt_path,
            }
            for map_set in sets
        ]
    }


@router.get("/sets/{set_id}/layers")
def list_layers_for_set(set_id: str, request: Request):
    from src.services.wmts import list_wmts_payload

    return list_wmts_payload(_base_url(request), set_id)


@router.get("/layers")
def list_layers(request: Request):
    from src.services.wmts import list_wmts_payload

    return list_wmts_payload(_base_url(request))
