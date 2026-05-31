import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createId } from "../utils/id.js";
import { resolveSharedGpkg, storeSharedGpkg } from "./available-gpkg-service.js";
import { deleteSetRecord, getSetFolder, getSetOrThrow, listSets, saveSet } from "./manifest-store.js";
import { generateDtmVrt } from "./vrt-builder.js";
import type { DtmLayer, MapSetRecord, StoredAsset, StoredAssetKind } from "../types.js";

interface UploadedFileShape {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface DtmSelectionOrderItem {
  source: "upload" | "existing";
  relativePath?: string;
}

function buildOrderedDtms(params: {
  uploadedDtms: StoredAsset[];
  copiedDtms: StoredAsset[];
  selectedDtmPaths?: string[];
  dtmSelectionOrder?: DtmSelectionOrderItem[];
}): StoredAsset[] {
  const selectedDtmPaths = params.selectedDtmPaths ?? [];
  const copiedByRelativePath = new Map(selectedDtmPaths.map((filePath, index) => [filePath, params.copiedDtms[index]]));
  const uploadQueue = [...params.uploadedDtms];

  return params.dtmSelectionOrder && params.dtmSelectionOrder.length
    ? params.dtmSelectionOrder.map((item) => {
        if (item.source === "upload") {
          const nextUpload = uploadQueue.shift();
          if (!nextUpload) {
            throw new Error("DTM selection order referenced more uploads than were provided.");
          }
          return nextUpload;
        }

        if (!item.relativePath) {
          throw new Error("DTM selection order is missing a selected shared file path.");
        }

        const selectedFile = copiedByRelativePath.get(item.relativePath);
        if (!selectedFile) {
          throw new Error(`Selected DTM "${item.relativePath}" was not provided.`);
        }

        return selectedFile;
      })
    : [...params.uploadedDtms, ...params.copiedDtms];
}

function hasAssetWithRelativePath(assets: StoredAsset[], relativePath: string): boolean {
  return assets.some((asset) => asset.relativePath === relativePath);
}

async function storeUploadedFile(
  kind: StoredAssetKind,
  file: UploadedFileShape
): Promise<StoredAsset> {
  const assetId = createId(kind);
  const storedFile = await storeSharedGpkg(file);

  return {
    id: assetId,
    kind,
    originalName: file.originalname,
    storedName: storedFile.fileName,
    relativePath: storedFile.relativePath,
    absolutePath: storedFile.absolutePath,
    mimeType: file.mimetype || "application/geopackage+sqlite3",
    size: file.size,
    createdAt: new Date().toISOString()
  };
}

async function linkSharedFileIntoSet(
  setId: string,
  kind: StoredAssetKind,
  sharedRelativePath: string
): Promise<StoredAsset> {
  const sharedFile = await resolveSharedGpkg(sharedRelativePath);
  const assetId = createId(kind);

  return {
    id: assetId,
    kind,
    originalName: sharedFile.fileName,
    storedName: sharedFile.fileName,
    relativePath: sharedRelativePath,
    absolutePath: sharedFile.absolutePath,
    mimeType: "application/geopackage+sqlite3",
    size: sharedFile.size,
    createdAt: new Date().toISOString()
  };
}

function toDtmLayers(assets: StoredAsset[]): DtmLayer[] {
  return assets.map((asset, index) => ({
    ...asset,
    priority: index
  }));
}

export async function getAllSets(): Promise<MapSetRecord[]> {
  return listSets();
}

export async function createSet(params: {
  name: string;
  description?: string;
  maps: UploadedFileShape[];
  dtms: UploadedFileShape[];
  selectedMapPaths?: string[];
  selectedDtmPaths?: string[];
  dtmSelectionOrder?: DtmSelectionOrderItem[];
}): Promise<MapSetRecord> {
  if (!params.name.trim()) {
    throw new Error("Map set name is required.");
  }

  if (params.dtms.length === 0 && (params.selectedDtmPaths?.length ?? 0) === 0) {
    throw new Error("At least one DTM file is required.");
  }

  const setId = createId("set");
  const storedMaps = [
    ...(await Promise.all(params.maps.map((file) => storeUploadedFile("map", file)))),
    ...(await Promise.all(
      (params.selectedMapPaths ?? []).map((filePath) => linkSharedFileIntoSet(setId, "map", filePath))
    ))
  ];
  const uploadedDtms = await Promise.all(params.dtms.map((file) => storeUploadedFile("dtm", file)));
  const selectedDtmPaths = params.selectedDtmPaths ?? [];
  const copiedDtms = await Promise.all(selectedDtmPaths.map((filePath) => linkSharedFileIntoSet(setId, "dtm", filePath)));
  const storedDtms = buildOrderedDtms({
    uploadedDtms,
    copiedDtms,
    selectedDtmPaths,
    dtmSelectionOrder: params.dtmSelectionOrder
  });
  const dtmLayers = toDtmLayers(storedDtms);
  const vrtPath = path.join(getSetFolder(setId), `${setId}.vrt`);
  const now = new Date().toISOString();

  await generateDtmVrt(vrtPath, dtmLayers);

  const mapSet: MapSetRecord = {
    id: setId,
    name: params.name.trim(),
    description: params.description?.trim() || undefined,
    maps: storedMaps,
    dtmLayers,
    vrtPath,
    createdAt: now,
    updatedAt: now
  };

  return saveSet(mapSet);
}

export async function appendAssetsToSet(
  setId: string,
  params: {
    maps: UploadedFileShape[];
    dtms: UploadedFileShape[];
    selectedMapPaths?: string[];
    selectedDtmPaths?: string[];
    dtmSelectionOrder?: DtmSelectionOrderItem[];
  }
): Promise<MapSetRecord> {
  const mapSet = await getSetOrThrow(setId);

  if (
    params.maps.length === 0 &&
    params.dtms.length === 0 &&
    (params.selectedMapPaths?.length ?? 0) === 0 &&
    (params.selectedDtmPaths?.length ?? 0) === 0
  ) {
    throw new Error("Choose at least one map or DTM file to add.");
  }

  const selectedMapPaths = params.selectedMapPaths ?? [];
  const selectedDtmPaths = params.selectedDtmPaths ?? [];

  for (const relativePath of selectedMapPaths) {
    if (hasAssetWithRelativePath(mapSet.maps, relativePath)) {
      throw new Error(`Map "${relativePath}" is already part of set "${mapSet.name}".`);
    }
  }

  for (const relativePath of selectedDtmPaths) {
    if (hasAssetWithRelativePath(mapSet.dtmLayers, relativePath)) {
      throw new Error(`DTM "${relativePath}" is already part of set "${mapSet.name}".`);
    }
  }

  const storedMaps = [
    ...(await Promise.all(params.maps.map((file) => storeUploadedFile("map", file)))),
    ...(await Promise.all(selectedMapPaths.map((filePath) => linkSharedFileIntoSet(setId, "map", filePath))))
  ];
  const uploadedDtms = await Promise.all(params.dtms.map((file) => storeUploadedFile("dtm", file)));
  const copiedDtms = await Promise.all(selectedDtmPaths.map((filePath) => linkSharedFileIntoSet(setId, "dtm", filePath)));
  const storedDtms = buildOrderedDtms({
    uploadedDtms,
    copiedDtms,
    selectedDtmPaths,
    dtmSelectionOrder: params.dtmSelectionOrder
  });

  const updatedSet: MapSetRecord = {
    ...mapSet,
    maps: [...mapSet.maps, ...storedMaps],
    dtmLayers: toDtmLayers([...mapSet.dtmLayers, ...storedDtms]),
    updatedAt: new Date().toISOString()
  };

  await generateDtmVrt(updatedSet.vrtPath, updatedSet.dtmLayers);
  return saveSet(updatedSet);
}

export async function reorderDtmLayers(setId: string, orderedDtmIds: string[]): Promise<MapSetRecord> {
  const mapSet = await getSetOrThrow(setId);

  if (orderedDtmIds.length !== mapSet.dtmLayers.length) {
    throw new Error("The provided DTM order must include every existing DTM layer exactly once.");
  }

  const indexedLayers = new Map(mapSet.dtmLayers.map((layer) => [layer.id, layer]));
  const reordered = orderedDtmIds.map((id, index) => {
    const layer = indexedLayers.get(id);

    if (!layer) {
      throw new Error(`DTM layer "${id}" does not belong to set "${setId}".`);
    }

    return {
      ...layer,
      priority: index
    };
  });

  if (new Set(reordered.map((layer) => layer.id)).size !== mapSet.dtmLayers.length) {
    throw new Error("The provided DTM order contains duplicate IDs.");
  }

  const updatedSet: MapSetRecord = {
    ...mapSet,
    dtmLayers: reordered,
    updatedAt: new Date().toISOString()
  };

  await generateDtmVrt(updatedSet.vrtPath, updatedSet.dtmLayers);
  return saveSet(updatedSet);
}

export async function removeSet(setId: string): Promise<MapSetRecord | null> {
  const deleted = await deleteSetRecord(setId);

  if (!deleted) {
    return null;
  }

  await fs.rm(getSetFolder(setId), { recursive: true, force: true });
  return deleted;
}
