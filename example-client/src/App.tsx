import useMapInitializer from "hooks/map/useMapInitializer";
import useAppSettingsStore from "state/stores/AppSettingsStore";
import useMapStore from "state/stores/MapStore";

export function App() {
  const { mapRef, smoothedBrightness, selectedProjection } = useMapInitializer();
  const { appSettings } = useAppSettingsStore();
  const { availableLayers, selectedLayerName, brightness, setMapLayerName, setBrightness } = useMapStore();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">Exact Client Repro</p>
          <h1>Real `useMapInitializer` Hook</h1>
          <p className="lede">
            This example mounts the same hook logic you shared so we can debug the WMTS capability parsing and tile
            linking behavior without a simplified client in the way.
          </p>
        </div>

        <section className="panel">
          <h2>Runtime</h2>
          <div className="meta">
            <div>Capabilities URL: {appSettings.MAP_URL}</div>
            <div>Environment: {appSettings.ENVIRONMENT}</div>
            <div>Station: {appSettings.STATION || "N/A"}</div>
          </div>
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="layer-select">
            Selected layer name
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
            <div>Current selected layer title: {selectedLayerName || "(empty string)"}</div>
          </div>
        </section>

        <section className="panel">
          <label className="fieldLabel" htmlFor="brightness-range">
            Brightness
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
          <h2>Why This Repro Helps</h2>
          <div className="list">
            <div className="listItem compact">
              <strong>Provider metadata driven</strong>
              <small>The hook now consumes the provider&apos;s published tile matrix metadata directly.</small>
            </div>
            <div className="listItem compact">
              <strong>Same selection source</strong>
              <small>The dropdown still uses the published layer names from the runtime payload.</small>
            </div>
            <div className="listItem compact">
              <strong>Same WMTS construction</strong>
              <small>
                The displayed map layer is created from <code>new WMTS(&#123; ...publishedMetadata &#125;)</code> inside
                the hook.
              </small>
            </div>
          </div>
        </section>
      </aside>

      <main className="stage">
        <div className="stageHeader">
          <div>
            <p className="eyebrow">OpenLayers view</p>
            <h2>{selectedLayerName || "Waiting for capabilities"}</h2>
          </div>
          <div className="badges">
            <span className="badge">{availableLayers.length} titles loaded</span>
            <span className="badge">Projection {selectedProjection}</span>
          </div>
        </div>

        <div className="mapWrap">
          <div ref={mapRef} className="mapCanvas" tabIndex={0} />
        </div>
      </main>
    </div>
  );
}
