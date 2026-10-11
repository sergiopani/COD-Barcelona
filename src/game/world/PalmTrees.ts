import { ImportMeshAsync, Matrix, Mesh, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ASSETS } from "../assets";
import { Rng } from "../util/rng";
import { glbExists } from "./assetUtil";

/**
 * Palmeras a partir de public/assets/props/palm-tree.glb. Se cargan UNA vez, se hornean sus
 * transformaciones (pies en el origen, tamaño en metros) y se dibujan con thin instances:
 * todas las palmeras del mapa cuestan un draw call por submalla.
 */
export interface PalmPlacement {
  x: number;
  y: number;
  z: number;
}

/** Altura de la palmera tras hornear el modelo (m). Cada instancia varía ±. */
const BASE_HEIGHT = 8.5;

export interface PalmSet {
  meshes: Mesh[];
  dispose(): void;
}

export async function buildPalms(scene: Scene, placements: PalmPlacement[], seed = 99): Promise<PalmSet | null> {
  const url = ASSETS.palmGlb;
  if (!(await glbExists(url))) {
    console.error(`[Palmeras] ERROR: no se encontró ${url}. Se usan árboles procedurales de respaldo.`);
    return null;
  }
  try {
    const result = await ImportMeshAsync(url, scene);
    const root = new TransformNode("palmTemplate", scene);
    for (const n of result.meshes.filter((m) => !m.parent)) n.parent = root;
    root.computeWorldMatrix(true);
    const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    if (meshes.length === 0) throw new Error("el GLB de palmeras no contiene geometría");

    const b = root.getHierarchyBoundingVectors(true);
    const height = b.max.y - b.min.y;
    // Base del tronco: media XZ de los vértices más bajos del modelo.
    let sx = 0;
    let sz = 0;
    let n = 0;
    const lowLimit = b.min.y + height * 0.03;
    for (const m of meshes) {
      const pos = m.getVerticesData("position")!;
      const w = m.computeWorldMatrix(true);
      const v = new Vector3();
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v);
        if (v.y <= lowLimit) {
          sx += v.x;
          sz += v.z;
          n++;
        }
      }
    }
    const bx = n > 0 ? sx / n : (b.min.x + b.max.x) / 2;
    const bz = n > 0 ? sz / n : (b.min.z + b.max.z) / 2;
    const k = BASE_HEIGHT / height;
    const bake = Matrix.Translation(-bx, -b.min.y, -bz).multiply(Matrix.Scaling(k, k, k));

    const rng = new Rng(seed);
    const data = new Float32Array(placements.length * 16);
    const m4 = new Matrix();
    placements.forEach((p, i) => {
      const s = rng.range(0.85, 1.25);
      Matrix.ScalingToRef(s, s, s, m4);
      m4.multiplyToRef(Matrix.RotationY(rng.range(0, Math.PI * 2)), m4);
      m4.multiplyToRef(Matrix.Translation(p.x, p.y, p.z), m4);
      m4.copyToArray(data, i * 16);
    });

    for (const m of meshes) {
      m.setParent(null);
      m.bakeCurrentTransformIntoVertices();
      m.bakeTransformIntoVertices(bake);
      m.thinInstanceSetBuffer("matrix", data, 16, true);
      m.thinInstanceRefreshBoundingInfo(true);
      m.alwaysSelectAsActiveMesh = true; // el culling por malla no sirve con thin instances dispersas
      m.isPickable = false;
      m.receiveShadows = true;
      const mat = m.material;
      if (mat instanceof PBRMaterial) {
        mat.twoSidedLighting = true;
        mat.environmentIntensity = 0.9;
      }
    }
    root.dispose();
    const stats = meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0);
    console.info(`[Palmeras] ${placements.length} palmeras (${Math.round(stats)} triángulos cada una), altura base ${BASE_HEIGHT} m.`);
    return {
      meshes,
      dispose: () => meshes.forEach((m) => m.dispose(false, true)),
    };
  } catch (e) {
    console.error(`[Palmeras] ERROR: no se pudo importar ${url}. Se usan árboles procedurales de respaldo.`, e);
    return null;
  }
}
