import type { LayersPayload } from "./types";

export async function fetchLayers(): Promise<LayersPayload> {
  const response = await fetch("/api/layers");
  if (!response.ok) {
    throw new Error("Unable to load published WMTS layers.");
  }

  return (await response.json()) as LayersPayload;
}
