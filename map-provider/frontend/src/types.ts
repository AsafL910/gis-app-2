export interface LayerPayload {
  identifier: string;
  name: string;
  path: string;
  url: string;
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
