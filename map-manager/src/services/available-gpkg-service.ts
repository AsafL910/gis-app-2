import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { readManifest, writeManifest } from "./manifest-store.js";
import { generateDtmVrt } from "./vrt-builder.js";
import type { AvailableGpkgFile } from "../types.js";

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = normalizePath(parentPath);
  const normalizedCandidate = normalizePath(candidatePath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function toFileSize(size: number | bigint): number {
  return Number(size);
}

async function walkForGpkgs(directoryPath: string, files: AvailableGpkgFile[]): Promise<void> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (isWithin(config.setsRoot, absolutePath)) {
        continue;
      }

      await walkForGpkgs(absolutePath, files);
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gpkg") {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    files.push({
      relativePath: path.relative(config.sharedDataRoot, absolutePath),
      absolutePath,
      fileName: path.basename(absolutePath),
      size: toFileSize(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      referencedBySets: []
    });
  }
}

function getReferencingSetNames(relativePath: string, sets: Awaited<ReturnType<typeof readManifest>>["sets"]): string[] {
  return sets.flatMap((set) => {
    const isReferenced =
      set.maps.some((asset) => asset.relativePath === relativePath) ||
      set.dtmLayers.some((asset) => asset.relativePath === relativePath);

    return isReferenced ? [set.name] : [];
  });
}

function toAvailableFile(
  absolutePath: string,
  stats: Awaited<ReturnType<typeof fs.stat>>,
  referencedBySets: string[]
): AvailableGpkgFile {
  return {
    relativePath: path.relative(config.sharedDataRoot, absolutePath),
    absolutePath,
    fileName: path.basename(absolutePath),
    size: toFileSize(stats.size),
    modifiedAt: stats.mtime.toISOString(),
    referencedBySets
  };
}

async function getSharedFileInfo(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
  size: number;
  modifiedAt: string;
}> {
  const candidatePath = path.resolve(config.sharedDataRoot, relativePath);

  if (!isWithin(config.sharedDataRoot, candidatePath)) {
    throw new Error("Selected file must stay inside the shared data folder.");
  }

  if (isWithin(config.setsRoot, candidatePath)) {
    throw new Error("Files inside data/sets are managed assets and cannot be picked directly.");
  }

  if (path.extname(candidatePath).toLowerCase() !== ".gpkg") {
    throw new Error("Only .gpkg files can be selected from the shared data folder.");
  }

  const stats = await fs.stat(candidatePath);
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

  if (path.extname(normalized).toLowerCase() !== ".gpkg") {
    throw new Error("GeoPackage file names must end with .gpkg.");
  }

  return normalized;
}

export async function listAvailableGpkgs(): Promise<AvailableGpkgFile[]> {
  const files: AvailableGpkgFile[] = [];
  await walkForGpkgs(config.sharedDataRoot, files);
  const manifest = await readManifest();

  return files
    .map((file) => ({
      ...file,
      referencedBySets: getReferencingSetNames(file.relativePath, manifest.sets)
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function storeSharedGpkg(file: {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}): Promise<AvailableGpkgFile> {
  const fileName = validateSharedFileName(path.basename(file.originalname));

  const absolutePath = path.join(config.sharedDataRoot, fileName);

  if (isWithin(config.setsRoot, absolutePath)) {
    throw new Error("Shared GeoPackages cannot be uploaded into the managed sets folder.");
  }

  try {
    const existingStats = await fs.stat(absolutePath);
    if (existingStats.isFile()) {
      throw new Error(`A shared GeoPackage named "${fileName}" already exists.`);
    }
  } catch (error) {
    if (!(error instanceof Error) || "code" in error === false || error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.writeFile(absolutePath, file.buffer);
  const stats = await fs.stat(absolutePath);

  return toAvailableFile(absolutePath, stats, []);
}

export async function renameSharedGpkg(relativePath: string, nextFileName: string): Promise<AvailableGpkgFile> {
  const current = await getSharedFileInfo(relativePath);
  const normalizedFileName = validateSharedFileName(nextFileName);

  if (normalizedFileName === current.fileName) {
    throw new Error("Choose a different file name before saving.");
  }

  const nextAbsolutePath = path.join(config.sharedDataRoot, normalizedFileName);

  if (isWithin(config.setsRoot, nextAbsolutePath)) {
    throw new Error("Shared GeoPackages cannot be renamed into the managed sets folder.");
  }

  try {
    const existingStats = await fs.stat(nextAbsolutePath);
    if (existingStats.isFile()) {
      throw new Error(`A shared GeoPackage named "${normalizedFileName}" already exists.`);
    }
  } catch (error) {
    if (!(error instanceof Error) || "code" in error === false || error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(current.absolutePath, nextAbsolutePath);

  const manifest = await readManifest();
  const nextRelativePath = path.relative(config.sharedDataRoot, nextAbsolutePath);
  const updatedSets = manifest.sets.map((set) => {
    const nextMaps = set.maps.map((asset) =>
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

    const changed =
      nextMaps.some((asset, index) => asset !== set.maps[index]) ||
      nextDtmLayers.some((asset, index) => asset !== set.dtmLayers[index]);

    return changed
      ? {
          ...set,
          maps: nextMaps,
          dtmLayers: nextDtmLayers,
          updatedAt: new Date().toISOString()
        }
      : set;
  });

  const changedDtmSets = updatedSets.filter((set) => set.dtmLayers.some((asset) => asset.relativePath === nextRelativePath));

  await writeManifest({
    ...manifest,
    sets: updatedSets
  });

  await Promise.all(changedDtmSets.map((set) => generateDtmVrt(set.vrtPath, set.dtmLayers)));

  const stats = await fs.stat(nextAbsolutePath);
  return toAvailableFile(nextAbsolutePath, stats, getReferencingSetNames(nextRelativePath, updatedSets));
}

export async function deleteSharedGpkg(relativePath: string): Promise<void> {
  const file = await getSharedFileInfo(relativePath);
  const manifest = await readManifest();
  const referencedBySets = getReferencingSetNames(relativePath, manifest.sets);

  if (referencedBySets.length) {
    throw new Error(`This GeoPackage is used by: ${referencedBySets.join(", ")}. Remove it from those sets first.`);
  }

  await fs.rm(file.absolutePath, { force: false });
}

export async function getDownloadableSharedGpkg(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
}> {
  const file = await getSharedFileInfo(relativePath);
  return {
    absolutePath: file.absolutePath,
    fileName: file.fileName
  };
}

export async function resolveSharedGpkg(relativePath: string): Promise<{
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
