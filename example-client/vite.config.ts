import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const mapProviderProxyTarget = process.env.MAP_PROVIDER_PROXY_TARGET || "http://localhost:8003";
const hatProviderProxyTarget = process.env.HAT_PROVIDER_PROXY_TARGET || "http://localhost:8004";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/map-provider-api": {
        target: mapProviderProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/map-provider-api/, "")
      },
      "/hat-provider-api": {
        target: hatProviderProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hat-provider-api/, "")
      }
    }
  }
});
