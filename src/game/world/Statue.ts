import { Color3, ImportMeshAsync, Mesh, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { assetUrl } from "../assets";
import { PARK_CX, STREET } from "../config";
import type { CollisionManager } from "./CollisionManager";
import type { LightingRig } from "./Lighting";
import type { MaterialSet } from "./Materials";
import { BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import { STATUE } from "./mapLayout";
import { glbExists } from "./assetUtil";

const CURB = STREET.curbHeight;
const URL = assetUrl("assets/props/doraemon.glb");
/** Altura de la figura (m) sobre el pedestal; con el pedestal la estatua mide ~12 m: una palmera y media. */
const FIGURE_HEIGHT = 10.5;
const STEP = { size: 7.2, h: 0.5 };
const BLOCK = { size: 5.8, h: 1.0 };

export interface StatueBuild {
  dispose(): void;
}

/** Colores de la figura (el modelo trae un azul muy oscuro para la exposición del juego). */
const COLORS: Record<string, [number, number, number]> = {
  blue: [0.0, 0.22, 0.85],
  white: [0.95, 0.95, 0.95],
  yellow: [1.0, 0.62, 0.02],
  "Material.002": [0.75, 0.02, 0.03], // collar
  material: [0.75, 0.02, 0.03], // nariz
  tounge: [0.85, 0.15, 0.1],
};

/**
 * Estatua de Doraemon (public/assets/props/doraemon.glb, modelo aportado por el usuario) sobre un pedestal de piedra de dos escalones,
 * en el césped del parque, lo más cerca posible de su centro (el centro exacto cae dentro del estanque). Pedestal sólido; la figura queda fuera de alcance.
 */
export async function loadStatue(scene: Scene, mats: MaterialSet, collisions: CollisionManager, lighting: LightingRig): Promise<StatueBuild> {
  const x = PARK_CX + STATUE.u;
  const z = STATUE.v;
  const meshes: Mesh[] = [];

  // Pedestal: escalón bajo + bloque; un único collider cuadrado.
  const set = new BatchSet(mats.tile);
  const stone = set.get("statue", "stone");
  const f = new Frame(x, CURB, z, 1, 0, 0, -1);
  const stoneC: RGBA = [1.05, 1, 0.92, 1];
  stone.addBox(f, 0, STEP.h / 2, 0, STEP.size, STEP.h, STEP.size, stoneC, F.DOWN);
  stone.addBox(f, 0, STEP.h + BLOCK.h / 2, 0, BLOCK.size, BLOCK.h, BLOCK.size, [1, 0.97, 0.88, 1], F.DOWN);
  for (const { mesh } of set.build(scene, "statue")) {
    mesh.material = mats.mat.stone;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    lighting.addShadowCaster(mesh, "prop");
    meshes.push(mesh);
  }
  const top = STEP.h + BLOCK.h;
  collisions.addBox(x, CURB + top / 2, z, STEP.size, top, STEP.size, 0, "prop");

  let root: TransformNode | null = null;
  if (await glbExists(URL)) {
    try {
      const result = await ImportMeshAsync(URL, scene);
      root = new TransformNode("doraemon", scene);
      for (const n of result.meshes.filter((m) => !m.parent)) n.parent = root;
      root.rotation.y = STATUE.yaw;
      root.computeWorldMatrix(true);
      let b = root.getHierarchyBoundingVectors(true);
      const s = FIGURE_HEIGHT / (b.max.y - b.min.y);
      root.scaling.setAll(s);
      root.computeWorldMatrix(true);
      b = root.getHierarchyBoundingVectors(true);
      const c = Vector3.Center(b.min, b.max);
      root.position.set(x - c.x, CURB + top - b.min.y, z - c.z);
      root.computeWorldMatrix(true);
      for (const m of result.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
        m.isPickable = false;
        m.receiveShadows = true;
        m.checkCollisions = false;
        const mat = m.material;
        if (mat instanceof PBRMaterial) {
          const col = COLORS[mat.name];
          if (col) mat.albedoColor = new Color3(...col);
          mat.environmentIntensity = 0.9;
          mat.freeze();
        }
        m.freezeWorldMatrix();
        lighting.addShadowCaster(m, "prop");
        meshes.push(m);
      }
      console.info(`[Estatua] Doraemon colocado en (${x.toFixed(1)}, ${z.toFixed(1)}), ${Math.round(FIGURE_HEIGHT + top)} m con pedestal.`);
    } catch (e) {
      console.error("[Estatua] No se pudo cargar el modelo de Doraemon (queda solo el pedestal):", e);
    }
  } else {
    console.warn(`[Estatua] No se encontró ${URL}: solo el pedestal.`);
  }
  return {
    dispose() {
      meshes.forEach((m) => m.dispose(false, true));
      root?.dispose();
    },
  };
}
