/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogServiceSchema } from './CatalogServiceSchema';
import type { CatalogSkippedLayerSchema } from './CatalogSkippedLayerSchema';
import type { CatalogWmtsLayerSchema } from './CatalogWmtsLayerSchema';
export type CatalogLayersResponseSchema = {
  layers: Array<CatalogWmtsLayerSchema>;
  skipped_layers: Array<CatalogSkippedLayerSchema>;
  service: CatalogServiceSchema;
};

