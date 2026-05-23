import { useSyncExternalStore } from "react";
import { DEFAULT_MAP_BRIGHTNESS } from "commonUtils/MapUtils";

type MapStoreState = {
  availableLayers: string[];
  brightness: number;
  selectedLayerName: string;
};

const listeners = new Set<() => void>();

let state: MapStoreState = {
  availableLayers: [],
  brightness: DEFAULT_MAP_BRIGHTNESS,
  selectedLayerName: ""
};

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function setAvailableLayers(availableLayers: string[]) {
  if (state.availableLayers === availableLayers) {
    return;
  }

  state = {
    ...state,
    availableLayers
  };
  emitChange();
}

function setBrightness(brightness: number) {
  if (state.brightness === brightness) {
    return;
  }

  state = {
    ...state,
    brightness
  };
  emitChange();
}

function setMapLayerName(selectedLayerName: string) {
  if (state.selectedLayerName === selectedLayerName) {
    return;
  }

  state = {
    ...state,
    selectedLayerName
  };
  emitChange();
}

export default function useMapStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...snapshot,
    setAvailableLayers,
    setBrightness,
    setMapLayerName
  };
}
