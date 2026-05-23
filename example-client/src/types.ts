export interface CatalogAsset {
  id: string;
  name: string;
  path: string;
  size: number;
}

export interface CatalogSet {
  id: string;
  name: string;
  description: string;
  maps: CatalogAsset[];
  dtmLayers: CatalogAsset[];
  vrtPath: string;
}

export interface SetsPayload {
  sets: CatalogSet[];
}

export interface LayerPayload {
  identifier: string;
  name: string;
  path: string;
  provider: string;
  tile_url: string;
  rest_tile_url: string;
  capabilities_url: string;
  demo_url: string;
  source_modes: string[];
  bounds: {
    epsg4326?: [number, number, number, number];
  };
}

export interface LayersPayload {
  layers: LayerPayload[];
  skipped_layers: Array<{
    identifier: string;
    name: string;
    path: string;
    reason: string;
  }>;
  service: {
    name: string;
    capabilities_url: string;
    demo_url: string;
    kvp_url: string;
    matrix_set: string;
    crs: string;
    base_url: string;
  };
}

export interface HatSourceMetadata {
  path: string;
  crs: string;
  resolution: number;
  bounds3857: [number, number, number, number];
}

export interface HatSetPayload {
  id: string;
  name: string;
  description: string;
  provider: string;
  format: string;
  scheme: string;
  tileMatrixSet: string;
  tileSize: number;
  encodingFormula: string;
  tileUrlTemplate: string;
  tileUrlTemplate4326: string;
  vrtPath: string;
  sources: HatSourceMetadata[];
}
