import { AbstractMesh, ImportMeshAsync, Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ASSETS } from "../config";
import type { CollisionManager } from "./CollisionManager";
import type { MaterialSet } from "./Materials";
import { buildSagradaPlaceholder } from "./SagradaFamiliaPlaceholder";

/**
 * Carga de la Sagrada Família desde public/assets/buildings/sagrada-familia.glb.
 * La posición, rotación y escala se ajustan en sagrada-familia.config.json (sin recompilar).
 * Si el modelo no existe o falla, se muestra un error claro en consola y se usa la basílica provisional.
 */

export interface SagradaConfig {
  /** Posición donde se coloca el modelo [x, y, z] (si centerXZ, es el centro de su huella). */
  position: [number, number, number];
  rotationYDeg: number;
  scale: number;
  /** Si se define, ignora `scale` y escala el modelo a esta altura (m). */
  targetHeight: number | null;
  centerXZ: boolean;
  /** Apoya la parte más baja del modelo en y = position[1]. */
  alignToGround: boolean;
  castShadows: boolean;
  /** Colliders simples en planta: centro, tamaño y altura (el modelo NUNCA se usa como colisión). */
  colliders: { cx: number; cz: number; sx: number; sz: number; h: number; rotYDeg?: number }[];
}

const DEFAULT_CONFIG: SagradaConfig = {
  position: [0, 0.14, 0],
  rotationYDeg: 0,
  scale: 1,
  targetHeight: null,
  centerXZ: true,
  alignToGround: true,
  castShadows: false,
  colliders: [],
};

export interface SagradaResult {
  usedPlaceholder: boolean;
  meshes: AbstractMesh[];
  castShadows: boolean;
  dispose(): void;
}

async function loadConfig(): Promise<SagradaConfig> {
  try {
    const res = await fetch(ASSETS.sagradaFamiliaConfig, { cache: "no-cache" });
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(await res.json()) };
  } catch (e) {
    console.warn("[SagradaFamilia] No se pudo leer la configuración; se usan valores por defecto.", e);
    return DEFAULT_CONFIG;
  }
}

/** Comprueba que la URL devuelve realmente un GLB (el servidor de Vite devuelve index.html con 200 si no existe). */
async function glbExists(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return false;
    const reader = res.body?.getReader();
    if (!reader) return false;
    const { value } = await reader.read();
    ctrl.abort();
    return !!value && value.length >= 4 && value[0] === 0x67 && value[1] === 0x6c && value[2] === 0x54 && value[3] === 0x46; // "glTF"
  } catch {
    return false;
  }
}

export async function loadSagradaFamilia(scene: Scene, mats: MaterialSet, collisions: CollisionManager): Promise<SagradaResult> {
  const config = await loadConfig();
  const url = ASSETS.sagradaFamiliaGlb;

  if (await glbExists(url)) {
    try {
      const result = await ImportMeshAsync(url, scene);
      const wrapper = new TransformNode("sagradaFamilia", scene);
      for (const n of result.meshes.filter((m) => !m.parent)) n.parent = wrapper;

      wrapper.scaling.setAll(config.scale);
      wrapper.rotation.y = (config.rotationYDeg * Math.PI) / 180;
      wrapper.position.set(0, 0, 0);
      wrapper.computeWorldMatrix(true);
      let b = wrapper.getHierarchyBoundingVectors(true);
      if (config.targetHeight && b.max.y - b.min.y > 0) {
        wrapper.scaling.setAll(config.scale * (config.targetHeight / (b.max.y - b.min.y)));
        wrapper.computeWorldMatrix(true);
        b = wrapper.getHierarchyBoundingVectors(true);
      }
      const center = Vector3.Center(b.min, b.max);
      wrapper.position.set(
        config.position[0] - (config.centerXZ ? center.x : 0),
        config.alignToGround ? config.position[1] - b.min.y : config.position[1],
        config.position[2] - (config.centerXZ ? center.z : 0),
      );
      wrapper.computeWorldMatrix(true);
      const fb = wrapper.getHierarchyBoundingVectors(true);

      let tris = 0;
      let verts = 0;
      for (const m of result.meshes) {
        m.isPickable = false;
        m.receiveShadows = true;
        m.checkCollisions = false; // la geometría del modelo nunca se usa como colisión
        m.freezeWorldMatrix();
        m.material?.freeze();
        if (m instanceof Mesh) {
          tris += m.getTotalIndices() / 3;
          verts += m.getTotalVertices();
        }
      }
      console.info(
        `[SagradaFamilia] GLB cargado: ${result.meshes.length} mallas, ${Math.round(tris).toLocaleString()} triángulos, ` +
          `${verts.toLocaleString()} vértices. Tamaño en el mundo: ${(fb.max.x - fb.min.x).toFixed(1)} × ${(fb.max.y - fb.min.y).toFixed(1)} × ${(fb.max.z - fb.min.z).toFixed(1)} m.`,
      );
      if (tris > 1_500_000) {
        console.warn("[SagradaFamilia] El modelo supera 1,5 M de triángulos: considera simplificarlo/comprimirlo (Draco/meshopt) o añadir LOD.");
      }
      for (const c of config.colliders) {
        collisions.addBox(c.cx, c.h / 2, c.cz, c.sx, c.h, c.sz, ((c.rotYDeg ?? 0) * Math.PI) / 180, "sagrada");
      }
      return {
        usedPlaceholder: false,
        meshes: result.meshes,
        castShadows: config.castShadows,
        dispose: () => {
          result.meshes.forEach((m) => m.dispose(false, true));
          wrapper.dispose();
        },
      };
    } catch (e) {
      console.error(`[SagradaFamilia] ERROR: el archivo ${url} existe pero no se pudo importar. Se usa la basílica provisional.`, e);
    }
  } else {
    console.error(
      `[SagradaFamilia] ERROR: no se encontró ${url}. Se usa una basílica provisional procedural. ` +
        "Copia tu modelo en public/assets/buildings/sagrada-familia.glb y ajusta sagrada-familia.config.json.",
    );
  }

  const ph = buildSagradaPlaceholder(scene, mats);
  console.info(`[SagradaFamilia] Basílica provisional: ${ph.meshes.length} mallas, ${Math.round(ph.triangleCount).toLocaleString()} triángulos.`);
  for (const c of config.colliders) {
    collisions.addBox(c.cx, c.h / 2, c.cz, c.sx, c.h, c.sz, ((c.rotYDeg ?? 0) * Math.PI) / 180, "sagrada");
  }
  return {
    usedPlaceholder: true,
    meshes: ph.meshes,
    castShadows: true,
    dispose: () => ph.meshes.forEach((m) => m.dispose()),
  };
}
