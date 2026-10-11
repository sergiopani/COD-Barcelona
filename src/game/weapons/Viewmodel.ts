import { Camera, ImportMeshAsync, Matrix, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ASSETS } from "../config";
import { glbExists } from "../world/assetUtil";
import type { WeaponDefinition } from "./WeaponDefinition";

/**
 * Arma en primera persona (viewmodel). Se carga el GLB del rifle, se orienta (cañón hacia +Z, mira hacia +Y),
 * se escala a su longitud real y se cuelga de la cámara. Se dibuja en un grupo de renderizado propio con
 * el depth limpio, así nunca atraviesa paredes. Todas las animaciones son procedurales (sin esqueleto).
 */
export interface ViewmodelState {
  /** 0 = cadera, 1 = apuntando. */
  ads: number;
  /** Velocidad horizontal del jugador (m/s) y si corre. */
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  /** Progreso 0..1 del ciclo de cerrojo (o -1 si no está activo). */
  bolt: number;
  /** Progreso 0..1 de la recarga (o -1). */
  reload: number;
}

const HIP = new Vector3(0.17, -0.2, 0.46);
const ADS = new Vector3(0.0, -0.13, 0.34);

export class Viewmodel {
  readonly root: TransformNode;
  private model: TransformNode;
  private muzzleLocal = new Vector3(0, 0, 0.7);
  private loaded = false;
  private time = 0;
  private recoil = 0;
  private visible = true;
  private sprintBlend = 0;
  private readonly cur = new Vector3();

  constructor(private readonly scene: Scene, camera: Camera, private readonly def: WeaponDefinition) {
    this.root = new TransformNode("viewmodelRoot", scene);
    this.root.parent = camera;
    this.model = new TransformNode("viewmodelModel", scene);
    this.model.parent = this.root;
  }

  get isGlb(): boolean {
    return this.loaded;
  }

  async load(): Promise<boolean> {
    const url = ASSETS.rifleGlb;
    if (!(await glbExists(url))) {
      console.error(`[Arma] ERROR: no se encontró ${url}. Se usa un rifle provisional.`);
      this.buildFallback();
      return false;
    }
    try {
      const result = await ImportMeshAsync(url, this.scene);
      const holder = new TransformNode("rifleTemplate", this.scene);
      for (const n of result.meshes.filter((m) => !m.parent)) n.parent = holder;
      holder.computeWorldMatrix(true);
      const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);

      // Vértices en el espacio mundial del modelo importado
      const pts: Float32Array[] = meshes.map((m) => {
        const pos = m.getVerticesData("position")!;
        const w = m.computeWorldMatrix(true);
        const out = new Float32Array(pos.length);
        const v = new Vector3();
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v);
          out[i] = v.x;
          out[i + 1] = v.y;
          out[i + 2] = v.z;
        }
        return out;
      });
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const a of pts) {
        for (let i = 0; i < a.length; i += 3) {
          min.x = Math.min(min.x, a[i]);
          max.x = Math.max(max.x, a[i]);
          min.y = Math.min(min.y, a[i + 1]);
          max.y = Math.max(max.y, a[i + 1]);
          min.z = Math.min(min.z, a[i + 2]);
          max.z = Math.max(max.z, a[i + 2]);
        }
      }
      const ext = max.subtract(min);
      const longAxis = ext.x >= ext.z ? "x" : "z";
      const lo = longAxis === "x" ? min.x : min.z;
      const hi = longAxis === "x" ? max.x : max.z;
      // El extremo del cañón es el de menor sección transversal (la culata es gruesa)
      const slab = (hi - lo) * 0.08;
      const section = (atHi: boolean): number => {
        let a0 = Infinity,
          a1 = -Infinity,
          b0 = Infinity,
          b1 = -Infinity;
        for (const a of pts) {
          for (let i = 0; i < a.length; i += 3) {
            const c = longAxis === "x" ? a[i] : a[i + 2];
            if (atHi ? c < hi - slab : c > lo + slab) continue;
            const o1 = a[i + 1];
            const o2 = longAxis === "x" ? a[i + 2] : a[i];
            a0 = Math.min(a0, o1);
            a1 = Math.max(a1, o1);
            b0 = Math.min(b0, o2);
            b1 = Math.max(b1, o2);
          }
        }
        return (a1 - a0) * (b1 - b0);
      };
      const muzzleAtHi = section(true) < section(false);
      // Rotación que lleva el eje largo a +Z con el cañón hacia +Z
      let yaw = 0;
      if (longAxis === "x") yaw = muzzleAtHi ? -Math.PI / 2 : Math.PI / 2; // +X→+Z : -90°, -X→+Z : +90°
      else yaw = muzzleAtHi ? 0 : Math.PI;
      const rot = Matrix.RotationY(yaw);
      const s = this.def.modelLength / (hi - lo);

      // Caja envolvente ya girada para centrar y fijar el punto de agarre
      const rmin = new Vector3(Infinity, Infinity, Infinity);
      const rmax = new Vector3(-Infinity, -Infinity, -Infinity);
      const tmp = new Vector3();
      for (const a of pts) {
        for (let i = 0; i < a.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(a[i], a[i + 1], a[i + 2], rot, tmp);
          rmin.minimizeInPlace(tmp);
          rmax.maximizeInPlace(tmp);
        }
      }
      const gripZ = rmin.z + (rmax.z - rmin.z) * 0.42;
      const bake = rot.multiply(Matrix.Translation(-(rmin.x + rmax.x) / 2, -(rmin.y + rmax.y) / 2, -gripZ)).multiply(Matrix.Scaling(s, s, s));
      this.muzzleLocal.set(0, 0, (rmax.z - gripZ) * s);

      for (const m of meshes) {
        m.setParent(null);
        m.bakeCurrentTransformIntoVertices();
        m.bakeTransformIntoVertices(bake);
        m.parent = this.model;
        m.renderingGroupId = 1;
        m.receiveShadows = false;
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
        m.doNotSyncBoundingInfo = false;
        const mat = m.material;
        if (mat instanceof PBRMaterial) {
          mat.environmentIntensity = 1;
          for (const t of [mat.albedoTexture, mat.bumpTexture, mat.metallicTexture]) if (t) t.anisotropicFilteringLevel = 8;
        }
      }
      holder.dispose();
      this.loaded = true;
      const tris = meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0);
      console.info(
        `[Arma] ${this.def.name}: ${meshes.length} mallas, ${Math.round(tris).toLocaleString()} triángulos, eje largo ${longAxis}, ` +
          `cañón en el extremo ${muzzleAtHi ? "+" : "-"}, longitud ${this.def.modelLength} m.`,
      );
      return true;
    } catch (e) {
      console.error(`[Arma] ERROR: no se pudo importar ${url}. Se usa un rifle provisional.`, e);
      this.buildFallback();
      return false;
    }
  }

  /** Rifle provisional si el GLB falla. */
  private buildFallback(): void {
    const mat = new StandardMaterial("fallbackRifle", this.scene);
    mat.diffuseColor = new Color3(0.12, 0.12, 0.13);
    const mk = (m: Mesh) => {
      m.material = mat;
      m.parent = this.model;
      m.renderingGroupId = 1;
      m.isPickable = false;
    };
    const barrel = MeshBuilder.CreateCylinder("fbBarrel", { diameter: 0.03, height: 0.7, tessellation: 10 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.35);
    mk(barrel);
    const body = MeshBuilder.CreateBox("fbBody", { width: 0.05, height: 0.09, depth: 0.5 }, this.scene);
    body.position.set(0, 0, -0.1);
    mk(body);
    const stock = MeshBuilder.CreateBox("fbStock", { width: 0.04, height: 0.12, depth: 0.28 }, this.scene);
    stock.position.set(0, -0.03, -0.45);
    mk(stock);
    const scope = MeshBuilder.CreateCylinder("fbScope", { diameter: 0.045, height: 0.3, tessellation: 12 }, this.scene);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, 0);
    mk(scope);
    this.muzzleLocal.set(0, 0.02, 0.7);
    this.loaded = false;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.setEnabled(v);
  }

  /** Impulso de retroceso (0..1). */
  kick(strength = 1): void {
    this.recoil = Math.min(1.4, this.recoil + strength);
  }

  /** Posición del cañón en el mundo (para trazadoras y fogonazo). */
  getMuzzleWorld(): Vector3 {
    this.model.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(this.muzzleLocal, this.model.getWorldMatrix());
  }

  update(dt: number, st: ViewmodelState): void {
    this.time += dt;
    this.recoil *= Math.exp(-9 * dt);
    this.sprintBlend += ((st.sprinting && st.grounded ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 7);
    const sp = Math.min(1, st.speed / 5);
    const bobAmp = st.grounded ? sp * (1 - st.ads) : 0;
    const bt = this.time * (st.sprinting ? 11 : 8);

    // posición base: cadera → mira
    this.cur.copyFrom(HIP).scaleInPlace(1 - st.ads).addInPlace(ADS.scale(st.ads));
    let rx = 0;
    let ry = -0.035 * (1 - st.ads);
    let rz = 0;
    // respiración + paso
    this.cur.y += Math.sin(this.time * 1.5) * 0.0022 + Math.abs(Math.sin(bt)) * 0.012 * bobAmp;
    this.cur.x += Math.sin(bt * 0.5) * 0.008 * bobAmp;
    rz += Math.sin(bt * 0.5) * 0.02 * bobAmp;
    // correr: arma baja y cruzada
    this.cur.y -= 0.07 * this.sprintBlend;
    this.cur.x += 0.04 * this.sprintBlend;
    rx += 0.35 * this.sprintBlend;
    ry -= 0.3 * this.sprintBlend;
    // retroceso
    this.cur.z -= 0.075 * this.recoil;
    rx -= 0.14 * this.recoil;
    // cerrojo: giro de muñeca y retirada
    if (st.bolt >= 0) {
      const k = Math.sin(Math.min(1, st.bolt) * Math.PI);
      rz += 0.45 * k;
      this.cur.x -= 0.03 * k;
      this.cur.z -= 0.025 * k;
      rx -= 0.05 * k;
    }
    // recarga: baja, gira y vuelve
    if (st.reload >= 0) {
      const p = Math.min(1, st.reload);
      const k = Math.sin(p * Math.PI);
      const hold = Math.min(1, k * 2.2);
      this.cur.y -= 0.17 * hold;
      this.cur.x -= 0.05 * hold;
      rx += 0.55 * hold;
      rz += 0.7 * hold;
      // pequeños tirones (cargadores/clips)
      this.cur.y += Math.sin(p * 40) * 0.006 * hold;
    }
    this.root.position.copyFrom(this.cur);
    this.root.rotation.set(rx, ry, rz);
  }
}
