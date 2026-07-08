import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { isPathWithin } from "../utils/path.js";
import { listSets, saveSet } from "./manifest-store.js";
import { generateDtmVrt } from "./vrt-builder.js";
import type { AvailableGpkgFile } from "../types.js";

function isWithin(parentPath: string, candidatePath: string): boolean {
  return isPathWithin(parentPath, candidatePath);
}

function toFileSize(size: number | bigint): number {
  return Number(size);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

async function walkForDtms(directoryPath: string, files: AvailableGpkgFile[]): Promise<void> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkForDtms(absolutePath, files);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || extension !== ".gpkg") {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    files.push({
      relativePath: path.relative(config.sharedDtmRoot, absolutePath),
      absolutePath,
      fileName: path.basename(absolutePath),
      size: toFileSize(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      referencedBySets: [],
      managedBySet: isWithin(config.setsRoot, absolutePath)
    });
  }
}

function getReferencingSetNames(relativePath: string, sets: Awaited<ReturnType<typeof listSets>>): string[] {
  return sets.flatMap((set) => {
    const isReferenced = set.dtmLayers.some((asset) => asset.relativePath === relativePath);

    return isReferenced ? [set.name] : [];
  });
}

function toAvailableFile(
  absolutePath: string,
  stats: Awaited<ReturnType<typeof fs.stat>>,
  referencedBySets: string[]
): AvailableGpkgFile {
  return {
    relativePath: path.relative(config.sharedDtmRoot, absolutePath),
    absolutePath,
    fileName: path.basename(absolutePath),
    size: toFileSize(stats.size),
    modifiedAt: stats.mtime.toISOString(),
    referencedBySets,
    managedBySet: isWithin(config.setsRoot, absolutePath)
  };
}

async function getSharedFileInfo(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
  size: number;
  modifiedAt: string;
}> {
  const candidatePath = path.resolve(config.sharedDtmRoot, relativePath);

  if (!isWithin(config.sharedDtmRoot, candidatePath)) {
    throw new Error("Selected file must stay inside the shared DTM folder.");
  }

  const extension = path.extname(candidatePath).toLowerCase();
  if (extension !== ".gpkg") {
    throw new Error("Only .gpkg files can be selected from the DTM folder.");
  }

  let stats;
  try {
    stats = await fs.stat(candidatePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Shared file "${relativePath}" was not found.`);
    }
    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(`Shared file "${relativePath}" was not found.`);
  }

  return {
    absolutePath: candidatePath,
    fileName: path.basename(candidatePath),
    size: toFileSize(stats.size),
    modifiedAt: stats.mtime.toISOString()
  };
}

function validateSharedFileName(fileName: string): string {
  const normalized = path.basename(fileName).trim();

  if (!normalized) {
    throw new Error("GeoPackage file name is required.");
  }

  if (normalized !== fileName.trim()) {
    throw new Error("GeoPackage file name cannot include folder segments.");
  }

  const extension = path.extname(normalized).toLowerCase();
  if (extension !== ".gpkg") {
    throw new Error("GeoPackage file names must end with .gpkg.");
  }

  return normalized;
}

export async function listAvailableDtms(): Promise<AvailableGpkgFile[]> {
  const files: AvailableGpkgFile[] = [];
  await walkForDtms(config.sharedDtmRoot, files);
  const sets = await listSets();

  return files
    .map((file) => ({
      ...file,
      referencedBySets: getReferencingSetNames(file.relativePath, sets)
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function storeSharedDtm(file: {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}): Promise<AvailableGpkgFile> {
  const fileName = validateSharedFileName(path.basename(file.originalname));

  const absolutePath = path.join(config.sharedDtmRoot, fileName);

  if (isWithin(config.setsRoot, absolutePath)) {
    throw new Error("Shared DTMs cannot be uploaded into the managed sets folder.");
  }

  try {
    const existingStats = await fs.stat(absolutePath);
    if (existingStats.isFile()) {
      throw new Error(`A shared GeoPackage named "${fileName}" already exists.`);
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  await fs.writeFile(absolutePath, file.buffer);
  const stats = await fs.stat(absolutePath);

  return toAvailableFile(absolutePath, stats, []);
}

export async function renameSharedDtm(relativePath: string, nextFileName: string): Promise<AvailableGpkgFile> {
  const current = await getSharedFileInfo(relativePath);
  const normalizedFileName = validateSharedFileName(nextFileName);

  if (normalizedFileName === current.fileName) {
    throw new Error("Choose a different file name before saving.");
  }

  const nextAbsolutePath = path.join(config.sharedDtmRoot, normalizedFileName);

  if (isWithin(config.setsRoot, nextAbsolutePath)) {
    throw new Error("Shared DTMs cannot be renamed into the managed sets folder.");
  }

  try {
    const existingStats = await fs.stat(nextAbsolutePath);
    if (existingStats.isFile()) {
      throw new Error(`A shared GeoPackage named "${normalizedFileName}" already exists.`);
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  await fs.rename(current.absolutePath, nextAbsolutePath);

  const sets = await listSets();
  const nextRelativePath = path.relative(config.sharedDtmRoot, nextAbsolutePath);
  const updatedSets = sets.map((set) => {
    const nextDtmLayers = set.dtmLayers.map((asset) =>
      asset.relativePath === relativePath
        ? {
            ...asset,
            originalName: normalizedFileName,
            storedName: normalizedFileName,
            relativePath: nextRelativePath,
            absolutePath: nextAbsolutePath
          }
        : asset
    );

    const changed = nextDtmLayers.some((asset, index) => asset !== set.dtmLayers[index]);

    return changed
      ? {
          ...set,
          dtmLayers: nextDtmLayers,
          updatedAt: new Date().toISOString()
        }
      : set;
  });

  const changedDtmSets = updatedSets.filter((set) => set.dtmLayers.some((asset) => asset.relativePath === nextRelativePath));

  await Promise.all(updatedSets.map((set) => saveSet(set)));

  await Promise.all(changedDtmSets.map((set) => generateDtmVrt(set.vrtPath, set.dtmLayers)));

  const stats = await fs.stat(nextAbsolutePath);
  return toAvailableFile(nextAbsolutePath, stats, getReferencingSetNames(nextRelativePath, updatedSets));
}

export async function deleteSharedDtm(relativePath: string): Promise<void> {
  const file = await getSharedFileInfo(relativePath);
  const sets = await listSets();
  const referencedBySets = getReferencingSetNames(relativePath, sets);

  if (referencedBySets.length) {
    throw new Error(`This GeoPackage is used by: ${referencedBySets.join(", ")}. Remove it from those sets first.`);
  }

  await fs.rm(file.absolutePath, { force: false });
}

export async function getDownloadableSharedDtm(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
}> {
  const file = await getSharedFileInfo(relativePath);
  return {
    absolutePath: file.absolutePath,
    fileName: file.fileName
  };
}

export async function resolveSharedDtm(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
  size: number;
}> {
  const file = await getSharedFileInfo(relativePath);

  return {
    absolutePath: file.absolutePath,
    fileName: file.fileName,
    size: file.size
  };
}
