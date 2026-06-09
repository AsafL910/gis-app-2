import type { AvailableGpkgFile, MapSetRecord } from "./types";

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(rawBody) as { error?: string };
        throw new Error(payload.error ?? fallbackMessage);
      } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
          throw error;
        }
      }
    }

    if (response.status === 413) {
      throw new Error("Upload is too large for the web UI proxy. The request exceeded the Nginx body size limit.");
    }

    const compactBody = rawBody.replace(/\s+/g, " ").trim();
    throw new Error(compactBody || fallbackMessage);
  }

  if (!rawBody) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Expected JSON response but received ${contentType || "unknown content type"}.`);
  }
}

export async function fetchSets(): Promise<MapSetRecord[]> {
  const response = await fetch("/api/sets");
  const payload = await readJsonOrThrow<{ sets: MapSetRecord[] }>(response, "Unable to load map sets.");
  return payload.sets;
}

export async function fetchAvailableGpkgs(): Promise<AvailableGpkgFile[]> {
  const response = await fetch("/api/maps");
  const payload = await readJsonOrThrow<{ files: AvailableGpkgFile[] }>(
    response,
    "Unable to load available maps.",
  );
  return payload.files;
}

export async function fetchAvailableDtms(): Promise<AvailableGpkgFile[]> {
  const response = await fetch("/api/dtms");
  const payload = await readJsonOrThrow<{ files: AvailableGpkgFile[] }>(
    response,
    "Unable to load available DTMs.",
  );
  return payload.files;
}

export async function uploadSharedGpkg(file: File): Promise<AvailableGpkgFile> {
  const form = new FormData();
  form.append("gpkg", file);

  const response = await fetch("/api/maps/upload", {
    method: "POST",
    body: form,
  });

  const payload = await readJsonOrThrow<{ file: AvailableGpkgFile }>(
    response,
    "Unable to upload map GeoPackage to the shared data folder.",
  );
  return payload.file;
}

export async function uploadSharedDtm(file: File): Promise<AvailableGpkgFile> {
  const form = new FormData();
  form.append("dtm", file);

  const response = await fetch("/api/dtms/upload", {
    method: "POST",
    body: form,
  });

  const payload = await readJsonOrThrow<{ file: AvailableGpkgFile }>(
    response,
    "Unable to upload DTM GeoPackage to the shared data folder.",
  );
  return payload.file;
}

export async function renameSharedGpkg(relativePath: string, nextFileName: string): Promise<AvailableGpkgFile> {
  const response = await fetch("/api/maps", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ relativePath, nextFileName }),
  });

  const payload = await readJsonOrThrow<{ file: AvailableGpkgFile }>(response, "Unable to rename shared GeoPackage.");
  return payload.file;
}

export async function deleteSharedGpkg(relativePath: string): Promise<void> {
  const response = await fetch(`/api/maps?path=${encodeURIComponent(relativePath)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await readJsonOrThrow(response, "Unable to delete shared GeoPackage.");
  }
}

export function getSharedGpkgDownloadUrl(relativePath: string): string {
  return `/api/maps/download?path=${encodeURIComponent(relativePath)}`;
}

export async function renameSharedDtm(relativePath: string, nextFileName: string): Promise<AvailableGpkgFile> {
  const response = await fetch("/api/dtms", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ relativePath, nextFileName }),
  });

  const payload = await readJsonOrThrow<{ file: AvailableGpkgFile }>(
    response,
    "Unable to rename shared GeoPackage.",
  );
  return payload.file;
}

export async function deleteSharedDtm(relativePath: string): Promise<void> {
  const response = await fetch(`/api/dtms?path=${encodeURIComponent(relativePath)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await readJsonOrThrow(response, "Unable to delete shared GeoPackage.");
  }
}

export function getSharedDtmDownloadUrl(relativePath: string): string {
  return `/api/dtms/download?path=${encodeURIComponent(relativePath)}`;
}

export async function createSet(input: {
  name: string;
  description: string;
  maps: File[];
  dtms: File[];
  selectedMapPaths: string[];
  selectedDtmPaths: string[];
  dtmSelectionOrder: Array<{ source: "upload" | "existing"; relativePath?: string }>;
}): Promise<MapSetRecord> {
  const form = new FormData();
  form.append("name", input.name);
  form.append("description", input.description);
  input.maps.forEach((file) => form.append("maps", file));
  input.dtms.forEach((file) => form.append("dtms", file));
  form.append("selectedMapPaths", JSON.stringify(input.selectedMapPaths));
  form.append("selectedDtmPaths", JSON.stringify(input.selectedDtmPaths));
  form.append("dtmSelectionOrder", JSON.stringify(input.dtmSelectionOrder));

  const response = await fetch("/api/sets", {
    method: "POST",
    body: form,
  });

  return readJsonOrThrow<MapSetRecord>(response, "Unable to create map set.");
}

export async function addAssetsToSet(
  setId: string,
  input: {
    maps: File[];
    dtms: File[];
    selectedMapPaths: string[];
    selectedDtmPaths: string[];
    dtmSelectionOrder: Array<{ source: "upload" | "existing"; relativePath?: string }>;
  }
): Promise<MapSetRecord> {
  const form = new FormData();
  input.maps.forEach((file) => form.append("maps", file));
  input.dtms.forEach((file) => form.append("dtms", file));
  form.append("selectedMapPaths", JSON.stringify(input.selectedMapPaths));
  form.append("selectedDtmPaths", JSON.stringify(input.selectedDtmPaths));
  form.append("dtmSelectionOrder", JSON.stringify(input.dtmSelectionOrder));

  const response = await fetch(`/api/sets/${setId}/assets`, {
    method: "POST",
    body: form,
  });

  return readJsonOrThrow<MapSetRecord>(response, "Unable to add assets to the selected map set.");
}

export async function updateDtmOrder(setId: string, dtmIds: string[]): Promise<MapSetRecord> {
  const response = await fetch(`/api/sets/${setId}/dtm-order`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dtmIds }),
  });

  return readJsonOrThrow<MapSetRecord>(response, "Unable to update DTM order.");
}

export async function deleteSet(setId: string): Promise<void> {
  const response = await fetch(`/api/sets/${setId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await readJsonOrThrow(response, "Unable to delete map set.");
  }
}
