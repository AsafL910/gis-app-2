import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const mapProviderProxyTarget = process.env.MAP_PROVIDER_PROXY_TARGET || "http://localhost:8003";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: mapProviderProxyTarget,
        changeOrigin: true,
      }
    }
  }
});
