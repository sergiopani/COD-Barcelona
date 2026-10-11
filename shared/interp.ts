/**
 * Interpolación de estados remotos y sincronización de reloj (puras, sin Babylon): las usa el cliente y se prueban en Node.
 */
export interface NetSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ads: number;
  alive: number;
}

export interface Interpolated {
  x: number;
  y: number;
  z: number;
  yaw: number;
  ads: number;
  alive: number;
}

/** Posición en el instante `renderTime`: interpola entre muestras y extrapola como máximo `maxExtrapolate` s con la última velocidad. */
export function interpolate(s: NetSample[], renderTime: number, maxExtrapolate = 0.15): Interpolated | null {
  if (s.length === 0) return null;
  const last = s[s.length - 1];
  if (renderTime >= last.t) {
    const a = s[Math.max(0, s.length - 2)];
    const dt = Math.max(0.001, (last.t - a.t) / 1000);
    const ex = Math.min(maxExtrapolate, (renderTime - last.t) / 1000);
    return { x: last.x + ((last.x - a.x) / dt) * ex, y: last.y, z: last.z + ((last.z - a.z) / dt) * ex, yaw: last.yaw, ads: last.ads, alive: last.alive };
  }
  if (renderTime <= s[0].t) return { ...s[0] };
  let i = s.length - 1;
  while (i > 0 && s[i - 1].t > renderTime) i--;
  const a = s[Math.max(0, i - 1)];
  const b = s[i];
  const k = b.t === a.t ? 1 : Math.max(0, Math.min(1, (renderTime - a.t) / (b.t - a.t)));
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, ads: b.ads, alive: b.alive };
}

/** Estimador suavizado del desfase reloj servidor − reloj local. */
export class ClockSync {
  offset = 0;
  private init = false;
  /** `serverTime` recibido en el instante local `localNow` (ambos en ms). */
  update(serverTime: number, localNow: number): void {
    const sample = serverTime - localNow;
    this.offset = this.init ? this.offset + (sample - this.offset) * 0.1 : sample;
    this.init = true;
  }
  serverNow(localNow: number): number {
    return localNow + this.offset;
  }
}
