import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GdalInfoDataset } from "../types.js";

const execFileAsync = promisify(execFile);

export async function readGdalMetadata(filePath: string): Promise<GdalInfoDataset> {
  try {
    const { stdout } = await execFileAsync("gdalinfo", ["-json", filePath], {
      windowsHide: true
    });

    return JSON.parse(stdout) as GdalInfoDataset;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GDAL metadata error";

    throw new Error(
      `Unable to inspect "${filePath}" with gdalinfo. Ensure GDAL is installed and on PATH. ${message}`
    );
  }
}
