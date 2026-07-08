import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

export const OPENAPI_VERSION = "3.0.3";

export const OPENAPI_TITLE = "Map Manager API";
export const OPENAPI_DESCRIPTION = "API documentation for the map-manager service.";

function readServiceVersion(): string {
  try {
    const pkgPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SERVICE_VERSION = readServiceVersion();

