import { useEffect, useState } from "react";

import type { Map as OLMap } from "ol";
import { toLonLat } from "ol/proj";

type DebugReadoutProps = {
  map: OLMap | null;
  projection: string;
};

type DebugState = {
  lon: number;
  lat: number;
  zoom: number;
};

export default function DebugReadout({ map, projection }: DebugReadoutProps) {
  const [debugState, setDebugState] = useState<DebugState>({
    lon: 0,
    lat: 0,
    zoom: 0,
  });

  useEffect(() => {
    if (!map) {
      return;
    }

    const updateZoom = () => {
      setDebugState((current) => ({
        ...current,
        zoom: map.getView().getZoom() ?? 0,
      }));
    };

    const handlePointerMove = (event: { coordinate: [number, number] }) => {
      const [lon, lat] = toLonLat(event.coordinate, projection);
      setDebugState({
        lon,
        lat,
        zoom: map.getView().getZoom() ?? 0,
      });
    };

    updateZoom();
    map.on("pointermove", handlePointerMove);
    map.getView().on("change:resolution", updateZoom);

    return () => {
      map.un("pointermove", handlePointerMove);
      map.getView().un("change:resolution", updateZoom);
    };
  }, [map, projection]);

  return (
    <div className="debugReadout">
      <div>Lon: {debugState.lon.toFixed(6)}</div>
      <div>Lat: {debugState.lat.toFixed(6)}</div>
      <div>Zoom: {debugState.zoom.toFixed(3)}</div>
      <div>Projection: {projection}</div>
    </div>
  );
}
