// Descarga el índice CZML del visor del ICGC y genera assets-src/icgc/tiles.json (teselas con su distancia a la basílica).
// Fuente: https://betaserver.icgc.cat/cesium/SagradaFamilia3D.html — © ICGC (citar la fuente; licencia no confirmada en esa página).
import fs from "node:fs";
const res = await fetch("https://betaserver.icgc.cat/cesium/data/BCN21_SG.czml");
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const czml = JSON.parse(await res.text());
const lat0 = 41.40369, lon0 = 2.17436; // basílica (aprox.)
const rows = [];
for (const e of czml) {
  if (!e.model) continue;
  const [lon, lat, h] = e.position.cartographicDegrees;
  const dx = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), dz = (lat - lat0) * 110574;
  rows.push({ f: e.model.gltf, dx: Math.round(dx), dz: Math.round(dz), h, d: Math.round(Math.hypot(dx, dz)) });
}
rows.sort((a, b) => a.d - b.d);
fs.mkdirSync("assets-src/icgc", { recursive: true });
fs.writeFileSync("assets-src/icgc/tiles.json", JSON.stringify(rows));
console.log(`${rows.length} teselas indexadas`);
