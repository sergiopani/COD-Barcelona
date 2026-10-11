import { assetUrl } from "../assets";
import type { Frame, MeshBatch, RGBA } from "./MeshBatch";

/**
 * Fachada de la Casa Batlló como "relieve": la elevación frontal del modelo (1,9 M de triángulos) está horneada en una
 * textura con silueta alfa (4 paletas) y un mapa de profundidad grueso (scripts/bake-batllo.mjs). Aquí se genera la malla
 * (~5 k triángulos por edificio) desplazando una rejilla según esa profundidad, de modo que los balcones "huesudos"
 * sobresalen de verdad. Cada edificio varía en paleta, espejo, remate (tejado completo o cornisa), proporciones y brillo.
 */
export interface BatlloRelief {
  gx: number;
  gy: number;
  aspect: number;
  uMin: number;
  uMax: number;
  vGround: number;
  vRoof: number;
  depth: number[];
  cover: number[];
}

export const BATLLO_VARIANTS = 4;
export const batlloKey = (i: number): string => `batllo${i}`;
export const BATLLO_TEXTURES = Array.from({ length: BATLLO_VARIANTS }, (_, i) => assetUrl(`assets/buildings/casa-batllo-${i}.webp`));

let relief: BatlloRelief | null = null;

/** Carga el mapa de relieve. Si falta, los edificios usan los módulos procedurales de siempre. */
export async function loadBatlloRelief(): Promise<boolean> {
  try {
    const res = await fetch(assetUrl("assets/buildings/casa-batllo-relief.json"));
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`HTTP ${res.status}`);
    relief = (await res.json()) as BatlloRelief;
    return true;
  } catch (e) {
    console.warn("[CasaBatlló] Sin relieve (casa-batllo-relief.json): se usan las fachadas procedurales.", e);
    relief = null;
    return false;
  }
}

export const hasBatllo = (): boolean => relief !== null;

export interface BatlloOptions {
  variant: number;
  mirror: boolean;
  /** true: tejado completo (dragón + torre); false: se corta bajo el tejado y se remata con cornisa procedural. */
  fullRoof: boolean;
  tint: RGBA;
}

/** Altura (v de textura, 0 = arriba) donde termina la pared de mosaico y empieza el tejado. */
export const BATLLO_WALL_TOP_V = 0.3;

/**
 * Añade el relieve al lote. `y0` = base (techo de la planta baja procedural), `yTop` = altura de la cresta del relieve.
 * Devuelve la altura (y) hasta la que debe llegar la masa de pared que hay detrás.
 */
export function addBatlloFacade(batch: MeshBatch, f: Frame, width: number, y0: number, yTop: number, o: BatlloOptions): number {
  const r = relief!;
  const vTop = o.fullRoof ? 0 : r.vRoof;
  const vBot = r.vGround;
  const du = r.uMax - r.uMin;
  const nx = Math.max(8, Math.round(r.gx * du));
  const ny = Math.max(8, Math.round(r.gy * (vBot - vTop)));
  const yOf = (v: number): number => y0 + ((vBot - v) / (vBot - vTop)) * (yTop - y0);
  const depthScale = (width / du) * 0.75; // metros por unidad de relieve (atenuado: los balcones no invaden tanto la acera)
  const w0 = 0.5; // la fachada queda adelantada: las zonas hundidas (ventanas) no deben quedar detrás de la masa de pared

  const sample = (ut: number, vt: number): number => {
    const gxF = ut * r.gx, gyF = vt * r.gy;
    const i = Math.min(r.gx - 1, Math.max(0, Math.floor(gxF))), j = Math.min(r.gy - 1, Math.max(0, Math.floor(gyF)));
    const fx = gxF - i, fy = gyF - j;
    const d = (a: number, b: number): number => r.depth[b * (r.gx + 1) + a];
    const v = (d(i, j) * (1 - fx) + d(i + 1, j) * fx) * (1 - fy) + (d(i, j + 1) * (1 - fx) + d(i + 1, j + 1) * fx) * fy;
    return vt > BATLLO_WALL_TOP_V ? Math.max(v, -0.035) : v; // el tejado sí puede retroceder
  };

  const cols = nx + 1;
  const base = batch.vertexCount;
  const pos: [number, number, number][] = [];
  for (let j = 0; j <= ny; j++) {
    for (let k = 0; k <= nx; k++) {
      const s = k / nx;
      const ut = r.uMin + du * (o.mirror ? 1 - s : s);
      const vt = vTop + (vBot - vTop) * (j / ny);
      pos.push(f.pt(s * width, yOf(vt), w0 + sample(ut, vt) * depthScale)); // el Frame de los edificios tiene oy = 0
    }
  }

  const at = (k: number, j: number) => pos[Math.min(ny, Math.max(0, j)) * cols + Math.min(nx, Math.max(0, k))];
  for (let j = 0; j <= ny; j++) {
    for (let k = 0; k <= nx; k++) {
      const p = pos[j * cols + k];
      const a = at(k + 1, j), b = at(k - 1, j), c = at(k, j - 1), d = at(k, j + 1);
      // tangentes en la rejilla → normal (apunta hacia fuera de la fachada)
      const tu: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const tv: [number, number, number] = [c[0] - d[0], c[1] - d[1], c[2] - d[2]]; // hacia arriba
      let n: [number, number, number] = [tu[1] * tv[2] - tu[2] * tv[1], tu[2] * tv[0] - tu[0] * tv[2], tu[0] * tv[1] - tu[1] * tv[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (n[0] * f.nx + n[2] * f.nz < 0) n = [-n[0], -n[1], -n[2]];
      const s = k / nx;
      const ut = r.uMin + du * (o.mirror ? 1 - s : s);
      const vt = vTop + (vBot - vTop) * (j / ny);
      batch.positions.push(p[0], p[1], p[2]);
      batch.normals.push(n[0], n[1], n[2]);
      batch.uvs.push(ut, 1 - vt);
      batch.colors.push(o.tint[0], o.tint[1], o.tint[2], 1);
    }
  }
  const nrm: [number, number] = [f.nx, f.nz];
  const emit = (a: number, b: number, c: number): void => {
    const pa = pos[a], pb = pos[b], pc = pos[c];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0];
    // convención de Babylon (mano izquierda): (b-a)×(c-a)·normal < 0 → orden directo
    const dot = cx * nrm[0] + cz * nrm[1];
    if (dot < 0) batch.indices.push(base + a, base + b, base + c);
    else batch.indices.push(base + a, base + c, base + b);
  };
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nx; k++) {
      // se omiten las celdas totalmente fuera de la silueta
      const s0 = k / nx, s1 = (k + 1) / nx;
      const u0 = r.uMin + du * (o.mirror ? 1 - s1 : s0), u1 = r.uMin + du * (o.mirror ? 1 - s0 : s1);
      const v0 = vTop + (vBot - vTop) * (j / ny), v1 = vTop + (vBot - vTop) * ((j + 1) / ny);
      const cc = r.cover[Math.min(r.gy - 1, Math.floor(((v0 + v1) / 2) * r.gy)) * r.gx + Math.min(r.gx - 1, Math.floor(((u0 + u1) / 2) * r.gx))];
      if (cc < 0.02) continue;
      const a = j * cols + k, b = a + 1, c = a + cols, d = c + 1;
      emit(a, c, b);
      emit(b, c, d);
    }
  }
  return yOf(BATLLO_WALL_TOP_V);
}
