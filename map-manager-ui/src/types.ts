export interface StoredAsset {
  id: string;
  kind: "map" | "dtm";
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

export interface AvailableGpkgFile {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  size: number;
  modifiedAt: string;
  referencedBySets: string[];
  managedBySet: boolean;
}
