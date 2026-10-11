import { ImportMeshAsync, Matrix, Mesh, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ASSETS } from "../config";
import { Rng } from "../util/rng";
import { glbExists } from "./assetUtil";

/**
 * Coches aparcados a partir de public/assets/props/car-pack.glb (10 modelos genéricos en una sola escena).
 * Cada coche se separa del pack (carrocería + cristal + ópticas + 4 ruedas), se orienta (largo en +X),
 * se escala a su longitud real aproximada y se dibuja con thin instances: 1 draw call por parte y modelo.
 */
export interface VehicleType {
  name: string;
  /** Dimensiones tras escalar (m): largo (X), alto (Y), ancho (Z). */
  size: { x: number; y: number; z: number };
  parts: Mesh[];
  /** Cuenta de instancias colocadas. */
  count: number;
}

/** Longitud real aproximada por modelo (m). La clave es el nombre del nodo de carrocería en minúsculas. */
const LENGTHS: Record<string, number> = {
  compact: 3.8,
  coupe: 4.4,
  hatchback: 4.0,
  minivan: 4.9,
  offroad: 4.4,
  pickup: 5.2,
  sedan: 4.7,
  sport: 4.3,
  suv: 4.7,
  wagon: 4.8,
};

/** Modelos usados para cada tipo de prop (coche normal vs furgoneta/pick-up). */
const CAR_TYPES = ["compact", "coupe", "hatchback", "offroad", "sedan", "sport", "suv", "wagon"];
const VAN_TYPES = ["minivan", "pickup", "suv"];

export interface VehiclePlacement {
  type: string;
  x: number;
  z: number;
  /** Dirección "hacia delante" del coche en planta (se normaliza). */
  ux: number;
  uz: number;
}

export class VehicleLibrary {
  constructor(readonly types: Map<string, VehicleType>, private readonly scene: Scene) {}

  /** Elige un modelo de forma determinista según la variante del prop. */
  pick(kind: "car" | "van", variant: number): string {
    const list = (kind === "van" ? VAN_TYPES : CAR_TYPES).filter((t) => this.types.has(t));
    return list[variant % list.length];
  }

  size(type: string): { x: number; y: number; z: number } {
    return this.types.get(type)!.size;
  }

  /** Coloca todas las instancias (una sola vez) con thin instances. */
  place(placements: VehiclePlacement[], seed = 5): void {
    const rng = new Rng(seed);
    const byType = new Map<string, Float32Array[]>();
    const m = new Matrix();
    for (const p of placements) {
      const t = this.types.get(p.type);
      if (!t) continue;
      const l = Math.hypot(p.ux, p.uz) || 1;
      // yaw que lleva +X local hacia (ux,uz); la mitad de los coches se aparcan mirando al revés
      let yaw = Math.atan2(-p.uz / l, p.ux / l);
      if (rng.chance(0.5)) yaw += Math.PI;
      Matrix.RotationYToRef(yaw, m);
      m.setTranslation(new Vector3(p.x, 0, p.z));
      const arr = new Float32Array(16);
      m.copyToArray(arr);
      (byType.get(p.type) ?? byType.set(p.type, []).get(p.type)!).push(arr);
    }
    for (const [name, list] of byType) {
      const t = this.types.get(name)!;
      const data = new Float32Array(list.length * 16);
      list.forEach((a, i) => data.set(a, i * 16));
      for (const mesh of t.parts) {
        mesh.thinInstanceSetBuffer("matrix", data, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(true);
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.setEnabled(true);
      }
      t.count = list.length;
    }
    // tipos sin instancias: no se dibujan
    for (const t of this.types.values()) if (t.count === 0) t.parts.forEach((p) => p.setEnabled(false));
    void this.scene;
  }

  dispose(): void {
    for (const t of this.types.values()) t.parts.forEach((p) => p.dispose(false, true));
  }
}

interface Part {
  mesh: Mesh;
  min: Vector3;
  max: Vector3;
  center: Vector3;
}

/** Posiciones de los vértices en el espacio mundial. */
function worldVertices(mesh: Mesh): Float32Array {
  const pos = mesh.getVerticesData("position")!;
  const w = mesh.computeWorldMatrix(true);
  const out = new Float32Array(pos.length);
  const v = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return out;
}

function worldBounds(mesh: Mesh): Part {
  mesh.computeWorldMatrix(true);
  const bi = mesh.getBoundingInfo();
  const min = bi.boundingBox.minimumWorld.clone();
  const max = bi.boundingBox.maximumWorld.clone();
  return { mesh, min, max, center: Vector3.Center(min, max) };
}

export async function loadVehicles(scene: Scene): Promise<VehicleLibrary | null> {
  const url = ASSETS.carPackGlb;
  if (!(await glbExists(url))) {
    console.error(`[Coches] ERROR: no se encontró ${url}. Se usan coches procedurales de respaldo.`);
    return null;
  }
  try {
    const result = await ImportMeshAsync(url, scene);
    const root = new TransformNode("carPackRoot", scene);
    for (const n of result.meshes.filter((m) => !m.parent)) n.parent = root;
    root.computeWorldMatrix(true);
    const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    const parts = meshes.map(worldBounds);

    const bodies = parts.filter((p) => /body_body_0$/i.test(p.mesh.name) && !/^wheel/i.test(p.mesh.name));
    const wheels = parts.filter((p) => /^wheel/i.test(p.mesh.name) && !/_body_0$/i.test(p.mesh.name));
    const leftovers = new Set(parts);

    // Asignar las ruedas al coche más cercano (4 por coche)
    const wheelOwner = new Map<Part, Part>();
    const ownerCount = new Map<Part, number>();
    const pairs: { w: Part; b: Part; d: number }[] = [];
    for (const w of wheels) for (const b of bodies) pairs.push({ w, b, d: Math.hypot(w.center.x - b.center.x, w.center.z - b.center.z) });
    pairs.sort((a, b) => a.d - b.d);
    for (const { w, b } of pairs) {
      if (wheelOwner.has(w) || (ownerCount.get(b) ?? 0) >= 4) continue;
      wheelOwner.set(w, b);
      ownerCount.set(b, (ownerCount.get(b) ?? 0) + 1);
    }

    const types = new Map<string, VehicleType>();
    for (const body of bodies) {
      const nodeName = (body.mesh.parent?.name ?? body.mesh.name).toLowerCase();
      const key = Object.keys(LENGTHS).find((k) => nodeName.startsWith(k));
      if (!key) continue;
      const siblings = parts.filter((p) => p.mesh.parent === body.mesh.parent && p !== body);
      const glass = siblings.find((p) => /glass/i.test(p.mesh.name));
      const optics = siblings.find((p) => /optics/i.test(p.mesh.name));
      const myWheels = wheels.filter((w) => wheelOwner.get(w) === body);
      if (myWheels.length === 0) {
        console.warn(`[Coches] ${key}: sin ruedas asignadas`);
      }
      const group = [body, glass, optics, ...myWheels].filter((p): p is Part => !!p);
      for (const g of group) leftovers.delete(g);

      // Cada coche del pack está girado un ángulo arbitrario: se busca el giro que minimiza el área de la
      // caja envolvente de su carrocería (en planta) y se deja el lado largo a lo largo de +X.
      const bodyPts = worldVertices(body.mesh);
      let bestAngle = 0;
      let bestArea = Infinity;
      for (let deg = 0; deg < 90; deg += 0.5) {
        const a = (deg * Math.PI) / 180;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        let x0 = Infinity,
          x1 = -Infinity,
          z0 = Infinity,
          z1 = -Infinity;
        for (let i = 0; i < bodyPts.length; i += 3) {
          const rx = bodyPts[i] * c + bodyPts[i + 2] * sn;
          const rz = -bodyPts[i] * sn + bodyPts[i + 2] * c;
          if (rx < x0) x0 = rx;
          if (rx > x1) x1 = rx;
          if (rz < z0) z0 = rz;
          if (rz > z1) z1 = rz;
        }
        const area = (x1 - x0) * (z1 - z0);
        if (area < bestArea) {
          bestArea = area;
          bestAngle = a;
        }
      }
      // ¿el lado largo quedó en Z? → un giro adicional de 90°
      {
        const c = Math.cos(bestAngle);
        const sn = Math.sin(bestAngle);
        let x0 = Infinity,
          x1 = -Infinity,
          z0 = Infinity,
          z1 = -Infinity;
        for (let i = 0; i < bodyPts.length; i += 3) {
          const rx = bodyPts[i] * c + bodyPts[i + 2] * sn;
          const rz = -bodyPts[i] * sn + bodyPts[i + 2] * c;
          x0 = Math.min(x0, rx);
          x1 = Math.max(x1, rx);
          z0 = Math.min(z0, rz);
          z1 = Math.max(z1, rz);
        }
        if (x1 - x0 < z1 - z0) bestAngle += Math.PI / 2;
      }
      const rot = Matrix.RotationY(bestAngle);

      // Caja envolvente del coche completo (carrocería + ruedas) en el sistema ya girado
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      const tmp = new Vector3();
      for (const g of group) {
        const pts = worldVertices(g.mesh);
        for (let i = 0; i < pts.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pts[i], pts[i + 1], pts[i + 2], rot, tmp);
          min.minimizeInPlace(tmp);
          max.maximizeInPlace(tmp);
        }
      }
      const dx = max.x - min.x;
      const dz = max.z - min.z;
      const s = LENGTHS[key] / dx;
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;
      // giro → traslada al origen (apoyado en y=0) → escala a metros
      const bake = rot.multiply(Matrix.Translation(-cx, -min.y, -cz)).multiply(Matrix.Scaling(s, s, s));

      const bakeMesh = (m: Mesh): void => {
        m.setParent(null);
        m.bakeCurrentTransformIntoVertices();
        m.bakeTransformIntoVertices(bake);
      };
      for (const g of group) bakeMesh(g.mesh);

      let wheelMesh: Mesh | null = null;
      if (myWheels.length > 1) {
        wheelMesh = Mesh.MergeMeshes(myWheels.map((w) => w.mesh), true, true, undefined, false, false);
      } else if (myWheels.length === 1) {
        wheelMesh = myWheels[0].mesh;
      }
      const finalParts = [body.mesh, glass?.mesh, optics?.mesh, wheelMesh].filter((m): m is Mesh => !!m);
      for (const m of finalParts) {
        m.isPickable = false;
        m.receiveShadows = true;
        m.thinInstanceSetBuffer("matrix", new Float32Array(0), 16, true);
        m.setEnabled(false);
        const mat = m.material;
        if (mat instanceof PBRMaterial) {
          mat.environmentIntensity = 1;
          // Cristal: opaco, oscuro y reflectante (evita problemas de orden de transparencias con thin instances)
          if (/glass/i.test(mat.name)) {
            mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
            mat.alpha = 1;
            mat.albedoColor.set(0.02, 0.025, 0.03);
            mat.metallic = 0.3;
            mat.roughness = 0.05;
          }
          for (const t of [mat.albedoTexture, mat.bumpTexture, mat.metallicTexture]) if (t) t.anisotropicFilteringLevel = 8;
        }
      }
      const size = { x: LENGTHS[key], y: (max.y - min.y) * s, z: dz * s };
      types.set(key, { name: key, size, parts: finalParts, count: 0 });
    }
    // Todo lo que no pertenece a un coche del pack (piezas sueltas) se descarta
    for (const p of leftovers) p.mesh.dispose(false, true);
    root.dispose();
    const tris = [...types.values()].reduce((a, t) => a + t.parts.reduce((b, m) => b + m.getTotalIndices() / 3, 0), 0);
    console.info(
      `[Coches] ${types.size} modelos cargados (${Math.round(tris / types.size)} triángulos de media): ` +
        [...types.values()].map((t) => `${t.name} ${t.size.x.toFixed(1)}×${t.size.z.toFixed(1)}×${t.size.y.toFixed(1)}`).join(", "),
    );
    return new VehicleLibrary(types, scene);
  } catch (e) {
    console.error(`[Coches] ERROR: no se pudo importar ${url}. Se usan coches procedurales de respaldo.`, e);
    return null;
  }
}

