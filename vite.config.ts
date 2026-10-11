import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("@babylonjs") ? "babylon" : undefined),
      },
    },
  },
});
