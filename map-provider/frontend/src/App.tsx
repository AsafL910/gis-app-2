import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import WMTS from "ol/source/WMTS";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { defaults as defaultControls } from "ol/control";
import { get as getProjection } from "ol/proj";
import type { LayerPayload, LayersPayload } from "./types";
import { fetchLayers } from "./api";

const DEFAULT_PROJECTION = "EPSG:4326";

function normalizeProjectionCode(value?: string): string {
  if (!value) {
    return DEFAULT_PROJECTION;
  }

  const trimmed = value.trim();
  const urnMatch = trimmed.match(/EPSG(?::|::)(\d+)$/i);
  if (urnMatch) {
    return `EPSG:${urnMatch[1]}`;
  }

  const epsgMatch = trimmed.match(/^EPSG:(\d+)$/i);
  if (epsgMatch) {
    return `EPSG:${epsgMatch[1]}`;
  }

  return trimmed;
}

function buildTileLayer(layer: LayerPayload, projection: string): TileLayer<WMTS> {
  const matrices = layer.tile_matrices ?? [];
  if (!matrices.length || !layer.tile_matrix_set) {
    throw new Error(`Layer "${layer.identifier}" is missing tile matrix metadata.`);
  }

  const tileGrid = new WMTSTileGrid({
    origin: layer.tile_matrix_set.top_left_corner,
    resolutions: matrices.map((matrix) => matrix.pixel_x_size),
    matrixIds: matrices.map((matrix) => matrix.identifier),
    sizes: matrices.map((matrix) => [matrix.matrix_width, matrix.matrix_height]),
    tileSizes: matrices.map((matrix) => [matrix.tile_width, matrix.tile_height])
  });

  return new TileLayer({
    source: new WMTS({
      url: layer.rest_tile_url
        .replace("/{z}/{y}/{x}.png", "/{TileMatrix}/{TileRow}/{TileCol}.png")
        .replace("/{z}/{y}/{x}.jpg", "/{TileMatrix}/{TileRow}/{TileCol}.jpg")
        .replace("/{z}/{y}/{x}.jpeg", "/{TileMatrix}/{TileRow}/{TileCol}.jpeg")
        .replace("/{z}/{y}/{x}.webp", "/{TileMatrix}/{TileRow}/{TileCol}.webp"),
      layer: layer.identifier,
      matrixSet: layer.matrix_set || layer.tile_matrix_set.identifier,
      format: layer.format || "image/png",
      requestEncoding: "REST",
      tileGrid,
      style: "default",
      wrapX: false,
      projection
    }),
    visible: true,
    opacity: 0.9
  });
}

export function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const activeLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const [payload, setPayload] = useState<LayersPayload | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [error, setError] = useState("");

  const selectedLayer = payload?.layers.find((layer) => layer.identifier === selectedLayerId);
  const selectedProjection = normalizeProjectionCode(selectedLayer?.crs ?? selectedLayer?.tile_matrix_set?.supported_crs);
  const selectedExtent =
    selectedLayer?.bounds.native && normalizeProjectionCode(selectedLayer.bounds.native.crs) === selectedProjection
      ? selectedLayer.bounds.native.extent
      : selectedLayer?.bounds.epsg4326;

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new Map({
      target: mapElementRef.current,
      controls: defaultControls({ zoom: true, rotate: false }),
      layers: [],
      view: new View({
        projection: DEFAULT_PROJECTION,
        center: [34.8, 31.8],
        zoom: 7
      })
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const nextPayload = await fetchLayers();
        nextPayload.layers = nextPayload.layers.filter(
          (layer) => layer.path.toLowerCase().endsWith(".gpkg") && !layer.path.toLowerCase().includes("sets/")
        );
        setPayload(nextPayload);
        setSelectedLayerId(nextPayload.layers[0]?.identifier ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load provider layers.");
      }
    })();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLayer) {
      return;
    }

    if (!getProjection(selectedProjection)) {
      setError(`OpenLayers does not have a registered projection for ${selectedProjection}.`);
      return;
    }

    setError("");

    if (activeLayerRef.current) {
      map.removeLayer(activeLayerRef.current);
      activeLayerRef.current = null;
    }

    map.setView(
      new View({
        projection: selectedProjection,
        center: [0, 0],
        zoom: selectedLayer.min_zoom ?? 0
      })
    );

    const nextLayer = buildTileLayer(selectedLayer, selectedProjection);
    map.addLayer(nextLayer);
    activeLayerRef.current = nextLayer;

    if (selectedExtent) {
      map.getView().fit(selectedExtent, {
        padding: [32, 32, 32, 32],
        duration: 250,
        maxZoom: selectedLayer.max_zoom ?? 12
      });
    } else if (selectedLayer.min_zoom !== undefined) {
      map.getView().setZoom(selectedLayer.min_zoom);
    }

    return () => {
      map.removeLayer(nextLayer);
    };
  }, [selectedExtent, selectedLayer, selectedProjection]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Map Provider</h1>
        <p className="subtitle">Available layers</p>

        {error ? <div className="message error">{error}</div> : null}

        <div className="layerList">
          {(payload?.layers ?? []).length ? (
            payload!.layers.map((layer) => (
              <button
                key={layer.identifier}
                type="button"
                className={`layerItem${layer.identifier === selectedLayerId ? " isActive" : ""}`}
                onClick={() => setSelectedLayerId(layer.identifier)}
              >
                <strong>{layer.name}</strong>
                <span>{layer.identifier}</span>
              </button>
            ))
          ) : (
            <div className="message">No published layers found.</div>
          )}
        </div>
      </aside>

      <main className="mapPanel">
        <div ref={mapElementRef} className="mapCanvas" />
      </main>
    </div>
  );
}
