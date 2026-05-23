// @ts-nocheck
import { useEffect, useRef, useState } from 'react';

import useMapStore from 'state/stores/MapStore';

import { DEFAULT_MAP_POSITION, useMap } from 'hooks/map/useMap';

import { Map as OLMap, View } from 'ol';
import * as ol from 'ol';
import { defaults as defaultInteractions } from 'ol/interaction';
import TileLayer from 'ol/layer/Tile';
import { get as getProjection } from 'ol/proj';
import WMTS from 'ol/source/WMTS';
import WMTSTileGrid from 'ol/tilegrid/WMTS';

import { DEFAULT_MAP_BRIGHTNESS } from 'commonUtils/MapUtils';

import useDebounce from 'hooks/useDebounce';
import useAppSettingsStore from 'state/stores/AppSettingsStore';
import { MAP_TILE_LAYER_ZINDEX } from 'map/mapLayers/MapLayersIndexes';

type LayerPayload = {
  identifier: string;
  name: string;
  rest_tile_url: string;
  format?: string;
  matrix_set?: string;
  min_zoom?: number;
  max_zoom?: number;
  crs?: string;
  tile_matrix_set?: {
    identifier: string;
    supported_crs: string;
    bounds: [number, number, number, number];
    top_left_corner: [number, number];
  };
  tile_matrices?: Array<{
    identifier: string;
    zoom: number;
    matrix_width: number;
    matrix_height: number;
    tile_width: number;
    tile_height: number;
    pixel_x_size: number;
    pixel_y_size: number;
  }>;
  bounds?: {
    epsg4326?: [number, number, number, number];
    native?: {
      crs: string;
      extent: [number, number, number, number];
    };
  };
};

type LayersPayload = {
  layers: LayerPayload[];
};

const DEFAULT_PROJECTION = 'EPSG:4326';

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

const useMapInitializer = () => {
  const { appSettings } = useAppSettingsStore();
  const { map, setMap } = useMap();
  const mapRef = useRef<HTMLDivElement>();
  const [layers, setLayers] = useState<LayerPayload[]>([]);
  const { selectedLayerName, brightness, setAvailableLayers, setMapLayerName } = useMapStore();

  const smoothedBrightness = useDebounce(brightness, 200);

  const buildTileGrid = (layer: LayerPayload) => {
    const matrices = layer.tile_matrices ?? [];
    if (!matrices.length || !layer.tile_matrix_set) {
      throw new Error(`Layer "${layer.identifier}" is missing tile matrix metadata.`);
    }

    const topLeftCorner = layer.tile_matrix_set.top_left_corner;

    return new WMTSTileGrid({
      origin: topLeftCorner,
      resolutions: matrices.map((matrix) => matrix.pixel_x_size),
      matrixIds: matrices.map((matrix) => matrix.identifier),
      sizes: matrices.map((matrix) => [matrix.matrix_width, matrix.matrix_height]),
      tileSizes: matrices.map((matrix) => [matrix.tile_width, matrix.tile_height])
    });
  };

  const serviceBaseUrl = `${appSettings?.MAP_URL || ''}`.split('?')[0].replace(/\/wmts\/?$/, '');
  const selectedLayer =
    layers.find((layer) => layer.name === selectedLayerName) ??
    layers[0] ??
    null;
  const selectedProjection = normalizeProjectionCode(selectedLayer?.crs ?? selectedLayer?.tile_matrix_set?.supported_crs);
  const layerExtent =
    selectedLayer?.bounds?.native && normalizeProjectionCode(selectedLayer.bounds.native.crs) === selectedProjection
      ? selectedLayer.bounds.native.extent
      : selectedLayer?.bounds?.epsg4326;

  useEffect(() => {
    if (!mapRef.current) return;

    const initMap: OLMap = new OLMap({
      target: mapRef.current,
      view: new View({
        projection: DEFAULT_PROJECTION,
        center: DEFAULT_MAP_POSITION,
        zoom: 10,
        minZoom: 5,
        showFullExtent: true
      }),
      controls: [],
      layers: [],
      interactions: defaultInteractions({ doubleClickZoom: false }),
      moveTolerance: 50,
      maxTilesLoading: 6
    });

    setMap(initMap);
    mapRef.current?.focus();

    if (appSettings?.ENVIRONMENT === 'Developement') {
      window['_map'] = initMap;
      window['ol'] = ol;
    }

    return () => {
      initMap?.setTarget(undefined);
    };
  }, [appSettings.STATION, appSettings, setMap]);

  useEffect(() => {
    if (!serviceBaseUrl) return;

    void (async () => {
      const response = await fetch(`${serviceBaseUrl}/api/layers`, { mode: 'cors' });
      const payload: LayersPayload = await response.json();
      const nextLayers = payload.layers ?? [];
      setLayers(nextLayers);
      setAvailableLayers(nextLayers.map((layer) => layer.name));

      if (!selectedLayerName && nextLayers[0]?.name) {
        setMapLayerName(nextLayers[0].name);
      }
    })();
  }, [serviceBaseUrl, setAvailableLayers, setMapLayerName]);

  useEffect(() => {
    if (!map || !selectedLayer) return;

    if (!getProjection(selectedProjection)) {
      console.error(`OpenLayers does not have a registered projection for ${selectedProjection}.`);
      return;
    }

    map.setView(
      new View({
        projection: selectedProjection,
        center: DEFAULT_MAP_POSITION,
        zoom: selectedLayer.min_zoom ?? 0,
        minZoom: selectedLayer.min_zoom ?? 0,
        showFullExtent: true
      })
    );

    const calculatedOpacity =
      1 - Math.abs(smoothedBrightness - DEFAULT_MAP_BRIGHTNESS) / DEFAULT_MAP_BRIGHTNESS;

    const url = `${serviceBaseUrl}${selectedLayer.rest_tile_url
      .replace('/{z}/{y}/{x}.png', '/{TileMatrix}/{TileRow}/{TileCol}.png')
      .replace('/{z}/{y}/{x}.jpg', '/{TileMatrix}/{TileRow}/{TileCol}.jpg')
      .replace('/{z}/{y}/{x}.jpeg', '/{TileMatrix}/{TileRow}/{TileCol}.jpeg')
      .replace('/{z}/{y}/{x}.webp', '/{TileMatrix}/{TileRow}/{TileCol}.webp')}`;

    const layer = new TileLayer({
      source: new WMTS({
        url,
        layer: selectedLayer.identifier,
        matrixSet: selectedLayer.matrix_set || selectedLayer.tile_matrix_set.identifier,
        format: selectedLayer.format || 'image/png',
        requestEncoding: 'REST',
        tileGrid: buildTileGrid(selectedLayer),
        style: 'default',
        wrapX: false,
        projection: selectedProjection
      }),
      zIndex: MAP_TILE_LAYER_ZINDEX,
      preload: 10,
      opacity: calculatedOpacity
    });

    map.addLayer(layer);

    if (layerExtent) {
      map.getView().fit(layerExtent, {
        padding: [32, 32, 32, 32],
        duration: 250,
        maxZoom: selectedLayer.max_zoom ?? 12
      });
    } else {
      map.getView().setZoom(selectedLayer.min_zoom ?? 7);
    }

    return () => {
      map.removeLayer(layer);
    };
  }, [map, selectedLayer, serviceBaseUrl, smoothedBrightness]);

  return {
    mapRef,
    smoothedBrightness,
    selectedProjection
  };
};

export default useMapInitializer;
