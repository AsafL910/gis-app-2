import type { HatSetPayload, LayerPayload, LayersPayload, SetsPayload } from "./types";

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

function textContent(parent: Element | null | undefined, localName: string): string {
  return parent?.getElementsByTagNameNS("*", localName)[0]?.textContent?.trim() || "";
}

function parseCoordinatePair(value: string): [number, number] | undefined {
  const parts = value.split(/\s+/).map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return undefined;
  }

  return [parts[0], parts[1]];
}

function parseBoundingBox(box?: Element | null): [number, number, number, number] | undefined {
  if (!box) {
    return undefined;
  }

  const lower = parseCoordinatePair(textContent(box, "LowerCorner"));
  const upper = parseCoordinatePair(textContent(box, "UpperCorner"));
  if (!lower || !upper) {
    return undefined;
  }

  return [lower[0], lower[1], upper[0], upper[1]];
}

function parseCapabilitiesXml(xmlText: string): LayersPayload {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const matrixSetElements = Array.from(xml.getElementsByTagNameNS("*", "TileMatrixSet"));
  const matrixSets = new Map<
    string,
    {
      identifier: string;
      supported_crs: string;
      bounds?: [number, number, number, number];
      top_left_corner?: [number, number];
      tile_matrices: NonNullable<LayerPayload["tile_matrices"]>;
    }
  >();

  for (const matrixSetEl of matrixSetElements) {
    const identifier = textContent(matrixSetEl, "Identifier");
    if (!identifier) {
      continue;
    }

    const tileMatrixElements = Array.from(matrixSetEl.getElementsByTagNameNS("*", "TileMatrix"));
    const tileMatrices = tileMatrixElements
      .map((tileMatrixEl) => {
        const matrixIdentifier = textContent(tileMatrixEl, "Identifier");
        const topLeftCorner = parseCoordinatePair(textContent(tileMatrixEl, "TopLeftCorner"));
        const matrixWidth = Number(textContent(tileMatrixEl, "MatrixWidth"));
        const matrixHeight = Number(textContent(tileMatrixEl, "MatrixHeight"));
        const tileWidth = Number(textContent(tileMatrixEl, "TileWidth"));
        const tileHeight = Number(textContent(tileMatrixEl, "TileHeight"));
        const scaleDenominator = Number(textContent(tileMatrixEl, "ScaleDenominator"));
        const resolution = Number.isFinite(scaleDenominator) ? scaleDenominator * 0.00028 : Number.NaN;

        if (
          !matrixIdentifier ||
          !topLeftCorner ||
          !Number.isFinite(matrixWidth) ||
          !Number.isFinite(matrixHeight) ||
          !Number.isFinite(tileWidth) ||
          !Number.isFinite(tileHeight) ||
          !Number.isFinite(resolution)
        ) {
          return null;
        }

        return {
          identifier: matrixIdentifier,
          zoom: Number(matrixIdentifier),
          matrix_width: matrixWidth,
          matrix_height: matrixHeight,
          tile_width: tileWidth,
          tile_height: tileHeight,
          pixel_x_size: resolution,
          pixel_y_size: resolution,
          scale_denominator: scaleDenominator,
          min_tile_col: 0,
          max_tile_col: matrixWidth - 1,
          min_tile_row: 0,
          max_tile_row: matrixHeight - 1,
          top_left_corner: topLeftCorner
        };
      })
      .filter((matrix): matrix is NonNullable<typeof matrix> => Boolean(matrix));

    matrixSets.set(identifier, {
      identifier,
      supported_crs: textContent(matrixSetEl, "SupportedCRS"),
      bounds: parseBoundingBox(matrixSetEl.getElementsByTagNameNS("*", "BoundingBox")[0]),
      top_left_corner: tileMatrices[0]?.top_left_corner,
      tile_matrices: tileMatrices.map(({ top_left_corner: _ignored, ...matrix }) => matrix)
    });
  }

  const layerElements = Array.from(xml.getElementsByTagNameNS("*", "Layer"));
  const layers = layerElements
    .map((layerEl) => {
      const identifier = textContent(layerEl, "Identifier");
      const name = textContent(layerEl, "Title") || identifier;
      const resource = layerEl.getElementsByTagNameNS("*", "ResourceURL")[0];
      const template = resource?.getAttribute("template") || "";
      const format = resource?.getAttribute("format") || undefined;
      const wgs84Bounds = parseBoundingBox(layerEl.getElementsByTagNameNS("*", "WGS84BoundingBox")[0]);
      const nativeBox = layerEl.getElementsByTagNameNS("*", "BoundingBox")[0];
      const nativeBounds = parseBoundingBox(nativeBox);
      const nativeCrs = nativeBox?.getAttribute("crs") || "";
      const matrixSetIdentifier = textContent(layerEl.getElementsByTagNameNS("*", "TileMatrixSetLink")[0], "TileMatrixSet");
      const matrixSet = matrixSets.get(matrixSetIdentifier);

      if (!identifier || !template || !matrixSet) {
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
        format,
        min_zoom: matrixSet.tile_matrices[0]?.zoom,
        max_zoom: matrixSet.tile_matrices[matrixSet.tile_matrices.length - 1]?.zoom,
        matrix_set: matrixSet.identifier,
        crs: matrixSet.supported_crs,
        tile_matrix_set: {
          identifier: matrixSet.identifier,
          supported_crs: matrixSet.supported_crs,
          bounds: matrixSet.bounds || [0, 0, 0, 0],
          top_left_corner: matrixSet.top_left_corner || [0, 0]
        },
        tile_matrices: matrixSet.tile_matrices,
        bounds: {
          epsg4326: wgs84Bounds,
          native: nativeBounds && nativeCrs ? { crs: nativeCrs, extent: nativeBounds } : undefined
        }
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
  return readJson<LayersPayload>(`${mapProviderBaseUrl}/api/layers`, "Unable to load global WMTS layers.");
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
