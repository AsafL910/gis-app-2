import { useSyncExternalStore } from "react";
import type { Map as OLMap } from "ol";

type MapState = {
  map: OLMap | null;
};

const DEFAULT_STATE: MapState = {
  map: null
};

const listeners = new Set<() => void>();
let state = DEFAULT_STATE;

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

function setMap(nextMap: OLMap | null) {
  if (state.map === nextMap) {
    return;
  }

  state = {
    ...state,
    map: nextMap
  };
  emitChange();
}

export const DEFAULT_MAP_POSITION: [number, number] = [35, 32];
export function useMap() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    map: snapshot.map,
    setMap
  };
}
