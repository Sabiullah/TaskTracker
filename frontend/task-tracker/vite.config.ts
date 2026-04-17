import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    // React Compiler (via Babel) is expensive — only run it over our own
    // source, never node_modules or generated files.
    babel({
      include: ["src/**/*.{ts,tsx,js,jsx}"],
      exclude: ["node_modules/**", "dist/**", "src/**/*.test.{ts,tsx}"],
      presets: [reactCompilerPreset()],
    }),
  ],
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts", "src/__tests__/**/*.test.tsx"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // Django admin + its collected static assets — proxy so hitting
      // http://localhost:5173/admin/ lands on Django instead of the SPA.
      "/admin": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/static": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // WebSockets (Channels) — HTTP upgrade needs ws:true
      "/ws": {
        target: "ws://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
