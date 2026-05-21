import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createId } from "../utils/id.js";
import { resolveSharedGpkg } from "./available-gpkg-service.js";
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

async function storeUploadedFile(
  setId: string,
  kind: StoredAssetKind,
  file: UploadedFileShape
): Promise<StoredAsset> {
  const assetId = createId(kind);
  const sourceExtension = path.extname(file.originalname) || ".gpkg";
  const storedName = `${assetId}${sourceExtension}`;
  const relativePath = path.join("sets", setId, kind, storedName);
  const absolutePath = path.join(config.sharedDataRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer);

  return {
    id: assetId,
    kind,
    originalName: file.originalname,
    storedName,
    relativePath,
    absolutePath,
    mimeType: file.mimetype || "application/geopackage+sqlite3",
    size: file.size,
    createdAt: new Date().toISOString()
  };
}

async function copySharedFileIntoSet(
  setId: string,
  kind: StoredAssetKind,
  sharedRelativePath: string
): Promise<StoredAsset> {
  const sharedFile = await resolveSharedGpkg(sharedRelativePath);
  const assetId = createId(kind);
  const sourceExtension = path.extname(sharedFile.fileName) || ".gpkg";
  const storedName = `${assetId}${sourceExtension}`;
  const relativePath = path.join("sets", setId, kind, storedName);
  const absolutePath = path.join(config.sharedDataRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.copyFile(sharedFile.absolutePath, absolutePath);

  return {
    id: assetId,
    kind,
    originalName: sharedFile.fileName,
    storedName,
    relativePath,
    absolutePath,
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
    ...(await Promise.all(params.maps.map((file) => storeUploadedFile(setId, "map", file)))),
    ...(await Promise.all(
      (params.selectedMapPaths ?? []).map((filePath) => copySharedFileIntoSet(setId, "map", filePath))
    ))
  ];
  const uploadedDtms = await Promise.all(params.dtms.map((file) => storeUploadedFile(setId, "dtm", file)));
  const selectedDtmPaths = params.selectedDtmPaths ?? [];
  const copiedDtms = await Promise.all(selectedDtmPaths.map((filePath) => copySharedFileIntoSet(setId, "dtm", filePath)));
  const copiedByRelativePath = new Map(selectedDtmPaths.map((filePath, index) => [filePath, copiedDtms[index]]));
  const uploadQueue = [...uploadedDtms];
  const storedDtms =
    params.dtmSelectionOrder && params.dtmSelectionOrder.length
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
      : [...uploadedDtms, ...copiedDtms];
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
