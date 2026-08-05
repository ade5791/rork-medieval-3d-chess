import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Multiplayer relay target for the dev proxy (see server/index.js). */
const RELAY_TARGET = process.env.MULTIPLAYER_TARGET ?? "http://localhost:8787";

// https://vitejs.dev/config/
/**
 * Public base path. Vite's default "/" only works at a domain root; a GitHub
 * Pages PROJECT site lives under /<repo>/. Set PUBLIC_BASE at build time so
 * the identical source ships to both without a second config.
 */
const PUBLIC_BASE = process.env.PUBLIC_BASE ?? "/";

export default defineConfig(({ mode }) => ({
  base: PUBLIC_BASE,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // The online client connects to `/ws` on the page origin, so dev and a
      // single-origin production deploy use the identical URL and no build-time
      // configuration is needed. Point elsewhere with VITE_MULTIPLAYER_URL.
      "/ws": {
        target: RELAY_TARGET,
        ws: true,
        changeOrigin: true,
      },
      "/health": {
        target: RELAY_TARGET,
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
