import { useEffect, useMemo, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import WMTS from "ol/source/WMTS";
import XYZ from "ol/source/XYZ";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import TileGrid from "ol/tilegrid/TileGrid";
import { defaults as defaultControls } from "ol/control";
import { getCenter } from "ol/extent";
import { fetchAllLayers, fetchHatSet, fetchLayersForSet, fetchSets, resolveHatProviderUrl, resolveMapProviderUrl } from "./api";
import type { CatalogSet, HatSetPayload, LayerPayload, LayersPayload, SetsPayload } from "./types";

const TILE_RESOLUTIONS = Array.from({ length: 23 }, (_, zoom) => 360 / 256 / 2 ** zoom);
const HAT_TILE_RESOLUTIONS = Array.from({ length: 23 }, (_, zoom) => 360 / 256 / 2 ** zoom);
const WMTS_GRID_4326 = new WMTSTileGrid({
  extent: [-180, -180, 180, 180],
  origin: [-180, 180],
  resolutions: TILE_RESOLUTIONS,
  matrixIds: Array.from({ length: 23 }, (_, zoom) => `${zoom}`),
  tileSize: [256, 256]
});
const HAT_GRID_4326 = new TileGrid({
  origin: [-180, 270],
  resolutions: HAT_TILE_RESOLUTIONS,
  tileSize: [256, 256]
});

function decodeTerrainElevation(data: Uint8Array | Uint8ClampedArray | number[]): number {
  const [red, green, blue] = data;
  return red * 256 * 256 * 0.1 + green * 256 * 0.1 + blue * 0.1 - 10000;
}

function buildTerrainStyle(level: number) {
  const elevation = [
    "+",
    -10000,
    ["*", 0.1 * 255 * 256 * 256, ["band", 1]],
    ["*", 0.1 * 255 * 256, ["band", 2]],
    ["*", 0.1 * 255, ["band", 3]]
  ] as const;

  return {
    color: [
      "case",
      ["==", ["band", 4], 0],
      [0, 0, 0, 0],
      ["<=", ["-", level, elevation], 100],
      [255, 0, 0, 1],
      ["between", ["-", level, elevation], 100, 250],
      [255, 255, 0, 1],
      [">=", ["-", level, elevation], 400],
      [0, 255, 0, 1],
      [0, 0, 0, 0]
    ]
  } as const;
}

function buildWmtsLayer(layer: LayerPayload): TileLayer<WMTS> {
  return new TileLayer({
    source: new WMTS({
      url: resolveMapProviderUrl(layer.rest_tile_url.replace("/{z}/{y}/{x}.png", "/{TileMatrix}/{TileRow}/{TileCol}.png")),
      layer: layer.identifier,
      matrixSet: "EPSG4326",
      format: "image/png",
      requestEncoding: "REST",
      tileGrid: WMTS_GRID_4326,
      style: "default",
      crossOrigin: "anonymous"
    }),
    opacity: 0.95
  });
}

function buildTerrainLayer(hatSet: HatSetPayload): WebGLTileLayer<XYZ> {
  return new WebGLTileLayer({
    opacity: 0.3,
    source: new XYZ({
      url: resolveHatProviderUrl(hatSet.tileUrlTemplate4326),
      projection: "EPSG:4326",
      tileGrid: HAT_GRID_4326,
      tileSize: hatSet.tileSize,
      minZoom: 5,
      maxZoom: 15,
      crossOrigin: "anonymous",
      transition: 0
    }),
    style: buildTerrainStyle(0)
  });
}

function formatResolution(value: number): string {
  if (value >= 1) {
    return `${value.toFixed(4)} deg/pixel`;
  }

  return `${value.toPrecision(3)} deg/pixel`;
}

export function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const wmtsLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const terrainLayerRef = useRef<WebGLTileLayer<XYZ> | null>(null);
  const [setsPayload, setSetsPayload] = useState<SetsPayload | null>(null);
  const [layersPayload, setLayersPayload] = useState<LayersPayload | null>(null);
  const [hatSet, setHatSet] = useState<HatSetPayload | null>(null);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [level, setLevel] = useState(0);
  const [terrainVisible, setTerrainVisible] = useState(true);
  const [wmtsVisible, setWmtsVisible] = useState(true);
  const [error, setError] = useState("");
  const [dtmHeight, setDtmHeight] = useState<number | null>(null);
  const [labelLocation, setLabelLocation] = useState<[number, number] | null>(null);

  const selectedSet = useMemo<CatalogSet | null>(
    () => setsPayload?.sets.find((item) => item.id === selectedSetId) ?? null,
    [selectedSetId, setsPayload]
  );
  const selectedLayer = useMemo<LayerPayload | null>(
    () => layersPayload?.layers.find((item) => item.identifier === selectedLayerId) ?? null,
    [layersPayload, selectedLayerId]
  );

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
        center: [35, 32],
        zoom: 7,
        minZoom: 5,
        maxZoom: 15
      })
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await fetchSets();
        setSetsPayload(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load map sets.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedSetId) {
      setError("");
      setHatSet(null);
      void (async () => {
        try {
          const nextLayers = await fetchAllLayers();
          setLayersPayload(nextLayers);
          setSelectedLayerId((current) => {
            if (current && nextLayers.layers.some((layer) => layer.identifier === current)) {
              return current;
            }
            return nextLayers.layers[0]?.identifier ?? "";
          });
        } catch (loadError) {
          setLayersPayload(null);
          setSelectedLayerId("");
          setError(loadError instanceof Error ? loadError.message : "Unable to load global layers.");
        }
      })();
      return;
    }

    setError("");
    void (async () => {
      try {
        const [nextLayers, nextHatSet] = await Promise.all([
          fetchLayersForSet(selectedSetId),
          fetchHatSet(selectedSetId)
        ]);
        setLayersPayload(nextLayers);
        setHatSet(nextHatSet);
        setSelectedLayerId((current) => {
          if (current && nextLayers.layers.some((layer) => layer.identifier === current)) {
            return current;
          }
          return nextLayers.layers[0]?.identifier ?? "";
        });
      } catch (loadError) {
        setLayersPayload(null);
        setHatSet(null);
        setSelectedLayerId("");
        setError(loadError instanceof Error ? loadError.message : "Unable to load selected set.");
      }
    })();
  }, [selectedSetId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (wmtsLayerRef.current) {
      map.removeLayer(wmtsLayerRef.current);
      wmtsLayerRef.current = null;
    }

    if (!selectedLayer) {
      return;
    }

    const nextLayer = buildWmtsLayer(selectedLayer);
    nextLayer.setVisible(wmtsVisible);
    map.addLayer(nextLayer);
    wmtsLayerRef.current = nextLayer;

    const bounds = selectedLayer.bounds.epsg4326;
    if (bounds) {
      map.getView().fit(bounds, {
        padding: [48, 48, 48, 48],
        duration: 250,
        maxZoom: 12
      });
    }
  }, [selectedLayer, wmtsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (terrainLayerRef.current) {
      map.removeLayer(terrainLayerRef.current);
      terrainLayerRef.current = null;
    }

    if (!hatSet) {
      return;
    }

    const nextLayer = buildTerrainLayer(hatSet);
    nextLayer.setVisible(terrainVisible);
    map.addLayer(nextLayer);
    terrainLayerRef.current = nextLayer;
  }, [hatSet, terrainVisible]);

  useEffect(() => {
    terrainLayerRef.current?.setStyle(buildTerrainStyle(level));
  }, [level, hatSet]);

  useEffect(() => {
    wmtsLayerRef.current?.setVisible(wmtsVisible);
  }, [wmtsVisible]);

  useEffect(() => {
    terrainLayerRef.current?.setVisible(terrainVisible);
  }, [terrainVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handlePointerMove = (event: { pixel: [number, number] }) => {
      const terrainLayer = terrainLayerRef.current;
      if (!terrainLayer || !terrainVisible) {
        setDtmHeight(null);
        setLabelLocation(null);
        return;
      }

      const data = terrainLayer.getData(event.pixel);
      if (!data || data.length < 3 || ("3" in data && data[3] === 0)) {
        setDtmHeight(null);
        setLabelLocation(null);
        return;
      }

      setDtmHeight(decodeTerrainElevation([data[0], data[1], data[2]]));
      setLabelLocation([event.pixel[0], event.pixel[1]]);
    };

    map.on("pointermove", handlePointerMove);
    return () => {
      map.un("pointermove", handlePointerMove);
    };
  }, [terrainVisible]);

  const mapCenter = selectedLayer?.bounds.epsg4326 ? getCenter(selectedLayer.bounds.epsg4326) : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">Standalone Client Example</p>
          <h1>WMTS + Terrain RGB Demo</h1>
          <p className="lede">
            This app behaves like an external client: it discovers map sets from <code>map-provider</code>, renders the
            chosen WMTS layer, and when a set is selected it overlays decoded terrain RGB from <code>hat-provider</code>.
          </p>
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        <section className="panel">
          <label className="fieldLabel" htmlFor="set-select">
            Map set
          </label>
          <select
            id="set-select"
            className="select"
            value={selectedSetId}
            onChange={(event) => setSelectedSetId(event.target.value)}
          >
            <option value="">No set selected (show all maps)</option>
            {(setsPayload?.sets ?? []).map((mapSet) => (
              <option key={mapSet.id} value={mapSet.id}>
                {mapSet.name}
              </option>
            ))}
          </select>

          {selectedSet ? (
            <div className="meta">
              <div>Set id: {selectedSet.id}</div>
              <div>Maps: {selectedSet.maps.length}</div>
              <div>DTMs: {selectedSet.dtmLayers.length}</div>
              <div>VRT: {selectedSet.vrtPath}</div>
            </div>
          ) : (
            <div className="meta">
              <div>Mode: global map catalog</div>
              <div>Terrain overlay: unavailable without a set</div>
            </div>
          )}
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="layer-select">
            WMTS layer
          </label>
          <select
            id="layer-select"
            className="select"
            value={selectedLayerId}
            onChange={(event) => setSelectedLayerId(event.target.value)}
            disabled={!layersPayload?.layers.length}
          >
            <option value="">Select a layer</option>
            {(layersPayload?.layers ?? []).map((layer) => (
              <option key={layer.identifier} value={layer.identifier}>
                {layer.name}
              </option>
            ))}
          </select>

          <div className="toggleRow">
            <label className="checkboxRow">
              <input type="checkbox" checked={wmtsVisible} onChange={(event) => setWmtsVisible(event.target.checked)} />
              <span>Show WMTS map</span>
            </label>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={terrainVisible && Boolean(selectedSetId)}
                disabled={!selectedSetId}
                onChange={(event) => setTerrainVisible(event.target.checked)}
              />
              <span>Show terrain RGB</span>
            </label>
          </div>

          {selectedLayer ? (
            <div className="meta">
              <div>Layer: {selectedLayer.identifier}</div>
              <div>Capabilities: {resolveMapProviderUrl(layersPayload?.service.capabilities_url ?? "")}</div>
              <div>REST tile: {resolveMapProviderUrl(selectedLayer.rest_tile_url)}</div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="level-range">
            Relative terrain level
          </label>
          <input
            id="level-range"
            className="range"
            type="range"
            min="0"
            max="1000"
            step="10"
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
          />
          <div className="meta">
            <div>Level: {level} m</div>
            <div>Encoding: {hatSet?.encodingFormula ?? "N/A without a selected set"}</div>
            <div>Hat tile: {hatSet ? resolveHatProviderUrl(hatSet.tileUrlTemplate4326) : "Unavailable in global mode"}</div>
          </div>
        </section>

        <section className="panel">
          <h2>Terrain sources</h2>
          <div className="list">
            {hatSet?.sources.length ? (
              hatSet.sources.map((source) => (
                <div key={source.path} className="listItem compact">
                  <strong>{source.crs}</strong>
                  <small>{source.path}</small>
                  <small>{formatResolution(source.resolution)}</small>
                </div>
              ))
            ) : (
              <div className="empty">No terrain sources were reported for this set yet.</div>
            )}
          </div>
        </section>

        {layersPayload?.skipped_layers.length ? (
          <section className="panel">
            <h2>Skipped map assets</h2>
            <div className="list">
              {layersPayload.skipped_layers.map((layer) => (
                <div key={`${layer.identifier}-${layer.path}`} className="listItem warning">
                  <strong>{layer.name}</strong>
                  <small>{layer.reason}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </aside>

      <main className="stage">
        <div className="stageHeader">
          <div>
            <p className="eyebrow">OpenLayers view</p>
            <h2>{selectedSet?.name ?? "Choose a map set"}</h2>
          </div>
          <div className="badges">
            <span className="badge">{selectedLayer?.identifier ?? "No WMTS layer selected"}</span>
            <span className="badge">{selectedSetId ? `${hatSet?.sources.length ?? 0} terrain sources` : "Global maps only"}</span>
            <span className="badge">{mapCenter ? `${mapCenter[0].toFixed(3)}, ${mapCenter[1].toFixed(3)}` : "No bounds"}</span>
          </div>
        </div>

        <div className="mapWrap">
          {labelLocation && dtmHeight !== null ? (
            <div
              className="tooltip"
              style={{
                left: `${labelLocation[0] + 5}px`,
                top: `${labelLocation[1] - 5}px`
              }}
            >
              <strong>{dtmHeight.toFixed(0)}</strong>
            </div>
          ) : null}
          <div ref={mapElementRef} className="mapCanvas" />
        </div>
      </main>
    </div>
  );
}
