import { assetUrl } from "../assets";
import type { Frame, MeshBatch, P3 } from "./MeshBatch";

/**
 * Buzón de Correos de Barcelona. Procede de un escaneo fotogramétrico (1 M de triángulos) que se hornea con
 * scripts/bake-letterbox.mjs a un atlas de color (4 caras + tapa) y a las medidas del zócalo y del cuerpo;
 * aquí se genera la geometría (dos cajas) y se proyecta cada cara sobre su trozo del atlas.
 */
interface Rect { u0: number; u1: number; v0: number; v1: number }
export interface MailboxMeta {
  height: number;
  plinthHeight: number;
  footprint: { x0: number; x1: number; y0: number; y1: number };
  plinth: { x0: number; x1: number; y0: number; y1: number };
  body: { x0: number; x1: number; y0: number; y1: number };
  pxm: number;
  hh: number;
  atlas: { w: number; h: number };
  rects: Record<"px" | "nx" | "py" | "ny" | "top", Rect>;
}

export const MAILBOX_TEXTURE = assetUrl("assets/props/mailbox.webp");
let meta: MailboxMeta | null = null;

export async function loadMailbox(): Promise<boolean> {
  try {
    const res = await fetch(assetUrl("assets/props/mailbox.json"));
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`HTTP ${res.status}`);
    meta = (await res.json()) as MailboxMeta;
    return true;
  } catch (e) {
    console.warn("[Buzón] Sin mailbox.json: se omiten los buzones.", e);
    meta = null;
    return false;
  }
}
export const hasMailbox = (): boolean => meta !== null;
export const mailboxSize = (): { sx: number; sy: number; sz: number } => {
  const m = meta!;
  return { sx: m.footprint.x1 - m.footprint.x0, sy: m.height, sz: m.footprint.y1 - m.footprint.y0 };
};

/**
 * Añade un buzón al lote en el Frame `f` (el origen del Frame es el centro del cuerpo; w = hacia la calle).
 * La cara grande con el logo (+X del escaneo) mira hacia fuera (calle).
 */
export function addMailbox(batch: MeshBatch, f: Frame): void {
  const m = meta!;
  const W = m.atlas.w, Ht = m.atlas.h, px = m.pxm, H = m.height;
  const cx = (m.body.x0 + m.body.x1) / 2, cy = (m.body.y0 + m.body.y1) / 2;
  const { x0: hx0, x1: hx1, y0: hy0, y1: hy1 } = m.footprint;
  const vOf = (y: number): number => 1 - ((H - y) * px) / Ht; // y = altura sobre la acera
  // escaneo (a = x, b = y, z = altura) → Frame local (w = x - cx, u = y - cy)
  const P = (a: number, b: number, y: number): P3 => f.pt(b - cy, y, a - cx);
  const nW: P3 = [f.nx, 0, f.nz], nU: P3 = [f.ux, 0, f.uz];
  const neg = (n: P3): P3 => [-n[0], -n[1], -n[2]];
  const white: [number, number, number, number] = [1, 1, 1, 1];

  const box = (b: { x0: number; x1: number; y0: number; y1: number }, yb: number, yt: number): void => {
    const uOf = (rect: Rect, h: number): number => rect.u0 + (h * px) / W;
    // +X (hacia la calle): derecha = +Y
    batch.addQuad([P(b.x1, b.y0, yb), P(b.x1, b.y1, yb), P(b.x1, b.y1, yt), P(b.x1, b.y0, yt)], nW, [[uOf(m.rects.px, b.y0 - hy0), vOf(yb)], [uOf(m.rects.px, b.y1 - hy0), vOf(yb)], [uOf(m.rects.px, b.y1 - hy0), vOf(yt)], [uOf(m.rects.px, b.y0 - hy0), vOf(yt)]], white);
    // -X: derecha = -Y
    batch.addQuad([P(b.x0, b.y1, yb), P(b.x0, b.y0, yb), P(b.x0, b.y0, yt), P(b.x0, b.y1, yt)], neg(nW), [[uOf(m.rects.nx, hy1 - b.y1), vOf(yb)], [uOf(m.rects.nx, hy1 - b.y0), vOf(yb)], [uOf(m.rects.nx, hy1 - b.y0), vOf(yt)], [uOf(m.rects.nx, hy1 - b.y1), vOf(yt)]], white);
    // +Y: derecha = -X
    batch.addQuad([P(b.x1, b.y1, yb), P(b.x0, b.y1, yb), P(b.x0, b.y1, yt), P(b.x1, b.y1, yt)], nU, [[uOf(m.rects.py, hx1 - b.x1), vOf(yb)], [uOf(m.rects.py, hx1 - b.x0), vOf(yb)], [uOf(m.rects.py, hx1 - b.x0), vOf(yt)], [uOf(m.rects.py, hx1 - b.x1), vOf(yt)]], white);
    // -Y: derecha = +X
    batch.addQuad([P(b.x0, b.y0, yb), P(b.x1, b.y0, yb), P(b.x1, b.y0, yt), P(b.x0, b.y0, yt)], neg(nU), [[uOf(m.rects.ny, b.x0 - hx0), vOf(yb)], [uOf(m.rects.ny, b.x1 - hx0), vOf(yb)], [uOf(m.rects.ny, b.x1 - hx0), vOf(yt)], [uOf(m.rects.ny, b.x0 - hx0), vOf(yt)]], white);
  };
  box(m.plinth, 0, m.plinthHeight);
  box(m.body, m.plinthHeight, H);
  // tapa (vista desde arriba: derecha = +X, arriba de la imagen = +Y)
  const t = m.rects.top, vTop = (y: number): number => 1 - (m.hh + (hy1 - y) * px) / Ht, uTop = (x: number): number => t.u0 + ((x - hx0) * px) / W;
  const b = m.body;
  batch.addQuad([P(b.x0, b.y0, H), P(b.x1, b.y0, H), P(b.x1, b.y1, H), P(b.x0, b.y1, H)], [0, 1, 0], [[uTop(b.x0), vTop(b.y0)], [uTop(b.x1), vTop(b.y0)], [uTop(b.x1), vTop(b.y1)], [uTop(b.x0), vTop(b.y1)]], white);
  // el zócalo asoma por encima del cuerpo: su cara superior (anillo) también se dibuja
  const p = m.plinth, yp = m.plinthHeight;
  const strip = (a: [number, number], c: [number, number], d: [number, number], e: [number, number]): void =>
    batch.addQuad([P(a[0], a[1], yp), P(c[0], c[1], yp), P(d[0], d[1], yp), P(e[0], e[1], yp)], [0, 1, 0], [a, c, d, e].map(([x, y]) => [uTop(x), vTop(y)] as [number, number]), white);
  strip([p.x0, p.y0], [p.x1, p.y0], [p.x1, b.y0], [p.x0, b.y0]);
  strip([p.x0, b.y1], [p.x1, b.y1], [p.x1, p.y1], [p.x0, p.y1]);
  strip([p.x0, b.y0], [b.x0, b.y0], [b.x0, b.y1], [p.x0, b.y1]);
  strip([b.x1, b.y0], [p.x1, b.y0], [p.x1, b.y1], [b.x1, b.y1]);
}
