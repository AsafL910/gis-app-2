import { useSyncExternalStore } from "react";
import { DEFAULT_MAP_BRIGHTNESS } from "commonUtils/MapUtils";

type MapLayerOption = {
  id: string;
  label: string;
};

type MapStoreState = {
  availableLayers: MapLayerOption[];
  brightness: number;
  selectedLayerId: string;
};

const listeners = new Set<() => void>();

let state: MapStoreState = {
  availableLayers: [],
  brightness: DEFAULT_MAP_BRIGHTNESS,
  selectedLayerId: ""
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

function setAvailableLayers(availableLayers: MapLayerOption[]) {
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

function setMapLayerId(selectedLayerId: string) {
  if (state.selectedLayerId === selectedLayerId) {
    return;
  }

  state = {
    ...state,
    selectedLayerId
  };
  emitChange();
}

export default function useMapStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...snapshot,
    setAvailableLayers,
    setBrightness,
    setMapLayerId
  };
}
