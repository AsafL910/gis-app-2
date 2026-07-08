from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GeoPackageLayerConfig:
    identifier: str
    title: str
    relative_path: str


@dataclass(frozen=True)
class StoredAssetRecord:
    id: str
    original_name: str
    stored_name: str
    relative_path: str
    absolute_path: Path
    size: int


@dataclass(frozen=True)
class MapSetRecord:
    id: str
    name: str
    description: str
    maps: list[StoredAssetRecord]
    dtm_layers: list[StoredAssetRecord]
    vrt_path: str


@dataclass(frozen=True)
class CatalogSet:
    id: str
    name: str
    description: str
    maps: list[StoredAssetRecord]
    dtm_layers: list[StoredAssetRecord]
    vrt_path: str
