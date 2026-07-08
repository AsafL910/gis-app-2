import type { CatalogAssetSchema } from "./api/generated/map-provider/models/CatalogAssetSchema";
import type { CatalogSetSchema } from "./api/generated/map-provider/models/CatalogSetSchema";
import type { CatalogResponseSchema } from "./api/generated/map-provider/models/CatalogResponseSchema";
import type { CatalogWmtsLayerSchema } from "./api/generated/map-provider/models/CatalogWmtsLayerSchema";
import type { CatalogLayersResponseSchema } from "./api/generated/map-provider/models/CatalogLayersResponseSchema";

export type CatalogAsset = CatalogAssetSchema;
export type CatalogSet = CatalogSetSchema;
export type SetsPayload = CatalogResponseSchema;
export type LayerPayload = CatalogWmtsLayerSchema;
export type LayersPayload = CatalogLayersResponseSchema;

export interface HatSourceMetadata {
  path: string;
  crs: string;
  resolution: number;
  bounds: [number, number, number, number];
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
