import { ImportMeshAsync, Mesh, PBRMaterial, Scene, Texture, TransformNode } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { assetUrl } from "../assets";
import { PARK_CX, STREET } from "../config";
import type { CollisionManager } from "./CollisionManager";
import type { MaterialSet } from "./Materials";
import { MeshBatch, type P3 } from "./MeshBatch";
import { parkChain } from "./mapLayout";
import { glbExists } from "./assetUtil";

const CURB = STREET.curbHeight;
const UP: P3 = [0, 1, 0];
const GLB = assetUrl("assets/park/park.glb");
const DATA = assetUrl("assets/park/park.json");

export interface ParkBuild {
  meshes: Mesh[];
  dispose(): void;
}

interface ParkCollider {
  tag: "prop" | "cover";
  /** Centro (u, y sobre el suelo, v), tamaño y giro (rad); u = x − PARK_CX, v = z. */
  c: [number, number, number];
  s: [number, number, number];
  rot: number;
}

/**
 * El parque (Plaça de Gaudí): el modelo aportado (public/assets/park/park.glb, ver scripts/build-park.mjs) —camino de adoquín con borde de piedra, farolas,
 * bancos y árboles de cartulina— sobre un suelo de césped que rellena el octógono de la manzana a la altura de las aceras. El modelo se carga ya
 * centrado y orientado para esta manzana; sus colisiones (farolas, bancos, bases, troncos) vienen en park.json. Si falta el GLB queda el césped solo.
 */
export async function buildPark(scene: Scene, mats: MaterialSet, collisions: CollisionManager): Promise<ParkBuild> {
  const meshes: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];

  // Suelo: abanico desde el centro hasta el perímetro de la manzana. La textura de césped y su normal salen del modelo.
  const grass = new MeshBatch(mats.tile.grass);
  const pts = parkChain.points;
  const c: P3 = [PARK_CX, CURB, 0];
  const t = mats.tile.grass;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    grass.addTriangle([c, [a.x, CURB, a.z], [b.x, CURB, b.z]], UP, [[c[0] / t, c[2] / t], [a.x / t, a.z / t], [b.x / t, b.z / t]]);
  }
  const ground = grass.toMesh("parkGrass", scene)!;
  ground.material = mats.mat.grass;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.freezeWorldMatrix();
  meshes.push(ground);
  const albedo = new Texture(assetUrl("assets/park/grass_albedo.webp"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  const normal = new Texture(assetUrl("assets/park/grass_normal.webp"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  for (const tx of [albedo, normal]) {
    tx.wrapU = tx.wrapV = Texture.WRAP_ADDRESSMODE;
    tx.anisotropicFilteringLevel = 8;
  }
  const g = mats.mat.grass;
  g.albedoTexture = albedo;
  g.bumpTexture = normal;
  g.bumpTexture.level = 1;
  g.albedoColor.scaleInPlace(1.25); // el césped del modelo es oscuro para la exposición del juego
  disposables.push(albedo, normal);

  if (!(await glbExists(GLB))) {
    console.warn(`[Parque] No se encontró ${GLB}: parque solo de césped (npm run build:park).`);
    return { meshes, dispose: () => meshes.forEach((m) => m.dispose()) };
  }
  try {
    const result = await ImportMeshAsync(GLB, scene);
    const root = new TransformNode("park", scene);
    for (const n of result.meshes.filter((m) => !m.parent)) n.parent = root;
    root.position.set(PARK_CX, CURB, 0);
    let tris = 0;
    for (const m of result.meshes) {
      if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
      m.isPickable = false;
      m.receiveShadows = true;
      m.checkCollisions = false;
      tris += m.getTotalIndices() / 3;
      const mat = m.material;
      if (mat instanceof PBRMaterial) {
        mat.environmentIntensity = 0.9;
        if (/^(tn1_|trees-)/.test(mat.name)) mat.albedoColor.scaleInPlace(1.45); // las fotos de los árboles son oscuras para la exposición del juego
        // camino y borde un pelo por encima del césped (mismo plano en el modelo): el desplazamiento de profundidad evita el parpadeo
        if (/^Material\.00[23]$/.test(mat.name)) {
          mat.zOffset = -2;
          m.position.y += 0.012;
        }
        mat.freeze();
      }
      m.freezeWorldMatrix();
      meshes.push(m);
    }
    const data = (await (await fetch(DATA)).json()) as { colliders: ParkCollider[] };
    for (const k of data.colliders) collisions.addBox(PARK_CX + k.c[0], CURB + k.c[1], k.c[2], k.s[0], k.s[1], k.s[2], k.rot, k.tag);
    console.info(`[Parque] Modelo cargado: ${result.meshes.length} mallas, ${Math.round(tris).toLocaleString()} triángulos, ${data.colliders.length} colisiones.`);
    disposables.push(root);
  } catch (e) {
    console.error("[Parque] No se pudo cargar el modelo del parque (se deja solo el césped):", e);
  }
  return {
    meshes,
    dispose: () => {
      meshes.forEach((m) => m.dispose(false, true));
      disposables.forEach((d) => d.dispose());
    },
  };
}
