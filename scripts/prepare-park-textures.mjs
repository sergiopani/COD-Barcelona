// Extrae del modelo de parque aportado (assets-src/park/park.glb) las texturas que usa el parque del juego:
//   césped (Material.001) → grass_*, camino de adoquín (Material.002) → path_*, madera de los bancos (Material.005) → wood_albedo
// Salida: public/assets/park/*.webp (fuera de git: el modelo de origen no tiene licencia documentada). Uso: node scripts/prepare-park-textures.mjs
import fs from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";

const OUT = "public/assets/park";
fs.mkdirSync(OUT, { recursive: true });
const doc = await new NodeIO().read("assets-src/park/park.glb");
const mats = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
const save = async (tex, file, size) => {
  if (!tex) throw new Error(`falta la textura de ${file}`);
  await sharp(Buffer.from(tex.getImage()), { limitInputPixels: false }).resize(size, size, { fit: "fill" }).webp({ quality: 88 }).toFile(`${OUT}/${file}.webp`);
  console.log(`${file}: ${(fs.statSync(`${OUT}/${file}.webp`).size / 1024).toFixed(0)} KB`);
};
await save(mats.get("Material.001").getBaseColorTexture(), "grass_albedo", 256);
await save(mats.get("Material.001").getNormalTexture(), "grass_normal", 256);
await save(mats.get("Material.002").getBaseColorTexture(), "path_albedo", 512);
await save(mats.get("Material.002").getNormalTexture(), "path_normal", 512);
await save(mats.get("Material.005").getBaseColorTexture(), "wood_albedo", 512);
