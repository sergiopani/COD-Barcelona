// Descarga las teselas glTF del visor del ICGC (https://betaserver.icgc.cat/cesium/SagradaFamilia3D.html) cercanas a la basílica.
// Autorizado por el usuario. Entrada: assets-src/icgc/tiles.json (generado desde BCN21_SG.czml). Salida: assets-src/icgc/tiles/
// Uso: node scripts/icgc-fetch.mjs [radio_m=75] [límite_MB=150]
import fs from "node:fs";
import path from "node:path";
const radius = Number(process.argv[2] ?? 75);
const limit = Number(process.argv[3] ?? 150) * 1048576;
const base = "https://betaserver.icgc.cat/cesium/data/";
const rows = JSON.parse(fs.readFileSync("assets-src/icgc/tiles.json", "utf8")).filter((r) => r.d <= radius);
fs.mkdirSync("assets-src/icgc/tiles", { recursive: true });
let total = 0, ok = 0, failed = [];
const get = async (rel) => {
  const url = base + rel.split("/").map(encodeURIComponent).join("/");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${rel}`);
  return Buffer.from(await r.arrayBuffer());
};
let i = 0;
async function worker() {
  while (i < rows.length) {
    const r = rows[i++];
    try {
      const name = path.basename(r.f);
      const dst = path.join("assets-src/icgc/tiles", name);
      const gltf = fs.existsSync(dst) ? fs.readFileSync(dst) : await get(r.f);
      fs.writeFileSync(dst, gltf);
      total += gltf.length;
      const g = JSON.parse(gltf.toString());
      for (const img of Object.values(g.images ?? {})) {
        if (total > limit) throw new Error("límite de tamaño superado");
        const tdst = path.join("assets-src/icgc/tiles", img.uri);
        const buf = fs.existsSync(tdst) ? fs.readFileSync(tdst) : await get(path.join(path.dirname(r.f), img.uri));
        fs.writeFileSync(tdst, buf);
        total += buf.length;
      }
      ok++;
    } catch (e) {
      failed.push(String(e.message));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`teselas: ${ok}/${rows.length} · ${(total / 1048576).toFixed(1)} MB · fallos: ${failed.length}`, failed.slice(0, 5));
