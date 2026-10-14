import { Color3, ImportMeshAsync, Mesh, PBRMaterial, Scene, TransformNode } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { assetUrl } from "../assets";
import { glbExists } from "./assetUtil";

/**
 * Decorado: la ciudad REAL de Barcelona (fotogrametría de ~1,4 × 1,4 km) alrededor del mapa jugable. El modelo se prepara con
 * scripts/build-city-backdrop.mjs: alineado con el mapa (manzana de la basílica en el origen), con un hueco donde está el mapa jugable,
 * sin normales y con texturas de 512². Se dibuja SIN luz (la foto ya lleva la iluminación incorporada) y con niebla, sin sombras ni colisión.
 */
const URL = assetUrl("assets/city/barcelona-backdrop.glb");
/** La canalización HDR del juego expone mucho más que una foto LDR: las texturas se atenúan (como el cielo con foto). */
const EXPOSURE = 0.2;

export interface CityBackdrop {
  setEnabled(on: boolean): void;
  dispose(): void;
}

export async function loadCityBackdrop(scene: Scene): Promise<CityBackdrop | null> {
  if (!(await glbExists(URL))) {
    console.warn(`[Ciudad] No se encontró ${URL}: sin decorado (npm run build:city).`);
    return null;
  }
  try {
    const result = await ImportMeshAsync(URL, scene);
    const root = new TransformNode("cityBackdrop", scene);
    for (const n of result.meshes.filter((m) => !m.parent)) n.parent = root;
    root.rotation.y = Math.PI; // el script deja el modelo en el frame glTF (x este, z abajo); el cargador de Babylon lo gira 180°
    let tris = 0;
    const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const m of meshes) {
      m.isPickable = false;
      m.receiveShadows = false;
      m.checkCollisions = false;
      const mat = m.material;
      if (mat instanceof PBRMaterial) {
        mat.unlit = true;
        mat.albedoColor = new Color3(EXPOSURE, EXPOSURE, EXPOSURE);
        mat.backFaceCulling = true;
        mat.freeze();
      }
      tris += m.getTotalIndices() / 3;
      m.freezeWorldMatrix();
    }
    console.info(`[Ciudad] Decorado cargado: ${meshes.length} teselas, ${Math.round(tris).toLocaleString()} triángulos.`);
    return {
      setEnabled: (on) => root.setEnabled(on),
      dispose: () => {
        meshes.forEach((m) => m.dispose(false, true));
        root.dispose();
      },
    };
  } catch (e) {
    console.error("[Ciudad] No se pudo cargar el decorado:", e);
    return null;
  }
}
