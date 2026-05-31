import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { readGdalMetadata } from "./gdal-metadata.js";
import { promisify } from "node:util";
import type { DtmLayer } from "../types.js";

const execFileAsync = promisify(execFile);

function rewriteSlashes(value: string, slash: "/" | "\\"): string {
  return slash === "/" ? value.replaceAll("\\", "/") : value.replaceAll("/", "\\");
}

async function rewriteVrtSourcePaths(vrtPath: string, dtmLayers: DtmLayer[]): Promise<void> {
  let xml = await fs.readFile(vrtPath, "utf8");

  for (const layer of dtmLayers) {
    const candidates = new Set<string>([
      layer.absolutePath,
      rewriteSlashes(layer.absolutePath, "/"),
      rewriteSlashes(layer.absolutePath, "\\"),
    ]);

    for (const candidate of candidates) {
      xml = xml.split(candidate).join(layer.absolutePath);
    }
  }

  await fs.writeFile(vrtPath, xml, "utf8");
}

export async function generateDtmVrt(vrtPath: string, dtmLayers: DtmLayer[]): Promise<void> {
  if (dtmLayers.length === 0) {
    throw new Error("Cannot generate a VRT without at least one DTM layer.");
  }

  for (const layer of dtmLayers) {
    const metadata = await readGdalMetadata(layer.absolutePath);
    const bands = metadata.bands ?? [];

    if (!metadata.geoTransform) {
      throw new Error(`DTM "${layer.originalName}" is missing GeoTransform metadata.`);
    }

    if (bands.length < 3) {
      throw new Error(`DTM "${layer.originalName}" must expose 3 RGB bands for elevation decoding.`);
    }
  }

  // Later inputs win in overlap areas, so we feed GDAL the lowest-priority rasters first
  // and the highest-priority rasters last.
  const sourcesInVrtPriorityOrder = [...dtmLayers].reverse().map((layer) => layer.absolutePath);

  try {
    await execFileAsync(
      "gdalbuildvrt",
      [
        "-overwrite",
        "-resolution",
        "highest",
        "-b",
        "1",
        "-b",
        "2",
        "-b",
        "3",
        "-srcnodata",
        "0",
        "-vrtnodata",
        "0",
        "-ignore_srcmaskband",
        vrtPath,
        ...sourcesInVrtPriorityOrder,
      ],
      { windowsHide: true },
    );
    await rewriteVrtSourcePaths(vrtPath, dtmLayers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GDAL VRT build error";
    throw new Error(
      `Unable to build terrain VRT at "${vrtPath}". Ensure gdalbuildvrt is installed and on PATH. ${message}`,
    );
  }
}
