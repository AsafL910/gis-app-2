import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import WMTS from "ol/source/WMTS";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { defaults as defaultControls } from "ol/control";
import type { LayerPayload, LayersPayload } from "./types";
import { fetchLayers } from "./api";

function buildTileLayer(layer: LayerPayload): TileLayer<WMTS> {
  const tileGrid = new WMTSTileGrid({
    origin: [-180, 180],
    resolutions: Array.from({ length: 23 }, (_, zoom) => 360 / 256 / 2 ** zoom),
    matrixIds: Array.from({ length: 23 }, (_, zoom) => `${zoom}`)
  });

  return new TileLayer({
    source: new WMTS({
      url: layer.rest_tile_url.replace("/{z}/{y}/{x}.png", "/{TileMatrix}/{TileRow}/{TileCol}.png"),
      layer: layer.identifier,
      matrixSet: "EPSG4326",
      format: "image/png",
      requestEncoding: "REST",
      tileGrid,
      style: "default"
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

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new Map({
      target: mapElementRef.current,
      controls: defaultControls({ zoom: true, rotate: false }),
      layers: [],
      view: new View({
        projection: "EPSG:4326",
        center: [34.8, 31.8],
        zoom: 7
      })
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const nextPayload = await fetchLayers();
        nextPayload.layers = nextPayload.layers.filter((layer) => layer.path.toLowerCase().endsWith(".gpkg") && !layer.path.toLowerCase().includes("sets/"));
        setPayload(nextPayload);
        setSelectedLayerId(nextPayload.layers[0]?.identifier ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load provider layers.");
      }
    })();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (activeLayerRef.current) {
      map.removeLayer(activeLayerRef.current);
      activeLayerRef.current = null;
    }

    const selectedLayer = payload?.layers.find((layer) => layer.identifier === selectedLayerId);
    if (!selectedLayer) {
      return;
    }

    const nextLayer = buildTileLayer(selectedLayer);
    map.addLayer(nextLayer);
    activeLayerRef.current = nextLayer;

    const bounds = selectedLayer.bounds.epsg4326;
    if (bounds) {
      map.getView().fit(bounds, {
        padding: [32, 32, 32, 32],
        duration: 250,
        maxZoom: 12
      });
    }
  }, [payload, selectedLayerId]);

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
