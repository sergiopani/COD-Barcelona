// Muestra caja envolvente, triángulos y materiales de un GLB. Uso: node scripts/glb-info.mjs <archivo.glb>
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization, KHRTextureTransform } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization, KHRTextureTransform]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
const b = getBounds(scene);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
console.log("min", b.min.map((v) => v.toFixed(2)).join(","), "max", b.max.map((v) => v.toFixed(2)).join(","), "tam", b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(" x "), "tris", Math.round(tris), "materiales", doc.getRoot().listMaterials().length);
