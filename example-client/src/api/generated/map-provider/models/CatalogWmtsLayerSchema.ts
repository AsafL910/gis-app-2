/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogBoundsSchema } from './CatalogBoundsSchema';
import type { CatalogTileMatrixSchema } from './CatalogTileMatrixSchema';
import type { CatalogTileMatrixSetSchema } from './CatalogTileMatrixSetSchema';
export type CatalogWmtsLayerSchema = {
  identifier: string;
  name: string;
  path: string;
  provider: string;
  tile_url: string;
  rest_tile_url: string;
  capabilities_url: string;
  demo_url: string;
  source_modes: Array<string>;
  format: string;
  min_zoom: number;
  max_zoom: number;
  matrix_set: string;
  crs: string;
  tile_matrix_set: CatalogTileMatrixSetSchema;
  tile_matrices: Array<CatalogTileMatrixSchema>;
  bounds: CatalogBoundsSchema;
};

