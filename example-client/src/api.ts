import type { HatSetPayload, LayersPayload, SetsPayload } from "./types";

const mapProviderBaseUrl = import.meta.env.VITE_MAP_PROVIDER_BASE_URL || "/map-provider-api";
const hatProviderBaseUrl = import.meta.env.VITE_HAT_PROVIDER_BASE_URL || "/hat-provider-api";

async function readJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function toProxyRelativeUrl(value: string): string {
  if (!value) {
    return value;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  }

  return value;
}

function parseCapabilitiesXml(xmlText: string): LayersPayload {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const layerElements = Array.from(xml.getElementsByTagNameNS("*", "Layer"));
  const matrixSetElement = xml.getElementsByTagNameNS("*", "TileMatrixSet")[0];
  const matrixSet =
    matrixSetElement?.getElementsByTagNameNS("*", "Identifier")[0]?.textContent?.trim() || "EPSG4326";

  const layers = layerElements
    .map((layerEl) => {
      const identifier = layerEl.getElementsByTagNameNS("*", "Identifier")[0]?.textContent?.trim() || "";
      const name = layerEl.getElementsByTagNameNS("*", "Title")[0]?.textContent?.trim() || identifier;
      const resource = layerEl.getElementsByTagNameNS("*", "ResourceURL")[0];
      const template = resource?.getAttribute("template") || "";
      const lower = layerEl.getElementsByTagNameNS("*", "LowerCorner")[0]?.textContent?.trim() || "";
      const upper = layerEl.getElementsByTagNameNS("*", "UpperCorner")[0]?.textContent?.trim() || "";
      const [minX, minY] = lower.split(/\s+/).map(Number);
      const [maxX, maxY] = upper.split(/\s+/).map(Number);

      if (!identifier || !template) {
        return null;
      }

      return {
        identifier,
        name,
        path: "",
        provider: "wmts",
        tile_url: "",
        rest_tile_url: toProxyRelativeUrl(template)
          .replace("{TileMatrix}", "{z}")
          .replace("{TileRow}", "{y}")
          .replace("{TileCol}", "{x}"),
        capabilities_url: "/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
        demo_url: "",
        source_modes: ["rest"],
        bounds:
          Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
            ? {
                epsg4326: [minX, minY, maxX, maxY] as [number, number, number, number]
              }
            : {}
      };
    })
    .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));

  return {
    layers,
    skipped_layers: [],
    service: {
      name: "map-server",
      capabilities_url: "/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
      demo_url: "",
      kvp_url: "/wmts?",
      matrix_set: matrixSet,
      crs: "EPSG:4326",
      base_url: ""
    }
  };
}

export async function fetchSets(): Promise<SetsPayload> {
  return readJson<SetsPayload>(`${mapProviderBaseUrl}/api/sets`, "Unable to load map sets from map-provider.");
}

export async function fetchLayersForSet(setId: string): Promise<LayersPayload> {
  return readJson<LayersPayload>(
    `${mapProviderBaseUrl}/api/sets/${encodeURIComponent(setId)}/layers`,
    `Unable to load WMTS layers for set "${setId}".`
  );
}

export async function fetchAllLayers(): Promise<LayersPayload> {
  const response = await fetch(`${mapProviderBaseUrl}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities`);
  if (!response.ok) {
    throw new Error("Unable to load global WMTS capabilities.");
  }

  return parseCapabilitiesXml(await response.text());
}

export async function fetchHatSet(setId: string): Promise<HatSetPayload> {
  return readJson<HatSetPayload>(
    `${hatProviderBaseUrl}/api/hat/sets/${encodeURIComponent(setId)}`,
    `Unable to load hat terrain tiles for set "${setId}".`
  );
}

export function resolveMapProviderUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${mapProviderBaseUrl}${path}`;
}

export function resolveHatProviderUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${hatProviderBaseUrl}${path}`;
}
