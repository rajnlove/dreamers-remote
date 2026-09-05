import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "upload", base: "/upload/", plugins: [react()],
  build: { outDir: "../dist-upload", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4184, strictPort: true,
    proxy: { "/upload/api": "http://127.0.0.1:8090" },
    fs: { allow: [".."] },
  },
});
