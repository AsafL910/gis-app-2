import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { AvailableGpkgFile } from "../types.js";

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = normalizePath(parentPath);
  const normalizedCandidate = normalizePath(candidatePath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
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
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    });
  }
}

export async function listAvailableGpkgs(): Promise<AvailableGpkgFile[]> {
  const files: AvailableGpkgFile[] = [];
  await walkForGpkgs(config.sharedDataRoot, files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function resolveSharedGpkg(relativePath: string): Promise<{
  absolutePath: string;
  fileName: string;
  size: number;
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
    size: stats.size
  };
}
