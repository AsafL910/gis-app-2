import type { AvailableGpkgFile, MapSetRecord } from "./types";

export async function fetchSets(): Promise<MapSetRecord[]> {
  const response = await fetch("/api/sets");
  if (!response.ok) {
    throw new Error("Unable to load map sets.");
  }

  const payload = (await response.json()) as { sets: MapSetRecord[] };
  return payload.sets;
}

export async function fetchAvailableGpkgs(): Promise<AvailableGpkgFile[]> {
  const response = await fetch("/api/sets/available-gpkgs");
  if (!response.ok) {
    throw new Error("Unable to load available GeoPackages.");
  }

  const payload = (await response.json()) as { files: AvailableGpkgFile[] };
  return payload.files;
}

export async function uploadSharedGpkg(file: File): Promise<AvailableGpkgFile> {
  const form = new FormData();
  form.append("gpkg", file);

  const response = await fetch("/api/sets/available-gpkgs/upload", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Unable to upload GeoPackage to the shared data folder.");
  }

  const payload = (await response.json()) as { file: AvailableGpkgFile };
  return payload.file;
}

export async function renameSharedGpkg(relativePath: string, nextFileName: string): Promise<AvailableGpkgFile> {
  const response = await fetch("/api/sets/available-gpkgs", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ relativePath, nextFileName })
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Unable to rename shared GeoPackage.");
  }

  const payload = (await response.json()) as { file: AvailableGpkgFile };
  return payload.file;
}

export async function deleteSharedGpkg(relativePath: string): Promise<void> {
  const response = await fetch(`/api/sets/available-gpkgs?path=${encodeURIComponent(relativePath)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Unable to delete shared GeoPackage.");
  }
}

export function getSharedGpkgDownloadUrl(relativePath: string): string {
  return `/api/sets/available-gpkgs/download?path=${encodeURIComponent(relativePath)}`;
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
    body: form
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Unable to create map set.");
  }

  return (await response.json()) as MapSetRecord;
}

export async function updateDtmOrder(setId: string, dtmIds: string[]): Promise<MapSetRecord> {
  const response = await fetch(`/api/sets/${setId}/dtm-order`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ dtmIds })
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Unable to update DTM order.");
  }

  return (await response.json()) as MapSetRecord;
}

export async function deleteSet(setId: string): Promise<void> {
  const response = await fetch(`/api/sets/${setId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error("Unable to delete map set.");
  }
}
