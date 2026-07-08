import type { LayersPayload } from "./types";

export async function fetchLayers(): Promise<LayersPayload> {
  const response = await fetch("/api/v1/layers");
  if (!response.ok) {
    throw new Error("Unable to load published WMTS layers.");
  }

  return (await response.json()) as LayersPayload;
}
