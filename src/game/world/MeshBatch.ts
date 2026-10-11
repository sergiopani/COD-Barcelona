import { Mesh, Scene, VertexData } from "@babylonjs/core";

export type RGBA = [number, number, number, number];
export type P3 = [number, number, number];

/**
 * Sistema de coordenadas local de un tramo de fachada (u = a lo largo, v = arriba,
 * w = hacia fuera, hacia la calle). Permite construir geometría alineada a cualquier
 * dirección en el plano XZ con valores simples.
 */
export class Frame {
  constructor(
    public ox: number,
    public oy: number,
    public oz: number,
    public ux: number,
    public uz: number,
    public nx: number,
    public nz: number,
  ) {}
  pt(u: number, v: number, w: number): P3 {
    return [this.ox + this.ux * u + this.nx * w, this.oy + v, this.oz + this.uz * u + this.nz * w];
  }
  /** Rotación Y (radianes) que lleva +X local a la dirección u. */
  get yaw(): number {
    return Math.atan2(-this.uz, this.ux);
  }
}

/** Caras de una caja que se pueden omitir. */
export const F = { UP: 1, DOWN: 2, FRONT: 4, BACK: 8, LEFT: 16, RIGHT: 32 } as const;

/**
 * Acumula geometría estática de un mismo material y la convierte en UNA malla.
 * Se usa en lugar de miles de mallas individuales para reducir draw calls.
 * Convención de caras de Babylon (mano izquierda): (b-a)×(c-a)·normal < 0.
 */
export class MeshBatch {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  /** Metros de mundo que equivalen a una repetición de textura. */
  constructor(public tileSize = 4) {}

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  addQuad(p: [P3, P3, P3, P3], normal: P3, uv: [number, number][], color: RGBA = [1, 1, 1, 1]): void {
    const [a, b, c] = p;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const dot = cx * normal[0] + cy * normal[1] + cz * normal[2];
    const order = dot < 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const base = this.vertexCount;
    for (const k of order) {
      this.positions.push(p[k][0], p[k][1], p[k][2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(uv[k][0], uv[k][1]);
      this.colors.push(color[0], color[1], color[2], color[3]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Desplazamiento de UV (en repeticiones de textura) para romper la repetición entre edificios. */
  uvOffset: [number, number] = [0, 0];

  /** Caja alineada con el Frame. (cu,cv,cw) = centro, (su,sv,sw) = tamaño. */
  addBox(
    f: Frame,
    cu: number,
    cv: number,
    cw: number,
    su: number,
    sv: number,
    sw: number,
    color: RGBA = [1, 1, 1, 1],
    skip = 0,
  ): void {
    const t = 1 / this.tileSize;
    const [ox, oy] = this.uvOffset;
    const UV = (a: number, b: number): [number, number] => [a * t + ox, b * t + oy];
    const u0 = cu - su / 2,
      u1 = cu + su / 2,
      v0 = cv - sv / 2,
      v1 = cv + sv / 2,
      w0 = cw - sw / 2,
      w1 = cw + sw / 2;
    const nU: P3 = [f.ux, 0, f.uz];
    const nW: P3 = [f.nx, 0, f.nz];
    if (!(skip & F.FRONT))
      this.addQuad([f.pt(u0, v0, w1), f.pt(u1, v0, w1), f.pt(u1, v1, w1), f.pt(u0, v1, w1)], nW, [UV(u0, v0), UV(u1, v0), UV(u1, v1), UV(u0, v1)], color);
    if (!(skip & F.BACK))
      this.addQuad([f.pt(u0, v0, w0), f.pt(u1, v0, w0), f.pt(u1, v1, w0), f.pt(u0, v1, w0)], [-nW[0], 0, -nW[2]], [UV(u0, v0), UV(u1, v0), UV(u1, v1), UV(u0, v1)], color);
    if (!(skip & F.RIGHT))
      this.addQuad([f.pt(u1, v0, w0), f.pt(u1, v0, w1), f.pt(u1, v1, w1), f.pt(u1, v1, w0)], nU, [UV(w0, v0), UV(w1, v0), UV(w1, v1), UV(w0, v1)], color);
    if (!(skip & F.LEFT))
      this.addQuad([f.pt(u0, v0, w0), f.pt(u0, v0, w1), f.pt(u0, v1, w1), f.pt(u0, v1, w0)], [-nU[0], 0, -nU[2]], [UV(w0, v0), UV(w1, v0), UV(w1, v1), UV(w0, v1)], color);
    if (!(skip & F.UP))
      this.addQuad([f.pt(u0, v1, w0), f.pt(u1, v1, w0), f.pt(u1, v1, w1), f.pt(u0, v1, w1)], [0, 1, 0], [UV(u0, w0), UV(u1, w0), UV(u1, w1), UV(u0, w1)], color);
    if (!(skip & F.DOWN))
      this.addQuad([f.pt(u0, v0, w0), f.pt(u1, v0, w0), f.pt(u1, v0, w1), f.pt(u0, v0, w1)], [0, -1, 0], [UV(u0, w0), UV(u1, w0), UV(u1, w1), UV(u0, w1)], color);
  }

  /** Panel vertical orientado hacia fuera con UV 0..1 (para texturas de ventana, persiana, reja…). */
  addPanel(f: Frame, u0: number, u1: number, v0: number, v1: number, w: number, color: RGBA = [1, 1, 1, 1], uvRepeat: [number, number] = [1, 1], uvRect?: [number, number, number, number]): void {
    // uvRect = [uMin, vMin, uMax, vMax] dentro de un atlas de texturas
    const [a0, b0, a1, b1] = uvRect ?? [0, 0, uvRepeat[0], uvRepeat[1]];
    this.addQuad(
      [f.pt(u0, v0, w), f.pt(u1, v0, w), f.pt(u1, v1, w), f.pt(u0, v1, w)],
      [f.nx, 0, f.nz],
      [[a0, b0], [a1, b0], [a1, b1], [a0, b1]],
      color,
    );
  }

  /** Panel horizontal (suelo/marcas viales) a altura y, rectángulo XZ con rotación. */
  addFlatRect(cx: number, y: number, cz: number, sx: number, sz: number, rotY: number, color: RGBA = [1, 1, 1, 1]): void {
    const c = Math.cos(rotY),
      s = Math.sin(rotY);
    const pt = (lx: number, lz: number): P3 => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const hx = sx / 2,
      hz = sz / 2;
    this.addQuad([pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
  }

  /** Cilindro/cono vertical (eje Y). */
  addCylinder(cx: number, y0: number, cz: number, rBottom: number, rTop: number, height: number, segs: number, color: RGBA = [1, 1, 1, 1], capTop = true, capBottom = false): void {
    const slope = (rBottom - rTop) / Math.max(height, 1e-6);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0),
        s0 = Math.sin(a0),
        c1 = Math.cos(a1),
        s1 = Math.sin(a1);
      const base = this.vertexCount;
      const pts: P3[] = [
        [cx + c0 * rBottom, y0, cz + s0 * rBottom],
        [cx + c1 * rBottom, y0, cz + s1 * rBottom],
        [cx + c1 * rTop, y0 + height, cz + s1 * rTop],
        [cx + c0 * rTop, y0 + height, cz + s0 * rTop],
      ];
      const ns: P3[] = [
        norm3([c0, slope, s0]),
        norm3([c1, slope, s1]),
        norm3([c1, slope, s1]),
        norm3([c0, slope, s0]),
      ];
      const uv = [[i / segs * 2, 0], [(i + 1) / segs * 2, 0], [(i + 1) / segs * 2, height * 0.25], [i / segs * 2, height * 0.25]];
      // orden de triángulos comprobado con el convenio de Babylon
      const mid: P3 = [(c0 + c1) / 2, slope, (s0 + s1) / 2];
      const e1 = sub3(pts[1], pts[0]);
      const e2 = sub3(pts[2], pts[0]);
      const cr = cross3(e1, e2);
      const flip = cr[0] * mid[0] + cr[1] * mid[1] + cr[2] * mid[2] > 0;
      const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
      for (const k of order) {
        this.positions.push(...pts[k]);
        this.normals.push(...ns[k]);
        this.uvs.push(uv[k][0], uv[k][1]);
        this.colors.push(...color);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (capTop && rTop > 0) this.addDisc(cx, y0 + height, cz, rTop, segs, 1, color);
    if (capBottom && rBottom > 0) this.addDisc(cx, y0, cz, rBottom, segs, -1, color);
  }

  addDisc(cx: number, y: number, cz: number, r: number, segs: number, dir: 1 | -1, color: RGBA): void {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const pts: P3[] = [
        [cx, y, cz],
        [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r],
        [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r],
      ];
      const e1 = sub3(pts[1], pts[0]);
      const e2 = sub3(pts[2], pts[0]);
      const cr = cross3(e1, e2);
      const flip = cr[1] * dir > 0;
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      const base = this.vertexCount;
      for (const k of order) {
        this.positions.push(...pts[k]);
        this.normals.push(0, dir, 0);
        this.uvs.push(0.5 + (pts[k][0] - cx) / (2 * r), 0.5 + (pts[k][2] - cz) / (2 * r));
        this.colors.push(...color);
      }
      this.indices.push(base, base + 1, base + 2);
    }
  }

  /** Esfera/elipsoide (copas de árboles, remates cerámicos). */
  addEllipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, segs: number, rings: number, color: RGBA = [1, 1, 1, 1]): void {
    const base0 = this.vertexCount;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      for (let s = 0; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(th);
        this.positions.push(cx + nx * rx, cy + ny * ry, cz + nz * rz);
        this.normals.push(nx, ny, nz);
        this.uvs.push(s / segs, r / rings);
        this.colors.push(...color);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = base0 + r * (segs + 1) + s;
        const b = a + segs + 1;
        // (a, b, a+1) tiene normal hacia fuera con el convenio de Babylon para esta parametrización
        this.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }

  /** Polígono convexo en el plano (u,v) del frame, extruido en w ∈ [w0,w1]. */
  addExtrudedPolygon(f: Frame, poly: [number, number][], w0: number, w1: number, color: RGBA = [1, 1, 1, 1]): void {
    const n = poly.length;
    const t = 1 / this.tileSize;
    // orientación del polígono (área con signo en u,v)
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % n];
      area += ax * by - bx * ay;
    }
    const ccw = area > 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const du = b[0] - a[0];
      const dv = b[1] - a[1];
      const len = Math.hypot(du, dv) || 1;
      // normal hacia fuera del polígono en (u,v)
      let nu = dv / len;
      let nv = -du / len;
      if (!ccw) {
        nu = -nu;
        nv = -nv;
      }
      const nWorld: P3 = [f.ux * nu, nv, f.uz * nu];
      this.addQuad(
        [f.pt(a[0], a[1], w0), f.pt(b[0], b[1], w0), f.pt(b[0], b[1], w1), f.pt(a[0], a[1], w1)],
        nWorld,
        [[0, 0], [len * t, 0], [len * t, (w1 - w0) * t], [0, (w1 - w0) * t]],
        color,
      );
    }
    // tapas (triángulos en abanico, polígono convexo)
    for (const [w, dir] of [[w1, 1], [w0, -1]] as const) {
      for (let i = 1; i < n - 1; i++) {
        const tri = [poly[0], poly[i], poly[i + 1]];
        const base = this.vertexCount;
        const P = tri.map((q) => f.pt(q[0], q[1], w));
        const e1 = sub3(P[1], P[0]);
        const e2 = sub3(P[2], P[0]);
        const cr = cross3(e1, e2);
        const nrm: P3 = [f.nx * dir, 0, f.nz * dir];
        const flip = cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] > 0;
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        for (const k of order) {
          this.positions.push(...P[k]);
          this.normals.push(...nrm);
          this.uvs.push(tri[k][0] * t, tri[k][1] * t);
          this.colors.push(...color);
        }
        this.indices.push(base, base + 1, base + 2);
      }
    }
  }

  /** Panel lateral (perpendicular a la fachada) en u fijo, entre w0..w1 y v0..v1. Doble cara en el material. */
  addSidePanel(f: Frame, u: number, w0: number, w1: number, v0: number, v1: number, color: RGBA = [1, 1, 1, 1], uvRepeat: [number, number] = [1, 1]): void {
    this.addQuad(
      [f.pt(u, v0, w0), f.pt(u, v0, w1), f.pt(u, v1, w1), f.pt(u, v1, w0)],
      [f.ux, 0, f.uz],
      [[0, 0], [uvRepeat[0], 0], [uvRepeat[0], uvRepeat[1]], [0, uvRepeat[1]]],
      color,
    );
  }

  /** Triángulo suelto con normal explícita (suelos poligonales). */
  addTriangle(p: [P3, P3, P3], normal: P3, uv: [number, number][], color: RGBA = [1, 1, 1, 1]): void {
    const e1 = sub3(p[1], p[0]);
    const e2 = sub3(p[2], p[0]);
    const cr = cross3(e1, e2);
    const dot = cr[0] * normal[0] + cr[1] * normal[1] + cr[2] * normal[2];
    const order = dot < 0 ? [0, 1, 2] : [0, 2, 1];
    const base = this.vertexCount;
    for (const k of order) {
      this.positions.push(...p[k]);
      this.normals.push(...normal);
      this.uvs.push(uv[k][0], uv[k][1]);
      this.colors.push(...color);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  toMesh(name: string, scene: Scene): Mesh | null {
    if (this.indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.applyToMesh(mesh);
    return mesh;
  }
}

function sub3(a: P3, b: P3): P3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a: P3): P3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Conjunto de lotes por (chunk, material); cada chunk es una zona espacial para el culling. */
export class BatchSet {
  private readonly batches = new Map<string, { chunk: string; key: string; batch: MeshBatch }>();
  constructor(private readonly tile: Record<string, number>) {}

  get(chunk: string, key: string): MeshBatch {
    const id = chunk + "|" + key;
    let e = this.batches.get(id);
    if (!e) {
      e = { chunk, key, batch: new MeshBatch(this.tile[key] ?? 1) };
      this.batches.set(id, e);
    }
    return e.batch;
  }

  /** Construye todas las mallas y devuelve (malla, clave de material, chunk). */
  build(scene: Scene, prefix: string): { mesh: Mesh; key: string; chunk: string }[] {
    const out: { mesh: Mesh; key: string; chunk: string }[] = [];
    for (const { chunk, key, batch } of this.batches.values()) {
      const mesh = batch.toMesh(`${prefix}_${chunk}_${key}`, scene);
      if (mesh) out.push({ mesh, key, chunk });
    }
    return out;
  }

  get totalVertices(): number {
    let n = 0;
    for (const e of this.batches.values()) n += e.batch.vertexCount;
    return n;
  }
}
