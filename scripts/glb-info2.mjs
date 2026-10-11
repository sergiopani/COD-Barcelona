// Inspección detallada de un GLB: nodos, mallas, materiales y texturas. Uso: node scripts/glb-info2.mjs <archivo.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const b = getBounds(scene);
console.log("bounds", b.min.map((v) => v.toFixed(2)).join(","), "→", b.max.map((v) => v.toFixed(2)).join(","), "tam", b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(" x "));
let tris = 0;
root.listMeshes().forEach((m) => m.listPrimitives().forEach((p) => (tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3)));
console.log("nodos", root.listNodes().length, "mallas", root.listMeshes().length, "tris", Math.round(tris), "extensiones", root.listExtensionsUsed().map((e) => e.extensionName).join(","));
for (const m of root.listMaterials()) {
  const t = (x) => (x ? `${x.getSize()?.join("x")} ${x.getMimeType()}` : "-");
  console.log("mat", m.getName(), "color", m.getBaseColorFactor().map((v) => v.toFixed(2)).join(","), "metal", m.getMetallicFactor(), "rough", m.getRoughnessFactor(), "alpha", m.getAlphaMode(), "base", t(m.getBaseColorTexture()), "normal", t(m.getNormalTexture()), "orm", t(m.getMetallicRoughnessTexture()), "emis", t(m.getEmissiveTexture()));
}
root.listMeshes().slice(0, 40).forEach((m) => console.log("malla", m.getName(), m.listPrimitives().length, "prims", m.listPrimitives().map((p) => (p.getMaterial()?.getName() ?? "-") + ":" + Math.round((p.getIndices()?.getCount() ?? 0) / 3)).join(" ")));
