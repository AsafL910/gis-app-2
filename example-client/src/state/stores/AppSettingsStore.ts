import { useSyncExternalStore } from "react";

type AppSettings = {
  ENVIRONMENT: string;
  MAP_URL: string;
  STATION: string;
};

type AppSettingsState = {
  appSettings: AppSettings;
};

const listeners = new Set<() => void>();

let state: AppSettingsState = {
  appSettings: {
    ENVIRONMENT: import.meta.env.MODE === "development" ? "Developement" : "Production",
    MAP_URL:
      import.meta.env.VITE_MAP_URL || "http://localhost:8003/api/v1/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
    STATION: import.meta.env.VITE_STATION || ""
  }
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

export default function useAppSettingsStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snapshot;
}
