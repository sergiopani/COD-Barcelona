import { AbstractMesh, Matrix, Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import type { Seg } from "./mapLayout";

/**
 * Registro de colisiones. La geometría visual y la física están separadas: todo lo sólido
 * del mapa se representa con cajas invisibles muy sencillas (o con suelos planos).
 * Se usa el motor de colisiones de Babylon (elipsoide + moveWithCollisions).
 */
export class CollisionManager {
  readonly colliders: AbstractMesh[] = [];
  private counter = 0;

  constructor(private readonly scene: Scene) {
    scene.collisionsEnabled = true;
  }

  /** Caja invisible. (cx,cy,cz) = centro; rotY en radianes (convención Babylon). */
  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, tag = "solid"): Mesh {
    const m = MeshBuilder.CreateBox(`col_${tag}_${this.counter++}`, { width: sx, height: sy, depth: sz }, this.scene);
    m.position.set(cx, cy, cz);
    m.rotation.y = rotY;
    this.register(m, tag);
    return m;
  }

  /** Muro que sigue un segmento de fachada hacia dentro del edificio (`depth` metros). */
  addSegmentWall(seg: Seg, depth: number, height: number, tag = "building"): Mesh {
    const cx = (seg.a.x + seg.b.x) / 2 - (seg.nx * depth) / 2;
    const cz = (seg.a.z + seg.b.z) / 2 - (seg.nz * depth) / 2;
    return this.addBox(cx, height / 2, cz, seg.len, height, depth, Math.atan2(-seg.uz, seg.ux), tag);
  }

  /** Marca una malla visual simple (suelos) como colisionable. */
  addMesh(mesh: AbstractMesh, tag = "ground"): void {
    this.register(mesh, tag);
  }

  private register(m: AbstractMesh, tag: string): void {
    m.checkCollisions = true;
    m.isPickable = false;
    m.metadata = { collider: true, tag };
    if (tag !== "ground") m.isVisible = false;
    m.freezeWorldMatrix();
    this.colliders.push(m);
  }

  private solids: { cx: number; cz: number; rad: number; hx: number; hy: number; hz: number; cy: number; world: Matrix; inv: Matrix }[] | null = null;

  /**
   * Red de seguridad anti-atravesado: el motor de elipsoides de Babylon puede dejar entrar al jugador unos
   * centímetros en una caja si se salta contra su arista superior. Tras cada movimiento se comprueba el
   * cilindro del jugador contra las cajas sólidas (en espacio local de cada caja) y, si se solapa, se le
   * expulsa por el eje de menor penetración. Si los pies están por encima de la tapa de la caja se permite
   * (el jugador puede subirse a una caja baja).
   */
  depenetrate(pos: Vector3, radius: number, height: number): boolean {
    if (!this.solids) {
      this.solids = [];
      for (const m of this.colliders) {
        if (m.metadata?.tag === "ground") continue;
        const bb = m.getBoundingInfo().boundingBox;
        const c = bb.centerWorld;
        const half = bb.extendSize;
        this.solids.push({
          cx: c.x,
          cz: c.z,
          cy: c.y,
          rad: Math.hypot(half.x, half.z) + radius + 0.5,
          hx: half.x,
          hy: half.y,
          hz: half.z,
          world: m.getWorldMatrix().clone(),
          inv: m.getWorldMatrix().clone().invert(),
        });
      }
    }
    let moved = false;
    const local = new Vector3();
    const push = new Vector3();
    for (const b of this.solids) {
      if (Math.abs(pos.x - b.cx) > b.rad || Math.abs(pos.z - b.cz) > b.rad) continue;
      Vector3.TransformCoordinatesFromFloatsToRef(pos.x, pos.y, pos.z, b.inv, local);
      const top = b.cy + b.hy; // los colliders no están rotados en vertical: la altura local = la mundial
      const bottom = b.cy - b.hy;
      if (pos.y >= top - 0.05 || pos.y + height <= bottom + 0.02) continue; // por encima o por debajo
      const px = b.hx + radius - Math.abs(local.x);
      const pz = b.hz + radius - Math.abs(local.z);
      if (px <= 0.005 || pz <= 0.005) continue; // no solapa en planta
      // expulsa por el eje de menor penetración
      if (px < pz) push.set(Math.sign(local.x || 1) * px, 0, 0);
      else push.set(0, 0, Math.sign(local.z || 1) * pz);
      Vector3.TransformNormalToRef(push, b.world, push);
      pos.x += push.x;
      pos.z += push.z;
      moved = true;
    }
    return moved;
  }

  /** Muros invisibles de seguridad alrededor de todo el mundo jugable. */
  addWorldBounds(half: number): void {
    const t = 4;
    const h = 200;
    this.addBox(0, h / 2, half + t / 2, 2 * half + 2 * t, h, t, 0, "bounds");
    this.addBox(0, h / 2, -half - t / 2, 2 * half + 2 * t, h, t, 0, "bounds");
    this.addBox(half + t / 2, h / 2, 0, t, h, 2 * half, 0, "bounds");
    this.addBox(-half - t / 2, h / 2, 0, t, h, 2 * half, 0, "bounds");
  }
}
