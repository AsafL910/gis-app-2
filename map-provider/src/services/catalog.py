from fastapi import HTTPException

from src.config import load_map_sets
from src.models.catalog import CatalogSet


def list_catalog_sets() -> list[CatalogSet]:
    return [
        CatalogSet(
            id=map_set.id,
            name=map_set.name,
            description=map_set.description,
            maps=map_set.maps,
            dtm_layers=map_set.dtm_layers,
            vrt_path=map_set.vrt_path,
        )
        for map_set in load_map_sets()
    ]


def get_catalog_set_or_404(set_id: str) -> CatalogSet:
    for map_set in list_catalog_sets():
        if map_set.id == set_id or map_set.name == set_id:
            return map_set

    raise HTTPException(status_code=404, detail=f'Map set "{set_id}" was not found.')
