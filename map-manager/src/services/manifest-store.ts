import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { MapSetManifest, MapSetRecord } from "../types.js";
import { assertPathWithin } from "../utils/path.js";
import {
  buildSetKey,
  buildSetManifestPath,
  buildSetVrtPath,
} from "./set-paths.js";

const MANIFEST_VERSION: MapSetManifest["version"] = 1;

function sortManifestPaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function toSetId(setName: string): string {
  return buildSetKey(setName);
}

function hydrateSetRecord(raw: Partial<MapSetRecord> & { name?: string }, fallbackPath?: string): MapSetRecord {
  const name = String(raw.name ?? "").trim();
  if (!name) {
    throw new Error("Set manifest is missing a name.");
  }

  const createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : createdAt;
  const maps = Array.isArray(raw.maps) ? raw.maps : [];
  const dtmLayers = Array.isArray(raw.dtmLayers) ? raw.dtmLayers : [];
  const requestedVrtPath = typeof raw.vrtPath === "string" && raw.vrtPath.trim()
    ? raw.vrtPath
    : fallbackPath ?? buildSetVrtPath(config.setsRoot, name);
  const vrtPath = assertPathWithin(
    config.setsRoot,
    requestedVrtPath,
    `Set "${name}" has a VRT path outside the managed sets folder.`
  );

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : toSetId(name),
    name,
    description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined,
    maps,
    dtmLayers,
    vrtPath,
    createdAt,
    updatedAt
  };
}

function stripRuntimeFields(set: MapSetRecord): MapSetManifest {
  return {
    version: MANIFEST_VERSION,
    name: set.name,
    description: set.description,
    maps: set.maps,
    dtmLayers: set.dtmLayers,
    vrtPath: set.vrtPath,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt
  };
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listManifestFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(config.setsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
      .map((entry) => path.join(config.setsRoot, entry.name))
      .sort(sortManifestPaths);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function locateLegacyVrtSource(rawSet: Partial<MapSetRecord> & { name?: string }): Promise<string | null> {
  const expectedPath = typeof rawSet.vrtPath === "string" && rawSet.vrtPath.trim()
    ? path.resolve(rawSet.vrtPath)
    : null;

  if (expectedPath) {
    try {
      const stats = await fs.stat(expectedPath);
      if (stats.isFile()) {
        return expectedPath;
      }
    } catch {
      // Fall through to name-derived location.
    }
  }

  const setName = String(rawSet.name ?? "").trim();
  if (!setName) {
    return null;
  }

  const preferredCandidate = buildSetVrtPath(config.setsRoot, setName);
  try {
    const stats = await fs.stat(preferredCandidate);
    if (stats.isFile()) {
      return preferredCandidate;
    }
  } catch {
    return null;
  }

  return null;
}

async function migrateLegacyManifestIfNeeded(): Promise<void> {
  const legacyRaw = await readJsonFile(config.setsManifestPath);
  if (!legacyRaw || typeof legacyRaw !== "object" || !("sets" in legacyRaw)) {
    return;
  }

  const rawSets = Array.isArray((legacyRaw as { sets?: unknown }).sets) ? (legacyRaw as { sets: unknown[] }).sets : [];
  if (rawSets.length === 0) {
    return;
  }

  const existingManifests = new Set(
    (await listManifestFiles()).map((manifestPath) => path.basename(manifestPath).toLowerCase())
  );

  for (const rawSet of rawSets) {
    if (!rawSet || typeof rawSet !== "object") {
      continue;
    }

    const hydrated = hydrateSetRecord(rawSet as Partial<MapSetRecord> & { name?: string });
    const manifestFileName = buildSetManifestPath(config.setsRoot, hydrated.name);
    const manifestBaseName = path.basename(manifestFileName).toLowerCase();
    if (existingManifests.has(manifestBaseName)) {
      continue;
    }

    const currentVrt = await locateLegacyVrtSource(rawSet as Partial<MapSetRecord> & { name?: string });
    const desiredVrt = buildSetVrtPath(config.setsRoot, hydrated.name);

    if (currentVrt && path.resolve(currentVrt) !== path.resolve(desiredVrt) && currentVrt !== desiredVrt) {
      await fs.mkdir(path.dirname(desiredVrt), { recursive: true });
      try {
        await fs.rename(currentVrt, desiredVrt);
        hydrated.vrtPath = desiredVrt;
      } catch {
        hydrated.vrtPath = currentVrt;
      }
    } else if (currentVrt) {
      hydrated.vrtPath = currentVrt;
    } else {
      hydrated.vrtPath = desiredVrt;
    }

    await writeSetManifest(hydrated);
  }
}

async function readSetManifestFile(manifestPath: string): Promise<MapSetRecord | null> {
  const raw = await readJsonFile(manifestPath);

  if (!raw || typeof raw !== "object") {
    return null;
  }

  if ("sets" in raw) {
    return null;
  }

  const manifest = raw as Partial<MapSetRecord> & { name?: string };
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    return null;
  }

  return hydrateSetRecord(manifest, buildSetVrtPath(config.setsRoot, manifest.name));
}

async function writeSetManifest(set: MapSetRecord): Promise<void> {
  await fs.mkdir(config.setsRoot, { recursive: true });
  const manifestPath = buildSetManifestPath(config.setsRoot, set.name);
  await fs.writeFile(manifestPath, JSON.stringify(stripRuntimeFields(set), null, 2), "utf8");
}

export async function ensureDataLayout(): Promise<void> {
  await fs.mkdir(config.sharedDataRoot, { recursive: true });
  await fs.mkdir(config.sharedDtmRoot, { recursive: true });
  await fs.mkdir(config.setsRoot, { recursive: true });
  await migrateLegacyManifestIfNeeded();
}

export async function listSets(): Promise<MapSetRecord[]> {
  await ensureDataLayout();
  const manifestFiles = await listManifestFiles();

  const sets = (await Promise.all(manifestFiles.map((manifestPath) => readSetManifestFile(manifestPath)))).flatMap(
    (set) => (set ? [set] : [])
  );

  return sets.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readManifest(): Promise<MapSetManifest> {
  const sets = await listSets();
  return {
    version: MANIFEST_VERSION,
    name: "",
    maps: [],
    dtmLayers: [],
    vrtPath: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sets: sets as never
  } as unknown as MapSetManifest;
}

export async function writeManifest(manifest: { version?: 1; sets: MapSetRecord[] }): Promise<void> {
  await ensureDataLayout();

  const existingSets = await listSets();
  const nextByName = new Map(manifest.sets.map((set) => [set.name, set]));

  await Promise.all(manifest.sets.map((set) => writeSetManifest(set)));

  await Promise.all(
    existingSets
      .filter((set) => !nextByName.has(set.name))
      .map(async (set) => {
        const manifestPath = buildSetManifestPath(config.setsRoot, set.name);
        await fs.rm(manifestPath, { force: true });
      })
  );
}

export async function getSetOrThrow(setId: string): Promise<MapSetRecord> {
  const sets = await listSets();
  const mapSet = sets.find((set) => set.id === setId || set.name === setId);

  if (!mapSet) {
    throw new Error(`Map set "${setId}" was not found.`);
  }

  return mapSet;
}

export async function saveSet(mapSet: MapSetRecord): Promise<MapSetRecord> {
  await ensureDataLayout();
  const hydrated = hydrateSetRecord(mapSet, buildSetVrtPath(config.setsRoot, mapSet.name));
  await writeSetManifest(hydrated);
  return hydrated;
}

export async function deleteSetRecord(setId: string): Promise<MapSetRecord | null> {
  const mapSet = await getSetOrThrow(setId).catch(() => null);

  if (!mapSet) {
    return null;
  }

  const manifestPath = buildSetManifestPath(config.setsRoot, mapSet.name);
  await fs.rm(manifestPath, { force: true });
  return mapSet;
}
