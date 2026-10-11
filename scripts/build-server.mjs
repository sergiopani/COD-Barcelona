// Empaqueta el servidor de juego en un único archivo JS (sin tsx en producción) y copia sus datos.
import fs from "node:fs";
import { build } from "esbuild";

fs.rmSync("dist-server", { recursive: true, force: true });
await build({
  entryPoints: ["server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist-server/index.mjs",
  external: ["ws"],
  sourcemap: true,
  legalComments: "none",
});
fs.mkdirSync("dist-server/data", { recursive: true });
fs.copyFileSync("server/data/world-colliders.json", "dist-server/data/world-colliders.json");
const kb = (fs.statSync("dist-server/index.mjs").size / 1024).toFixed(0);
console.log(`dist-server/index.mjs (${kb} KB) + data/world-colliders.json`);
