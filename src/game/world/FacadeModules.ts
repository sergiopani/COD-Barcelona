import { type BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import { Rng } from "../util/rng";
import { NUM_ATLAS, SIGN_ATLAS, SIGN_NAMES } from "./Materials";

/**
 * Módulos arquitectónicos de fachada (ventanas, balcones, persianas, escaparates, portales…).
 * Cada módulo recibe un Frame local (u a lo largo de la fachada, v hacia arriba, w hacia la calle)
 * y escribe geometría en los lotes de material del chunk. Son piezas independientes: un edificio
 * detallado en GLB puede sustituir a todo un edificio sin tocar el resto.
 */

export interface FacadeCtx {
  set: BatchSet;
  chunk: string;
  f: Frame;
  rng: Rng;
  wall: RGBA;
  trim: RGBA;
  shutterTint: RGBA;
}

const mul = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, 1];
const STONE_LIGHT: RGBA = [1.05, 1.0, 0.92, 1];

/** Ventana rectangular enmarcada con cristal, travesaño y parteluz. Centro en u, base en v0. */
export function windowRect(c: FacadeCtx, u: number, v0: number, w: number, h: number, opts: { mullion?: boolean; sill?: boolean; lintel?: boolean; curtain?: boolean } = {}): void {
  const { set, chunk, f, rng } = c;
  const trim = set.get(chunk, "stucco");
  const glass = set.get(chunk, "glass");
  const frameT = 0.1;
  const proj = 0.09;
  // marco (4 cajas) con reveal visible
  trim.addBox(f, u - w / 2 - frameT / 2, v0 + h / 2, proj / 2, frameT, h + frameT * 2, proj, c.trim, F.BACK | F.DOWN);
  trim.addBox(f, u + w / 2 + frameT / 2, v0 + h / 2, proj / 2, frameT, h + frameT * 2, proj, c.trim, F.BACK | F.DOWN);
  trim.addBox(f, u, v0 - frameT / 2, proj / 2, w, frameT, proj, c.trim, F.BACK | F.DOWN);
  trim.addBox(f, u, v0 + h + frameT / 2, proj / 2, w, frameT, proj, c.trim, F.BACK | F.DOWN);
  // cristal (algunas ventanas con cortina clara para variar)
  const k = 0.75 + rng.next() * 0.6;
  const cur = opts.curtain ?? rng.chance(0.25);
  const gc: RGBA = cur ? [2.4 + rng.next(), 2.1 + rng.next(), 1.7 + rng.next() * 0.6, 1] : [k, k, k, 1];
  glass.addPanel(f, u - w / 2, u + w / 2, v0, v0 + h, 0.02, gc);
  if (opts.mullion !== false) {
    const plain = set.get(chunk, "plain");
    plain.addBox(f, u, v0 + h / 2, 0.05, 0.045, h, 0.03, [0.92, 0.9, 0.85, 1], F.BACK | F.DOWN);
    plain.addBox(f, u, v0 + h * 0.72, 0.05, w, 0.04, 0.03, [0.92, 0.9, 0.85, 1], F.BACK | F.DOWN);
  }
  if (opts.sill) {
    const stone = set.get(chunk, "stone");
    stone.addBox(f, u, v0 - frameT - 0.04, 0.11, w + 0.5, 0.08, 0.22, STONE_LIGHT, F.BACK);
  }
  if (opts.lintel) {
    const stone = set.get(chunk, "stone");
    stone.addBox(f, u, v0 + h + frameT + 0.1, 0.09, w + 0.5, 0.2, 0.18, STONE_LIGHT, F.BACK | F.DOWN);
  }
}

/** Ventana con arco de medio punto (polígono convexo): marco en losa + cristal por delante. */
export function windowArched(c: FacadeCtx, u: number, v0: number, w: number, h: number): void {
  const { set, chunk, f, rng } = c;
  const stucco = set.get(chunk, "stucco");
  const glass = set.get(chunk, "glass");
  const r = w / 2;
  const pts = (rr: number, base: number, top: number): [number, number][] => {
    const p: [number, number][] = [[u - rr, base], [u + rr, base]];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      p.push([u + Math.cos(a) * rr, top + Math.sin(a) * rr]);
    }
    return p;
  };
  stucco.addExtrudedPolygon(f, pts(r + 0.14, v0 - 0.14, v0 + h - r), 0, 0.08, c.trim);
  const k = 0.75 + rng.next() * 0.5;
  glass.addExtrudedPolygon(f, pts(r, v0, v0 + h - r), 0.05, 0.09, [k, k, k, 1]);
  const plain = set.get(chunk, "plain");
  plain.addBox(f, u, v0 + (h - r) / 2, 0.11, 0.045, h - r, 0.03, [0.92, 0.9, 0.85, 1], F.BACK | F.DOWN);
}

/** Balcón individual: losa de piedra, reja de forja en frente y laterales. */
export function balcony(c: FacadeCtx, u: number, v: number, width: number, depth: number): void {
  const { set, chunk, f } = c;
  const stone = set.get(chunk, "stone");
  const rail = set.get(chunk, "railing");
  stone.addBox(f, u, v - 0.09, depth / 2, width, 0.18, depth, STONE_LIGHT, 0);
  // ménsulas bajo la losa
  for (const du of [-width / 2 + 0.25, width / 2 - 0.25]) {
    stone.addBox(f, u + du, v - 0.34, depth * 0.3, 0.12, 0.3, depth * 0.6, STONE_LIGHT, F.BACK);
  }
  const hRail = 1.0;
  const rep = Math.max(1, width / 1.6);
  rail.addPanel(f, u - width / 2, u + width / 2, v, v + hRail, depth - 0.04, [1, 1, 1, 1], [rep, 1]);
  const repS = Math.max(0.5, depth / 1.6);
  rail.addSidePanel(f, u - width / 2 + 0.03, 0, depth - 0.04, v, v + hRail, [1, 1, 1, 1], [repS, 1]);
  rail.addSidePanel(f, u + width / 2 - 0.03, 0, depth - 0.04, v, v + hRail, [1, 1, 1, 1], [repS, 1]);
}

/** Barandilla francesa (sin losa) para ventanas del ático. */
export function juliet(c: FacadeCtx, u: number, v: number, width: number): void {
  const rail = c.set.get(c.chunk, "railing");
  rail.addPanel(c.f, u - width / 2, u + width / 2, v, v + 0.95, 0.14, [1, 1, 1, 1], [Math.max(1, width / 1.6), 1]);
}

/** Persianas mallorquinas: plegadas a los lados, cerradas sobre la ventana o ausentes. */
export function shutters(c: FacadeCtx, u: number, v0: number, w: number, h: number): void {
  const { set, chunk, f, rng } = c;
  const sh = set.get(chunk, "shutter");
  const r = rng.next();
  if (r < 0.4) return;
  const tint = mul(c.shutterTint, 0.9 + rng.next() * 0.2);
  if (r < 0.78) {
    const pw = Math.min(0.55, w * 0.5);
    sh.addPanel(f, u - w / 2 - 0.12 - pw, u - w / 2 - 0.12, v0 - 0.05, v0 + h + 0.05, 0.05, tint);
    sh.addPanel(f, u + w / 2 + 0.12, u + w / 2 + 0.12 + pw, v0 - 0.05, v0 + h + 0.05, 0.05, tint);
  } else {
    // cerradas (persiana entornada: cubren la ventana)
    sh.addPanel(f, u - w / 2 - 0.1, u + w / 2 + 0.1, v0 - 0.08, v0 + h + 0.08, 0.14, tint, [1, 1]);
  }
}

/** Mirador (galería acristalada que sobresale) a lo largo de varias plantas. */
export function mirador(c: FacadeCtx, u: number, v0: number, v1: number, width: number): void {
  const { set, chunk, f, rng } = c;
  const stucco = set.get(chunk, "stucco");
  const stone = set.get(chunk, "stone");
  const glass = set.get(chunk, "glass");
  const plain = set.get(chunk, "plain");
  const depth = 0.95;
  // cuerpo (estuco) con cristal en tres caras por planta
  stone.addBox(f, u, v0 - 0.15, depth / 2, width + 0.3, 0.3, depth + 0.3, STONE_LIGHT, 0);
  stone.addBox(f, u, v1 + 0.2, depth / 2, width + 0.3, 0.4, depth + 0.3, STONE_LIGHT, 0);
  const floors = Math.max(1, Math.round((v1 - v0) / 3.2));
  const fh = (v1 - v0) / floors;
  for (let i = 0; i < floors; i++) {
    const b = v0 + i * fh;
    stucco.addBox(f, u, b + 0.1, depth / 2, width, 0.2, depth, mul(c.trim, 1), F.UP | F.DOWN);
    const cols = 3;
    const cw = width / cols;
    for (let k = 0; k < cols; k++) {
      const uc = u - width / 2 + cw * (k + 0.5);
      const g = 0.8 + rng.next() * 0.4;
      glass.addPanel(f, uc - cw / 2 + 0.07, uc + cw / 2 - 0.07, b + 0.35, b + fh - 0.25, depth + 0.01, [g, g, g, 1]);
      plain.addBox(f, uc - cw / 2, b + fh / 2, depth, 0.08, fh - 0.2, 0.08, c.trim, F.BACK | F.DOWN);
    }
    plain.addBox(f, u, b + fh * 0.75, depth, width, 0.05, 0.05, c.trim, F.BACK | F.DOWN);
    // laterales
    stucco.addBox(f, u - width / 2, b + fh / 2, depth / 2, 0.06, fh - 0.2, depth, c.wall, F.BACK);
    stucco.addBox(f, u + width / 2, b + fh / 2, depth / 2, 0.06, fh - 0.2, depth, c.wall, F.BACK);
  }
}

/** Cornisa de coronación + antepecho. */
export function crown(c: FacadeCtx, width: number, vTop: number): void {
  const { set, chunk, f } = c;
  const stone = set.get(chunk, "stone");
  stone.addBox(f, width / 2, vTop - 0.55, 0.38, width + 0.1, 0.22, 0.76, STONE_LIGHT, F.BACK);
  stone.addBox(f, width / 2, vTop - 0.3, 0.3, width + 0.1, 0.28, 0.6, STONE_LIGHT, F.BACK);
  // modillones
  const nb = Math.floor(width / 0.9);
  for (let i = 0; i < nb; i++) {
    stone.addBox(f, (i + 0.5) * (width / nb), vTop - 0.9, 0.12, 0.22, 0.4, 0.24, STONE_LIGHT, F.BACK | F.UP);
  }
  stone.addBox(f, width / 2, vTop + 0.25, 0.2, width + 0.1, 0.5, 0.4, STONE_LIGHT, F.BACK | F.DOWN);
}

/** Imposta (moldura horizontal) a una altura. */
export function stringCourse(c: FacadeCtx, width: number, v: number, h = 0.2, proj = 0.12): void {
  c.set.get(c.chunk, "stone").addBox(c.f, width / 2, v, proj / 2, width + 0.05, h, proj, STONE_LIGHT, F.BACK);
}

/** Pilastra vertical de separación entre edificios. */
export function pilaster(c: FacadeCtx, u: number, height: number): void {
  c.set.get(c.chunk, "stone").addBox(c.f, u, height / 2, 0.06, 0.3, height, 0.12, STONE_LIGHT, F.BACK | F.DOWN);
}

/** Portal de entrada: jambas y dintel de piedra, hoja de madera con vidrio y reja. */
export function portal(c: FacadeCtx, u: number, w: number, h: number): void {
  const { set, chunk, f, rng } = c;
  const stone = set.get(chunk, "stone");
  const plain = set.get(chunk, "plain");
  const glass = set.get(chunk, "glass");
  const rail = set.get(chunk, "railing");
  stone.addBox(f, u - w / 2 - 0.2, h / 2, 0.15, 0.4, h, 0.3, STONE_LIGHT, F.BACK | F.DOWN);
  stone.addBox(f, u + w / 2 + 0.2, h / 2, 0.15, 0.4, h, 0.3, STONE_LIGHT, F.BACK | F.DOWN);
  stone.addBox(f, u, h + 0.25, 0.17, w + 1.0, 0.5, 0.34, STONE_LIGHT, F.BACK | F.DOWN);
  const wood: RGBA = rng.pick<RGBA>([[0.22, 0.12, 0.07, 1], [0.12, 0.2, 0.14, 1], [0.1, 0.12, 0.2, 1], [0.18, 0.15, 0.12, 1]]);
  plain.addBox(f, u, h / 2, 0.06, w, h, 0.08, wood, F.BACK | F.DOWN);
  // vidrio con reja de forja en la mitad superior de las hojas
  glass.addPanel(f, u - w / 2 + 0.2, u + w / 2 - 0.2, h * 0.38, h - 0.2, 0.11);
  rail.addPanel(f, u - w / 2 + 0.2, u + w / 2 - 0.2, h * 0.38, h - 0.2, 0.125, [1, 1, 1, 1], [1.2, 1.4]);
  plain.addBox(f, u, h * 0.36, 0.11, w, 0.06, 0.04, [0.6, 0.55, 0.3, 1], F.BACK | F.DOWN);
  stone.addBox(f, u, 0.06, 0.3, w + 0.8, 0.12, 0.6, STONE_LIGHT, F.BACK); // peldaño
  // placa con el número del portal
  plain.addBox(f, u + w / 2 + 0.75, 2.0, 0.04, 0.36, 0.28, 0.03, [0.9, 0.9, 0.88, 1], F.BACK | F.DOWN);
  const ni = rng.int(0, 31);
  const nc = ni % NUM_ATLAS.cols;
  const nr = Math.floor(ni / NUM_ATLAS.cols);
  set.get(chunk, "numText").addPanel(f, u + w / 2 + 0.75 - 0.15, u + w / 2 + 0.75 + 0.15, 2.0 - 0.115, 2.0 + 0.115, 0.058, [0.08, 0.1, 0.35, 1], [1, 1], [
    nc / NUM_ATLAS.cols,
    1 - (nr + 1) / NUM_ATLAS.rows,
    (nc + 1) / NUM_ATLAS.cols,
    1 - nr / NUM_ATLAS.rows,
  ]);
}

const SHOP_SIGN_COLORS: RGBA[] = [
  [0.65, 0.12, 0.1, 1],
  [0.1, 0.3, 0.5, 1],
  [0.12, 0.38, 0.22, 1],
  [0.9, 0.75, 0.2, 1],
  [0.85, 0.85, 0.82, 1],
  [0.15, 0.15, 0.17, 1],
  [0.55, 0.22, 0.4, 1],
];

/** Local comercial en planta baja: escaparate, rótulo, persiana enrollable y a veces toldo. */
export function shopfront(c: FacadeCtx, u: number, bw: number, h: number): void {
  const { set, chunk, f, rng } = c;
  const stone = set.get(chunk, "stone");
  const plain = set.get(chunk, "plain");
  const glass = set.get(chunk, "glass");
  const roller = set.get(chunk, "roller");
  const aw = set.get(chunk, "awning");
  const ow = bw - 0.5;
  const base = 0.5;
  const top = h - 0.9;
  const sign = rng.pick(SHOP_SIGN_COLORS);
  // pilastras de piedra y zócalo
  stone.addBox(f, u - bw / 2 + 0.12, h / 2, 0.08, 0.24, h, 0.16, STONE_LIGHT, F.BACK | F.DOWN);
  stone.addBox(f, u, 0.25, 0.04, bw - 0.2, 0.5, 0.08, STONE_LIGHT, F.BACK | F.DOWN);
  // marco oscuro + cristal
  plain.addBox(f, u - ow / 2, (base + top) / 2, 0.07, 0.07, top - base, 0.1, [0.08, 0.08, 0.09, 1], F.BACK | F.DOWN);
  plain.addBox(f, u + ow / 2, (base + top) / 2, 0.07, 0.07, top - base, 0.1, [0.08, 0.08, 0.09, 1], F.BACK | F.DOWN);
  plain.addBox(f, u, top, 0.07, ow, 0.07, 0.1, [0.08, 0.08, 0.09, 1], F.BACK | F.DOWN);
  const g = 0.7 + rng.next() * 0.5;
  const lit = rng.chance(0.4);
  glass.addPanel(f, u - ow / 2, u + ow / 2, base, top, 0.03, lit ? [2.2, 1.9, 1.4, 1] : [g, g, g, 1]);
  plain.addBox(f, u + ow * 0.2, (base + top) / 2, 0.065, 0.05, top - base, 0.06, [0.08, 0.08, 0.09, 1], F.BACK | F.DOWN);
  // rótulo
  plain.addBox(f, u, h - 0.45, 0.14, ow + 0.1, 0.62, 0.12, sign, F.BACK | F.DOWN);
  // rótulo con el nombre del comercio (atlas de texto); el color del texto contrasta con el del rótulo
  const lum = sign[0] * 0.3 + sign[1] * 0.59 + sign[2] * 0.11;
  const ti = rng.int(0, SIGN_NAMES.length - 1);
  const col = ti % SIGN_ATLAS.cols;
  const row = Math.floor(ti / SIGN_ATLAS.cols);
  const tw = Math.min(ow * 0.9, 2.4);
  const th = tw / 4;
  const tc: RGBA = lum < 0.5 ? [1, 1, 1, 1] : [0.06, 0.06, 0.06, 1];
  set.get(chunk, "signText").addPanel(f, u - tw / 2, u + tw / 2, h - 0.45 - th / 2, h - 0.45 + th / 2, 0.215, tc, [1, 1], [
    col / SIGN_ATLAS.cols,
    1 - (row + 1) / SIGN_ATLAS.rows,
    (col + 1) / SIGN_ATLAS.cols,
    1 - row / SIGN_ATLAS.rows,
  ]);
  // persiana enrollable bajada (cierra el escaparate) en ~35 % de los locales
  const r = rng.next();
  if (r < 0.35) {
    const tint = rng.pick<RGBA>([[0.9, 0.9, 0.92, 1], [0.7, 0.7, 0.7, 1], [0.75, 0.62, 0.5, 1], [0.5, 0.6, 0.52, 1]]);
    roller.addPanel(f, u - ow / 2 - 0.02, u + ow / 2 + 0.02, 0.0, top + 0.05, 0.16, tint, [Math.max(1, ow / 1.2), 1.5]);
  } else if (r < 0.58) {
    // toldo inclinado
    const col = rng.pick<RGBA>([[0.8, 0.2, 0.12, 1], [0.15, 0.4, 0.2, 1], [0.15, 0.25, 0.5, 1], [0.9, 0.7, 0.2, 1], [0.9, 0.9, 0.85, 1]]);
    const y0 = h - 0.85;
    const y1 = h - 1.9;
    aw.addQuad(
      [f.pt(u - ow / 2, y0, 0.2), f.pt(u + ow / 2, y0, 0.2), f.pt(u + ow / 2, y1, 1.3), f.pt(u - ow / 2, y1, 1.3)],
      [f.nx * 0.5, 0.8, f.nz * 0.5],
      [[0, 0], [ow / 0.6, 0], [ow / 0.6, 1], [0, 1]],
      col,
    );
    aw.addQuad(
      [f.pt(u - ow / 2, y1, 1.3), f.pt(u + ow / 2, y1, 1.3), f.pt(u + ow / 2, y1 - 0.25, 1.3), f.pt(u - ow / 2, y1 - 0.25, 1.3)],
      [f.nx, 0, f.nz],
      [[0, 0], [ow / 0.6, 0], [ow / 0.6, 0.3], [0, 0.3]],
      col,
    );
  }
}

/** Aparato de aire acondicionado colgado de la fachada (muy típico en Barcelona). */
export function acUnit(c: FacadeCtx, u: number, v: number): void {
  const plain = c.set.get(c.chunk, "plain");
  const k = 0.85 + c.rng.next() * 0.15;
  plain.addBox(c.f, u, v, 0.2, 0.8, 0.55, 0.36, [k, k, k * 0.97, 1], F.BACK);
  plain.addBox(c.f, u, v, 0.385, 0.62, 0.38, 0.02, [0.25, 0.25, 0.27, 1], F.BACK); // rejilla
  // soporte
  c.set.get(c.chunk, "iron").addBox(c.f, u, v - 0.34, 0.2, 0.7, 0.05, 0.3, [1, 1, 1, 1], F.BACK);
}

/** Macetas y plantas asomando por encima de la barandilla de un balcón. */
export function balconyPlants(c: FacadeCtx, u: number, v: number, width: number, depth: number): void {
  const { set, chunk, f, rng } = c;
  const leaf = set.get(chunk, "foliage");
  const plain = set.get(chunk, "plain");
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const uc = u - width / 2 + (width * (i + 0.5)) / n;
    const w = depth - 0.22;
    plain.addBox(f, uc, v + 0.17, w, 0.3, 0.34, 0.3, [0.62, 0.32, 0.2, 1], F.DOWN); // maceta de barro
    const p = f.pt(uc, v + 0.62, w);
    const g = 0.75 + rng.next() * 0.5;
    leaf.addEllipsoid(p[0], p[1], p[2], 0.3, 0.28, 0.3, 7, 4, [g, g * 1.05, g * 0.85, 1]);
  }
}
