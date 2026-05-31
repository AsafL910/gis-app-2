import useMapInitializer from "hooks/map/useMapInitializer";
import useHatTerrainLayer from "hooks/map/useHatTerrainLayer";
import DebugReadout from "map/DebugReadout";
import useAppSettingsStore from "state/stores/AppSettingsStore";
import useMapStore from "state/stores/MapStore";

function formatDtmName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() || pathOrName;
}

export function App() {
  const {
    error,
    layerExtent,
    loadingMessage,
    map,
    mapRef,
    selectedLayer,
    selectedProjection,
    selectedSet,
    selectedSetId,
    setSelectedSetId,
    sets,
    smoothedBrightness,
    terrainSet,
  } = useMapInitializer();
  const { hoverInfo, terrainAvailable, terrainLevel, setTerrainLevel } = useHatTerrainLayer({
    map,
    terrainSet,
    selectedProjection,
  });
  const { appSettings } = useAppSettingsStore();
  const { availableLayers, selectedLayerName, brightness, setMapLayerName, setBrightness } = useMapStore();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">External Client</p>
          <h1>Map Set + Terrain Overlay</h1>
          <p className="lede">
            This client now loads published map sets from `map-provider`, reads terrain RGB metadata from
            `hat-provider`, and shows hover elevation labels directly on the map.
          </p>
        </div>

        <section className="panel">
          <h2>Runtime</h2>
          <div className="meta">
            <div>Capabilities URL: {appSettings.MAP_URL}</div>
            <div>Environment: {appSettings.ENVIRONMENT}</div>
            <div>Station: {appSettings.STATION || "N/A"}</div>
            <div>Projection: {selectedProjection}</div>
          </div>
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="set-select">
            Open map set
          </label>
          <select
            id="set-select"
            className="select"
            value={selectedSetId}
            onChange={(event) => setSelectedSetId(event.target.value)}
          >
            <option value="__global__">Global catalog only</option>
            {sets.map((mapSet) => (
              <option key={mapSet.id} value={mapSet.id}>
                {mapSet.name}
              </option>
            ))}
          </select>

          <div className="meta">
            <div>Published sets: {sets.length}</div>
            <div>Current set: {selectedSet?.name ?? "Global catalog only"}</div>
          </div>
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="layer-select">
            WMTS layer
          </label>
          <select
            id="layer-select"
            className="select"
            value={selectedLayerName}
            onChange={(event) => setMapLayerName(event.target.value)}
            disabled={!availableLayers.length}
          >
            <option value="">Select a layer</option>
            {availableLayers.map((layerName) => (
              <option key={layerName} value={layerName}>
                {layerName}
              </option>
            ))}
          </select>

          <div className="meta">
            <div>Available layers: {availableLayers.length}</div>
            <div>Selected layer: {selectedLayerName || "None"}</div>
          </div>
        </section>

        <section className="panel">
          <h2>DTM Sources</h2>
          {selectedSet?.dtmLayers.length ? (
            <div className="list">
              {selectedSet.dtmLayers.map((layer) => (
                <div key={layer.id} className="listItem compact">
                  <strong>{layer.name}</strong>
                  <small>{layer.path}</small>
                </div>
              ))}
            </div>
          ) : terrainSet?.sources.length ? (
            <div className="list">
              {terrainSet.sources.map((source) => (
                <div key={source.path} className="listItem compact">
                  <strong>{formatDtmName(source.path)}</strong>
                  <small>{source.crs}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              No published DTM layers are available for the current selection.
            </div>
          )}
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="brightness-range">
            Base map brightness
          </label>
          <input
            id="brightness-range"
            className="range"
            type="range"
            min="0"
            max="200"
            step="5"
            value={brightness}
            onChange={(event) => setBrightness(Number(event.target.value))}
          />

          <div className="meta">
            <div>Brightness: {brightness}</div>
            <div>Debounced brightness: {smoothedBrightness}</div>
          </div>
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="terrain-level">
            Terrain threshold
          </label>
          <input
            id="terrain-level"
            className="range"
            type="range"
            min="0"
            max="1000"
            step="10"
            value={terrainLevel}
            onChange={(event) => setTerrainLevel(Number(event.target.value))}
            disabled={!terrainAvailable}
          />

          <div className="meta">
            <div>Threshold: {terrainLevel.toFixed(0)} m</div>
            <div>Terrain overlay: {terrainAvailable ? "Active" : "Unavailable"}</div>
            <div>Hover elevation: {hoverInfo ? `${hoverInfo.elevation.toFixed(1)} m` : "Move over terrain"}</div>
          </div>
        </section>

        {loadingMessage ? <div className="banner">{loadingMessage}</div> : null}
        {error ? <div className="banner error">{error}</div> : null}
      </aside>

      <main className="stage">
        <div className="stageHeader">
          <div>
            <p className="eyebrow">OpenLayers view</p>
            <h2>{selectedSet?.name ?? selectedLayerName ?? "Waiting for layers"}</h2>
          </div>
          <div className="badges">
            <span className="badge">{availableLayers.length} layers</span>
            <span className="badge">{terrainAvailable ? "Terrain ready" : "Map only"}</span>
            <span className="badge">Projection {selectedProjection}</span>
          </div>
        </div>

        <div className="mapWrap">
          <DebugReadout map={map} projection={selectedProjection} />
          {hoverInfo ? (
            <div
              className="tooltip"
              style={{
                left: hoverInfo.pixel[0] + 8,
                top: hoverInfo.pixel[1] - 12,
              }}
            >
              <strong>{hoverInfo.elevation.toFixed(1)} m</strong>
            </div>
          ) : null}
          <div ref={mapRef} className="mapCanvas" tabIndex={0} />
        </div>
      </main>
    </div>
  );
}
