import path from "node:path";

function slugifySetName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return normalized || "set";
}

export function buildSetKey(setName: string): string {
  return slugifySetName(setName);
}

export function buildSetManifestFileName(setName: string): string {
  return `${buildSetKey(setName)}.json`;
}

export function buildSetVrtFileName(setName: string): string {
  return `${buildSetKey(setName)}.vrt`;
}

export function buildSetManifestPath(setsRoot: string, setName: string): string {
  return path.join(setsRoot, buildSetManifestFileName(setName));
}

export function buildSetVrtPath(setsRoot: string, setName: string): string {
  return path.join(setsRoot, buildSetVrtFileName(setName));
}
