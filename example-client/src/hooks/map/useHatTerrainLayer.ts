import { useEffect, useRef, useState } from "react";

import type { HatSetPayload } from "../../types";

import { resolveHatProviderUrl } from "../../api";
import type { Map as OLMap } from "ol";
import WebGLTileLayer from "ol/layer/WebGLTile";
import XYZ from "ol/source/XYZ";
import TileGrid from "ol/tilegrid/TileGrid";

import { MAP_TILE_LAYER_ZINDEX } from "map/mapLayers/MapLayersIndexes";

const DEFAULT_PROJECTION = "EPSG:4326";
const DEFAULT_MIN_ZOOM = 5;
const DEFAULT_MAX_ZOOM = 15;
const TERRAIN_ORIGIN: [number, number] = [-180, 270];
const TERRAIN_RESOLUTIONS = [
  1.40625,
  0.703125,
  0.3515625,
  0.17578125,
  0.087890625,
  0.0439453125,
  0.02197265625,
  0.010986328125,
  0.0054931640625,
  0.00274658203125,
  0.001373291015625,
  0.0006866455078125,
];

export type HoverInfo = {
  elevation: number;
  pixel: [number, number];
};

function buildTerrainStyle(level: number) {
  const elevation = [
    "+",
    -10000,
    ["*", 0.1 * 255 * 256 * 256, ["band", 1]],
    ["*", 0.1 * 255 * 256, ["band", 2]],
    ["*", 0.1 * 255, ["band", 3]],
  ];

  return {
    color: [
      "case",
      ["<=", ["-", level, elevation], 100],
      [255, 0, 0, 0.95],
      ["between", ["-", level, elevation], 100, 250],
      [255, 214, 10, 0.92],
      [">=", ["-", level, elevation], 400],
      [58, 211, 138, 0.9],
      [0, 0, 0, 0],
    ],
  };
}

export default function useHatTerrainLayer({
  map,
  terrainSet,
  selectedProjection,
}: {
  map: OLMap | null;
  terrainSet: HatSetPayload | null;
  selectedProjection: string;
}) {
  const terrainLayerRef = useRef<WebGLTileLayer | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [terrainLevel, setTerrainLevel] = useState<number>(0);

  useEffect(() => {
    if (!map) {
      return;
    }

    if (terrainLayerRef.current) {
      map.removeLayer(terrainLayerRef.current);
      terrainLayerRef.current = null;
    }

    if (!terrainSet || selectedProjection !== DEFAULT_PROJECTION) {
      return;
    }

    const terrainLayer = new WebGLTileLayer({
      zIndex: MAP_TILE_LAYER_ZINDEX + 1,
      opacity: 0.38,
      style: buildTerrainStyle(terrainLevel),
      source: new XYZ({
        url: resolveHatProviderUrl(terrainSet.tileUrlTemplate4326),
        tileSize: terrainSet.tileSize,
        minZoom: DEFAULT_MIN_ZOOM,
        maxZoom: DEFAULT_MAX_ZOOM,
        projection: selectedProjection,
        transition: 0,
        zDirection: 1,
        tileGrid: new TileGrid({
          origin: TERRAIN_ORIGIN,
          resolutions: TERRAIN_RESOLUTIONS,
          tileSize: [terrainSet.tileSize, terrainSet.tileSize],
        }),
      }),
    });

    terrainLayerRef.current = terrainLayer;
    map.addLayer(terrainLayer);

    return () => {
      if (terrainLayerRef.current === terrainLayer) {
        map.removeLayer(terrainLayer);
        terrainLayerRef.current = null;
      }
    };
  }, [map, selectedProjection, terrainSet]);

  useEffect(() => {
    terrainLayerRef.current?.setStyle(buildTerrainStyle(terrainLevel));
  }, [terrainLevel]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const handleMove = (event: { pixel: [number, number]; dragging?: boolean }) => {
      if (event.dragging) {
        return;
      }

      const data = terrainLayerRef.current?.getData(event.pixel);
      if (!data || data.length < 4 || data[3] === 0) {
        setHoverInfo(null);
        return;
      }

      const elevation = data[0] * 256 * 256 * 0.1 + data[1] * 256 * 0.1 + data[2] * 0.1 - 10000;
      setHoverInfo({
        elevation,
        pixel: [event.pixel[0], event.pixel[1]],
      });
    };

    const handleLeave = () => {
      setHoverInfo(null);
    };

    map.on("pointermove", handleMove);
    map.getViewport().addEventListener("pointerleave", handleLeave);

    return () => {
      map.un("pointermove", handleMove);
      map.getViewport().removeEventListener("pointerleave", handleLeave);
    };
  }, [map]);

  return {
    hoverInfo,
    terrainAvailable: Boolean(terrainSet && selectedProjection === DEFAULT_PROJECTION),
    terrainLevel,
    setTerrainLevel,
  };
}
