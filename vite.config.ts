import { defineConfig } from "vite";

export default defineConfig({
  // VITE_BASE permite servir el juego desde una subruta (p. ej. /barcelona-fps/)
  base: process.env.VITE_BASE ?? "/",
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
