import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { MapSetManifest, MapSetRecord } from "../types.js";

const EMPTY_MANIFEST: MapSetManifest = {
  version: 1,
  sets: []
};

export async function ensureDataLayout(): Promise<void> {
  await fs.mkdir(config.sharedDataRoot, { recursive: true });
  await fs.mkdir(config.setsRoot, { recursive: true });

  try {
    await fs.access(config.setsManifestPath);
  } catch {
    await fs.writeFile(
      config.setsManifestPath,
      JSON.stringify(EMPTY_MANIFEST, null, 2),
      "utf8"
    );
  }
}

export async function readManifest(): Promise<MapSetManifest> {
  await ensureDataLayout();
  const raw = await fs.readFile(config.setsManifestPath, "utf8");
  return JSON.parse(raw) as MapSetManifest;
}

export async function writeManifest(manifest: MapSetManifest): Promise<void> {
  await ensureDataLayout();
  await fs.writeFile(
    config.setsManifestPath,
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

export async function listSets(): Promise<MapSetRecord[]> {
  const manifest = await readManifest();
  return manifest.sets;
}

export async function getSetOrThrow(setId: string): Promise<MapSetRecord> {
  const manifest = await readManifest();
  const mapSet = manifest.sets.find((set) => set.id === setId);

  if (!mapSet) {
    throw new Error(`Map set "${setId}" was not found.`);
  }

  return mapSet;
}

export async function saveSet(mapSet: MapSetRecord): Promise<MapSetRecord> {
  const manifest = await readManifest();
  const existingIndex = manifest.sets.findIndex((set) => set.id === mapSet.id);

  if (existingIndex >= 0) {
    manifest.sets[existingIndex] = mapSet;
  } else {
    manifest.sets.push(mapSet);
  }

  await writeManifest(manifest);
  return mapSet;
}

export async function deleteSetRecord(setId: string): Promise<MapSetRecord | null> {
  const manifest = await readManifest();
  const existingIndex = manifest.sets.findIndex((set) => set.id === setId);

  if (existingIndex < 0) {
    return null;
  }

  const [deleted] = manifest.sets.splice(existingIndex, 1);
  await writeManifest(manifest);
  return deleted;
}

export function getSetFolder(setId: string): string {
  return path.join(config.setsRoot, setId);
}
