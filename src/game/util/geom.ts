export interface V2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): V2 => ({ x, z });

/** Gira 90° en sentido horario (visto desde arriba, X este / Z norte): norte → este. */
export function rotateCW(p: V2, quarterTurns: number): V2 {
  let { x, z } = p;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    const nx = z;
    const nz = -x;
    x = nx;
    z = nz;
  }
  return { x, z };
}

export function dist(a: V2, b: V2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Normal "derecha" (calle) de una dirección unitaria d, con X este / Z norte. */
export function rightNormal(dx: number, dz: number): V2 {
  return { x: dz, z: -dx };
}

/**
 * Desplaza una polilínea hacia su derecha `width` metros con ingletes (miter).
 * En los cadenas cerradas el último punto vuelve al primero implícitamente.
 */
export function offsetPolyline(pts: V2[], width: number, closed: boolean): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  const segNormal = (i: number): V2 => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return rightNormal((b.x - a.x) / len, (b.z - a.z) / len);
  };
  for (let i = 0; i < n; i++) {
    let nPrev: V2 | null = null;
    let nNext: V2 | null = null;
    if (closed || i > 0) nPrev = segNormal((i - 1 + n) % n);
    if (closed || i < n - 1) nNext = segNormal(i);
    let m: V2;
    if (nPrev && nNext) {
      const d = 1 + nPrev.x * nNext.x + nPrev.z * nNext.z;
      m = { x: ((nPrev.x + nNext.x) / d) * width, z: ((nPrev.z + nNext.z) / d) * width };
    } else {
      const nn = (nPrev ?? nNext) as V2;
      m = { x: nn.x * width, z: nn.z * width };
    }
    out.push({ x: pts[i].x + m.x, z: pts[i].z + m.z });
  }
  return out;
}
