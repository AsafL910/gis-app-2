import { useEffect, useMemo, useRef, useState } from "react";

import useMapStore from "state/stores/MapStore";
import type { CatalogSet, HatSetPayload, LayerPayload } from "../../types";

import { DEFAULT_MAP_POSITION, useMap } from "hooks/map/useMap";

import { fetchAllLayers, fetchHatSet, fetchLayersForSet, fetchSets, resolveMapProviderUrl } from "../../api";
import { Map as OLMap, View } from "ol";
import * as ol from "ol";
import { defaults as defaultInteractions } from "ol/interaction";
import TileLayer from "ol/layer/Tile";
import { get as getProjection } from "ol/proj";
import WMTS from "ol/source/WMTS";
import WMTSTileGrid from "ol/tilegrid/WMTS";

import { DEFAULT_MAP_BRIGHTNESS } from "commonUtils/MapUtils";

import useDebounce from "hooks/useDebounce";
import useAppSettingsStore from "state/stores/AppSettingsStore";
import { MAP_TILE_LAYER_ZINDEX } from "map/mapLayers/MapLayersIndexes";

const DEFAULT_PROJECTION = "EPSG:4326";
const GLOBAL_SET_ID = "__global__";
const DEFAULT_MIN_ZOOM = 5;

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

function buildTileGrid(layer: LayerPayload) {
  const matrices = layer.tile_matrices ?? [];
  if (!matrices.length || !layer.tile_matrix_set) {
    throw new Error(`Layer "${layer.identifier}" is missing tile matrix metadata.`);
  }

  return new WMTSTileGrid({
    origin: layer.tile_matrix_set.top_left_corner,
    resolutions: matrices.map((matrix) => matrix.pixel_x_size),
    matrixIds: matrices.map((matrix) => matrix.identifier),
    sizes: matrices.map((matrix) => [matrix.matrix_width, matrix.matrix_height]),
    tileSizes: matrices.map((matrix) => [matrix.tile_width, matrix.tile_height]),
  });
}

const useMapInitializer = () => {
  const { appSettings } = useAppSettingsStore();
  const { map, setMap } = useMap();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const [sets, setSets] = useState<CatalogSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>(GLOBAL_SET_ID);
  const [layers, setLayers] = useState<LayerPayload[]>([]);
  const [terrainSet, setTerrainSet] = useState<HatSetPayload | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>("Loading published layers...");
  const [error, setError] = useState<string>("");
  const { selectedLayerId, brightness, setAvailableLayers, setMapLayerId } = useMapStore();

  const smoothedBrightness = useDebounce(brightness, 200);
  const selectedSet = useMemo(() => sets.find((item) => item.id === selectedSetId) ?? null, [selectedSetId, sets]);
  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.identifier === selectedLayerId) ?? layers[0] ?? null,
    [layers, selectedLayerId],
  );
  const selectedProjection = useMemo(
    () => normalizeProjectionCode(selectedLayer?.crs ?? selectedLayer?.tile_matrix_set?.supported_crs),
    [selectedLayer],
  );
  const layerExtent = useMemo(() => {
    if (!selectedLayer) {
      return undefined;
    }

    return selectedLayer.bounds?.native && normalizeProjectionCode(selectedLayer.bounds.native.crs) === selectedProjection
      ? selectedLayer.bounds.native.extent
      : selectedLayer.bounds?.epsg4326;
  }, [selectedLayer, selectedProjection]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const initMap = new OLMap({
      target: mapRef.current,
      view: new View({
        projection: DEFAULT_PROJECTION,
        center: DEFAULT_MAP_POSITION,
        zoom: 10,
        minZoom: DEFAULT_MIN_ZOOM,
        showFullExtent: true,
      }),
      controls: [],
      layers: [],
      interactions: defaultInteractions({ doubleClickZoom: false }),
      moveTolerance: 50,
      maxTilesLoading: 6,
    });

    setMap(initMap);
    mapRef.current.focus();

    if (appSettings.ENVIRONMENT === "Developement") {
      window._map = initMap;
      window.ol = ol;
    }

    return () => {
      mapLayerRef.current = null;
      initMap.setTarget(undefined);
      setMap(null);
    };
  }, [appSettings.ENVIRONMENT, setMap]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await fetchSets();
        if (cancelled) {
          return;
        }

        setSets(payload.sets);
        setSelectedSetId((current) => {
          if (current !== GLOBAL_SET_ID && payload.sets.some((item) => item.id === current)) {
            return current;
          }

          return payload.sets[0]?.id ?? GLOBAL_SET_ID;
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load map sets.");
          setSets([]);
          setSelectedSetId(GLOBAL_SET_ID);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError("");
      setLoadingMessage(
        selectedSetId === GLOBAL_SET_ID
          ? "Loading global map catalog..."
          : `Loading map set "${selectedSet?.name ?? selectedSetId}"...`,
      );

      try {
        if (selectedSetId === GLOBAL_SET_ID) {
          const payload = await fetchAllLayers();
          if (cancelled) {
            return;
          }

          const nextLayers = payload.layers ?? [];
          setLayers(nextLayers);
          setTerrainSet(null);
          setAvailableLayers(nextLayers.map((layer) => ({ id: layer.identifier, label: `${layer.name} - ${layer.path}` })));
          setMapLayerId(
            nextLayers.some((layer) => layer.identifier === selectedLayerId)
              ? selectedLayerId
              : (nextLayers[0]?.identifier ?? ""),
          );
          setLoadingMessage("");
          return;
        }

        const [layersResult, terrainResult] = await Promise.allSettled([
          fetchLayersForSet(selectedSetId),
          fetchHatSet(selectedSetId),
        ]);

        if (cancelled) {
          return;
        }

        if (layersResult.status === "rejected") {
          throw layersResult.reason;
        }

        const nextLayers = layersResult.value.layers ?? [];
        setLayers(nextLayers);
        setAvailableLayers(nextLayers.map((layer) => ({ id: layer.identifier, label: `${layer.name} - ${layer.path}` })));
        setMapLayerId(
          nextLayers.some((layer) => layer.identifier === selectedLayerId)
            ? selectedLayerId
            : (nextLayers[0]?.identifier ?? ""),
        );

        if (terrainResult.status === "fulfilled") {
          setTerrainSet(terrainResult.value);
        } else {
          setTerrainSet(null);
          setError(
            terrainResult.reason instanceof Error
              ? terrainResult.reason.message
              : `Terrain overlay is unavailable for set "${selectedSet?.name ?? selectedSetId}".`,
          );
        }

        setLoadingMessage("");
      } catch (loadError) {
        if (!cancelled) {
          setLayers([]);
          setTerrainSet(null);
          setAvailableLayers([]);
          setMapLayerId("");
          setLoadingMessage("");
          setError(loadError instanceof Error ? loadError.message : "Unable to load map layers.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLayerId, selectedSet?.name, selectedSetId, setAvailableLayers, setMapLayerId]);

  useEffect(() => {
    if (!map) {
      return;
    }

    if (!selectedLayer) {
      if (mapLayerRef.current) {
        map.removeLayer(mapLayerRef.current);
        mapLayerRef.current = null;
      }
      return;
    }

    if (!getProjection(selectedProjection)) {
      setError(`OpenLayers does not have a registered projection for ${selectedProjection}.`);
      return;
    }

    const matrixSet = selectedLayer.matrix_set ?? selectedLayer.tile_matrix_set?.identifier;
    if (!matrixSet) {
      setError(`Layer "${selectedLayer.name}" is missing a WMTS matrix set identifier.`);
      return;
    }

    const nextView = new View({
      projection: selectedProjection,
      center: DEFAULT_MAP_POSITION,
      zoom: selectedLayer.min_zoom ?? DEFAULT_MIN_ZOOM,
      minZoom: selectedLayer.min_zoom ?? DEFAULT_MIN_ZOOM,
      showFullExtent: true,
    });
    map.setView(nextView);

    if (mapLayerRef.current) {
      map.removeLayer(mapLayerRef.current);
      mapLayerRef.current = null;
    }

    const mapLayer = new TileLayer({
      source: new WMTS({
        url: resolveMapProviderUrl(
          selectedLayer.rest_tile_url
            .replace("/{z}/{y}/{x}.png", "/{TileMatrix}/{TileRow}/{TileCol}.png")
            .replace("/{z}/{y}/{x}.jpg", "/{TileMatrix}/{TileRow}/{TileCol}.jpg")
            .replace("/{z}/{y}/{x}.jpeg", "/{TileMatrix}/{TileRow}/{TileCol}.jpeg")
            .replace("/{z}/{y}/{x}.webp", "/{TileMatrix}/{TileRow}/{TileCol}.webp"),
        ),
        layer: selectedLayer.identifier,
        matrixSet,
        format: selectedLayer.format || "image/png",
        requestEncoding: "REST",
        tileGrid: buildTileGrid(selectedLayer),
        style: "default",
        wrapX: false,
        projection: selectedProjection,
      }),
      zIndex: MAP_TILE_LAYER_ZINDEX,
      preload: 10,
    });

    mapLayerRef.current = mapLayer;
    map.addLayer(mapLayer);

    if (layerExtent) {
      nextView.fit(layerExtent, {
        padding: [32, 32, 32, 32],
        duration: 250,
        maxZoom: selectedLayer.max_zoom ?? 12,
      });
    } else {
      nextView.setZoom(selectedLayer.min_zoom ?? DEFAULT_MIN_ZOOM);
    }

    return () => {
      if (mapLayerRef.current === mapLayer) {
        map.removeLayer(mapLayer);
        mapLayerRef.current = null;
      }
    };
  }, [layerExtent, map, selectedLayer, selectedProjection]);

  useEffect(() => {
    if (!mapLayerRef.current) {
      return;
    }

    const calculatedOpacity =
      1 - Math.abs(smoothedBrightness - DEFAULT_MAP_BRIGHTNESS) / DEFAULT_MAP_BRIGHTNESS;
    mapLayerRef.current.setOpacity(calculatedOpacity);
  }, [smoothedBrightness]);

  return {
    error,
    layerExtent,
    layers,
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
  };
};

export default useMapInitializer;
