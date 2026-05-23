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
  format?: string;
  min_zoom?: number;
  max_zoom?: number;
  matrix_set?: string;
  crs?: string;
  tile_matrix_set?: {
    identifier: string;
    supported_crs: string;
    bounds: [number, number, number, number];
    top_left_corner: [number, number];
  };
  tile_matrices?: Array<{
    identifier: string;
    zoom: number;
    matrix_width: number;
    matrix_height: number;
    tile_width: number;
    tile_height: number;
    pixel_x_size: number;
    pixel_y_size: number;
    scale_denominator: number;
    min_tile_col: number;
    max_tile_col: number;
    min_tile_row: number;
    max_tile_row: number;
  }>;
  bounds: {
    epsg4326?: [number, number, number, number];
    native?: {
      crs: string;
      extent: [number, number, number, number];
    };
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
