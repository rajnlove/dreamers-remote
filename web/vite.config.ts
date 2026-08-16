import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // @novnc/novnc uses top-level await (H264 WebCodecs feature-detection);
  // esbuild's default legacy-ish target list doesn't support that syntax.
  build: {
    target: "esnext",
  },
  // dev server's dependency pre-bundling step uses its own esbuild target
  // (defaults to an older list), separate from build.target above
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
