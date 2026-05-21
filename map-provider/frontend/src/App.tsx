import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import WMTS from "ol/source/WMTS";
import XYZ from "ol/source/XYZ";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { defaults as defaultControls } from "ol/control";
import type { LayerPayload, LayersPayload } from "./types";
import { fetchLayers } from "./api";

function formatBytes(size: number): string {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

function buildTileLayer(layer: LayerPayload): TileLayer<WMTS> {
  const tileGrid = new WMTSTileGrid({
    origin: [-180, 90],
    resolutions: Array.from({ length: 23 }, (_, zoom) => 180 / 256 / 2 ** zoom),
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
    opacity: 0.82
  });
}

export function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const dynamicLayersRef = useRef<TileLayer<WMTS>[]>([]);
  const [payload, setPayload] = useState<LayersPayload | null>(null);
  const [selectedLayerName, setSelectedLayerName] = useState("");
  const [enabledLayerIds, setEnabledLayerIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new Map({
      target: mapElementRef.current,
      controls: defaultControls({ zoom: true, rotate: false }),
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          }),
          opacity: 1
        })
      ],
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
        setPayload(nextPayload);
        const firstLayer = nextPayload.layers[0]?.identifier ?? "";
        setSelectedLayerName(firstLayer);
        setEnabledLayerIds(firstLayer ? [firstLayer] : []);
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

    dynamicLayersRef.current.forEach((layer) => map.removeLayer(layer));
    dynamicLayersRef.current = [];

    const activeLayers = (payload?.layers ?? []).filter((layer) => enabledLayerIds.includes(layer.identifier));
    const tileLayers = activeLayers.map(buildTileLayer);
    tileLayers.forEach((layer) => map.addLayer(layer));
    dynamicLayersRef.current = tileLayers;
  }, [enabledLayerIds, payload]);

  const selectedLayer = payload?.layers.find((layer) => layer.identifier === selectedLayerName) ?? null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Map Provider</p>
          <h1>Global WMTS demo</h1>
          <p className="lede">
            This provider publishes globally addressable EPSG:4326 layers. No set id is required once the layer name is known.
          </p>
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        <section className="panel">
          <label className="fieldLabel" htmlFor="layer-select">
            Active layer
          </label>
          <select
            id="layer-select"
            className="select"
            value={selectedLayerName}
            onChange={(event) => {
              const nextIdentifier = event.target.value;
              setSelectedLayerName(nextIdentifier);
              setEnabledLayerIds(nextIdentifier ? [nextIdentifier] : []);
            }}
          >
            <option value="">Select a layer</option>
            {(payload?.layers ?? []).map((layer) => (
              <option key={layer.identifier} value={layer.identifier}>
                {layer.name}
              </option>
            ))}
          </select>

          {selectedLayer ? (
            <div className="meta">
              <div>Layer: {selectedLayer.name}</div>
              <div>File: {selectedLayer.path}</div>
              <div>Capabilities: {payload?.service.capabilities_url}</div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <h2>Published maps</h2>
          <div className="list">
            {(payload?.layers ?? []).length ? (
              payload!.layers.map((layer) => (
                <div key={layer.identifier} className="listItem">
                  <label className="checkboxRow">
                    <input
                      type="checkbox"
                      checked={enabledLayerIds.includes(layer.identifier)}
                      onChange={(event) => {
                        setSelectedLayerName(layer.identifier);
                        setEnabledLayerIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, layer.identifier])]
                            : current.filter((value) => value !== layer.identifier)
                        );
                      }}
                    />
                    <span>{layer.name}</span>
                  </label>
                  <small>
                    {layer.path}
                  </small>
                </div>
              ))
            ) : (
              <div className="empty">No WMTS-ready layers were published yet.</div>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Provider status</h2>
          <div className="list">
            {(payload?.layers ?? []).map((layer) => (
              <div key={layer.identifier} className="listItem compact">
                <strong>{layer.name}</strong>
                <small>{layer.path}</small>
              </div>
            ))}
            {(payload?.skipped_layers ?? []).map((layer) => (
              <div key={`${layer.identifier}-${layer.path}`} className="listItem warning">
                <strong>{layer.name}</strong>
                <small>{layer.reason}</small>
              </div>
            ))}
            {!payload?.layers.length && !payload?.skipped_layers.length ? (
              <div className="empty">No layers discovered yet.</div>
            ) : null}
          </div>
        </section>

        {selectedLayer ? (
          <section className="panel">
            <h2>Client-facing contract</h2>
            <div className="list">
              <div className="listItem compact">
                <strong>Capabilities</strong>
                <small>{payload?.service.capabilities_url}</small>
              </div>
              <div className="listItem compact">
                <strong>Layer name</strong>
                <small>{selectedLayer.identifier}</small>
              </div>
              <div className="listItem compact">
                <strong>Tile mode</strong>
                <small>{selectedLayer.source_modes.join(", ")}</small>
              </div>
            </div>
          </section>
        ) : null}
      </aside>

      <main className="stage">
        <div className="stageHeader">
          <div>
            <p className="eyebrow">OpenLayers preview</p>
            <h2>{selectedLayer?.name ?? "Choose a layer"}</h2>
          </div>
          <div className="badges">
            <span className="badge">EPSG:4326 only</span>
            <span className="badge">{payload?.layers.length ?? 0} published layers</span>
          </div>
        </div>
        <div ref={mapElementRef} className="mapCanvas" />
      </main>
    </div>
  );
}
