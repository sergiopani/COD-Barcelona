import { AbstractMesh, Mesh, MeshBuilder, Scene } from "@babylonjs/core";
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
