export type StoredAssetKind = "map" | "dtm";

export interface StoredAsset {
  id: string;
  kind: StoredAssetKind;
  originalName: string;
  storedName: string;
  relativePath: string;
  absolutePath: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface DtmLayer extends StoredAsset {
  priority: number;
}

export interface MapSetRecord {
  id: string;
  name: string;
  description?: string;
  maps: StoredAsset[];
  dtmLayers: DtmLayer[];
  vrtPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface MapSetManifest {
  version: 1;
  sets: MapSetRecord[];
}

export interface AvailableGpkgFile {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  size: number;
  modifiedAt: string;
}

export interface GdalInfoBand {
  band: number;
  colorInterpretation?: string;
}

export interface GdalInfoDataset {
  size: [number, number];
  geoTransform?: [number, number, number, number, number, number];
  coordinateSystem?: {
    wkt?: string;
  };
  bands?: GdalInfoBand[];
}
