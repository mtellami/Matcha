import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  envDir: "..",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mapbox-gl/esm"] },
  plugins: [tailwindcss()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: false },
      "/socket.io": { target: "http://localhost:5000", ws: true },
    },
  },
});
