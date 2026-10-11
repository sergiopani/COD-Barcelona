// server/src/index.ts
import fs2 from "node:fs";
import http from "node:http";
import path2 from "node:path";
import { WebSocketServer } from "ws";

// shared/protocol.ts
var PROTOCOL_VERSION = 2;
var MAX_PLAYERS = 32;
var SERVER_TICK_HZ = 20;
var KILL_LIMIT = 0;
var RESPAWN_SECONDS = 3;
var NAME_MAX = 16;

// server/src/Leaderboard.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
var MAX_ENTRIES = 1e4;
var TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
var Leaderboard = class {
  /** `file` null = solo en memoria (pruebas). */
  constructor(file) {
    this.file = file;
    if (file) this.load();
  }
  file;
  entries = /* @__PURE__ */ new Map();
  sorted = null;
  saveTimer = null;
  /** Se incrementa en cada cambio (para difundir el ranking solo cuando cambia). */
  version = 0;
  /** Hash estable del token (null si el token no es válido → ese jugador no se persiste). */
  static idFromToken(token) {
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  }
  load() {
    const f = this.file;
    try {
      if (!fs.existsSync(f)) return;
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const e of data.entries ?? []) {
        if (e && typeof e.id === "string" && Number.isFinite(e.kills)) this.entries.set(e.id, e);
      }
    } catch (err) {
      try {
        fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`);
      } catch {
      }
      console.error("[Ranking] Archivo corrupto, se ha guardado una copia y se reinicia:", err);
    }
  }
  get size() {
    return this.entries.size;
  }
  touchChange() {
    this.sorted = null;
    this.version++;
    this.scheduleSave();
  }
  recordKill(id, name, headshot) {
    if (!id) return;
    const now = Date.now();
    let e = this.entries.get(id);
    if (!e) {
      e = { id, name, kills: 0, deaths: 0, headshots: 0, first: now, last: now };
      this.entries.set(id, e);
    }
    e.name = name;
    e.kills++;
    if (headshot) e.headshots++;
    e.last = now;
    if (this.entries.size > MAX_ENTRIES) this.prune();
    this.touchChange();
  }
  /** Las muertes solo cuentan para quien ya figura en el ranking. */
  recordDeath(id) {
    const e = id ? this.entries.get(id) : void 0;
    if (!e) return;
    e.deaths++;
    this.touchChange();
  }
  order() {
    if (!this.sorted) this.sorted = [...this.entries.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.first - b.first);
    return this.sorted;
  }
  top(n) {
    return this.order().slice(0, n).map((e, i) => ({ rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots }));
  }
  /** Posición y cifras de un jugador (null si aún no tiene bajas). */
  entry(id) {
    if (!id || !this.entries.has(id)) return null;
    const list = this.order();
    const i = list.findIndex((e2) => e2.id === id);
    const e = list[i];
    return { rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots, total: list.length };
  }
  prune() {
    for (const e of this.order().slice(MAX_ENTRIES)) this.entries.delete(e.id);
    this.sorted = null;
  }
  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 2e3);
  }
  /** Guarda ya (escritura atómica: archivo temporal + rename). */
  flush() {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.order() }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[Ranking] No se pudo guardar:", err);
    }
  }
};

// src/game/config.ts
var STREET = {
  /** Distancia entre ejes de calles contiguas (Eixample ≈ 133 m). */
  pitch: 133,
  /** Ancho de calle de fachada a fachada. */
  width: 20,
  /** Ancho de cada acera. */
  sidewalk: 4.5,
  /** Altura del bordillo. */
  curbHeight: 0.14,
  /** Lado de los chaflanes (xamfrans) de las esquinas, a 45°. */
  chamfer: 14,
  /** Longitud de las calles salientes desde la esquina de la manzana exterior. */
  armLength: 45
};
var BLOCK_HALF = (STREET.pitch - STREET.width) / 2;
var STREET_AXIS = STREET.pitch / 2;
var OUTER_START = STREET_AXIS + STREET.width / 2;
var ARM_END = OUTER_START + STREET.armLength + STREET.sidewalk;

// src/game/weapons/WeaponDefinition.ts
var M1A_SNIPER = {
  id: "m1a-sniper",
  name: "M1A Francotirador",
  magazine: 5,
  reserve: 30,
  cycleTime: 1.15,
  reloadTime: 2.6,
  damage: { head: 200, torso: 100, legs: 60 },
  hipSpread: 0.045,
  adsSpread: 8e-4,
  zoomLevels: [4, 8],
  adsTime: 0.18,
  adsMoveSpeed: 0.45,
  recoilPitch: 0.03,
  recoilYaw: 8e-3,
  range: 400,
  modelLength: 1.12
};

// shared/combat.ts
var WEAPON = M1A_SNIPER;
var PLAYER_HP = 100;
var EYE_HEIGHT = 1.65;
var PLAYER_RADIUS = 0.4;
var HIT = {
  headY: 1.62,
  headR: 0.17,
  torsoR: 0.3,
  torsoY0: 0.85,
  torsoY1: 1.5,
  legsR: 0.2,
  legsY1: 0.85
};
function rayVsSphere(o, d, c, r, maxDist) {
  const mx = o[0] - c[0];
  const my = o[1] - c[1];
  const mz = o[2] - c[2];
  const b = mx * d[0] + my * d[1] + mz * d[2];
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= maxDist ? t : null;
}
function rayVsVerticalCylinder(o, d, cx, cz, r, y0, y1, maxDist) {
  const ox = o[0] - cx;
  const oz = o[2] - cz;
  const a = d[0] * d[0] + d[2] * d[2];
  let tEnter = -Infinity;
  let tExit = Infinity;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > r * r) return null;
  } else {
    const b = 2 * (ox * d[0] + oz * d[2]);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tEnter = (-b - sq) / (2 * a);
    tExit = (-b + sq) / (2 * a);
  }
  if (Math.abs(d[1]) < 1e-9) {
    if (o[1] < y0 || o[1] > y1) return null;
  } else {
    const t0 = (y0 - o[1]) / d[1];
    const t1 = (y1 - o[1]) / d[1];
    tEnter = Math.max(tEnter, Math.min(t0, t1));
    tExit = Math.min(tExit, Math.max(t0, t1));
  }
  if (tEnter > tExit || tExit < 0) return null;
  const t = Math.max(0, tEnter);
  return t <= maxDist ? t : null;
}
function rayVsPlayer(o, d, feet, maxDist) {
  const head = rayVsSphere(o, d, [feet[0], feet[1] + HIT.headY, feet[2]], HIT.headR, maxDist);
  const torso = rayVsVerticalCylinder(o, d, feet[0], feet[2], HIT.torsoR, feet[1] + HIT.torsoY0, feet[1] + HIT.torsoY1, maxDist);
  const legs = rayVsVerticalCylinder(o, d, feet[0], feet[2], HIT.legsR, feet[1], feet[1] + HIT.legsY1, maxDist);
  let best = null;
  const consider = (t, zone) => {
    if (t !== null && (!best || t < best.dist)) best = { dist: t, zone };
  };
  consider(head, "head");
  consider(torso, "torso");
  consider(legs, "legs");
  return best;
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function spreadDirection(fwd, spread, rnd) {
  const f = normalize(fwd);
  const helper = Math.abs(f[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const right = normalize([helper[1] * f[2] - helper[2] * f[1], helper[2] * f[0] - helper[0] * f[2], helper[0] * f[1] - helper[1] * f[0]]);
  const up = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * spread;
  return normalize([f[0] + right[0] * Math.cos(a) * r + up[0] * Math.sin(a) * r, f[1] + right[1] * Math.cos(a) * r + up[1] * Math.sin(a) * r, f[2] + right[2] * Math.cos(a) * r + up[2] * Math.sin(a) * r]);
}

// shared/world.ts
function isRoad(x, z) {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const dx = Math.abs(ax - STREET_AXIS);
  const dz = Math.abs(az - STREET_AXIS);
  if (ax > ARM_END || az > ARM_END) return false;
  if (dx < 5.5 && az < ARM_END) return true;
  if (dz < 5.5 && ax < ARM_END) return true;
  return dx < 24 && dz < 24 && dx + dz < 36;
}
var WorldCollision = class {
  boxes = [];
  constructor(data) {
    for (const [tag, cx, cy, cz, sx, sy, sz, r] of data.boxes) {
      this.boxes.push({ tag, c: [cx, cy, cz], s: [sx, sy, sz], r, cos: Math.cos(r), sin: Math.sin(r), hx: sx / 2, hy: sy / 2, hz: sz / 2 });
    }
  }
  /** Distancia al primer sólido que detiene balas (las verjas y los límites invisibles no), o null. Incluye el suelo. */
  raycast(o, d, maxDist) {
    let best = maxDist;
    let found = false;
    for (const b of this.boxes) {
      if (b.tag === "fence" || b.tag === "bounds") continue;
      const dx = o[0] - b.c[0];
      const dz = o[2] - b.c[2];
      const lo = [dx * b.cos - dz * b.sin, o[1] - b.c[1], dx * b.sin + dz * b.cos];
      const ld = [d[0] * b.cos - d[2] * b.sin, d[1], d[0] * b.sin + d[2] * b.cos];
      let tmin = 0;
      let tmax = best;
      let ok = true;
      const half = [b.hx, b.hy, b.hz];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(ld[i]) < 1e-9) {
          if (lo[i] < -half[i] || lo[i] > half[i]) ok = false;
        } else {
          let t1 = (-half[i] - lo[i]) / ld[i];
          let t2 = (half[i] - lo[i]) / ld[i];
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) ok = false;
        }
      }
      if (ok && tmin < best) {
        best = tmin;
        found = true;
      }
    }
    if (d[1] < -1e-6) {
      for (const h of [0.14, 0]) {
        const t = (h - o[1]) / d[1];
        if (t <= 0 || t >= best) continue;
        if (h === 0 !== isRoad(o[0] + d[0] * t, o[2] + d[2] * t)) continue;
        best = t;
        found = true;
        break;
      }
    }
    return found ? best : null;
  }
  /** Profundidad máxima con la que el cilindro del jugador se mete en una caja sólida (0 si no hay solape). */
  penetration(feet, radius = PLAYER_RADIUS, height = 1.8) {
    let worst = 0;
    for (const b of this.boxes) {
      if (b.tag === "bounds") continue;
      const top = b.c[1] + b.hy;
      const bottom = b.c[1] - b.hy;
      if (feet[1] >= top - 0.05 || feet[1] + height <= bottom + 0.02) continue;
      const dx = feet[0] - b.c[0];
      const dz = feet[2] - b.c[2];
      if (Math.abs(dx) > b.hx + b.hz + radius + 0.5 || Math.abs(dz) > b.hx + b.hz + radius + 0.5) continue;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      const px = b.hx + radius - Math.abs(lx);
      const pz = b.hz + radius - Math.abs(lz);
      if (px > 0 && pz > 0) worst = Math.max(worst, Math.min(px, pz));
    }
    return worst;
  }
};

// src/game/util/rng.ts
var Rng = class {
  s;
  constructor(seed) {
    this.s = seed >>> 0;
  }
  next() {
    this.s = this.s + 1831565813 >>> 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
};

// src/game/util/geom.ts
var v2 = (x, z) => ({ x, z });
function rotateCW(p, quarterTurns) {
  let { x, z } = p;
  for (let i = 0; i < (quarterTurns % 4 + 4) % 4; i++) {
    const nx = z;
    const nz = -x;
    x = nx;
    z = nz;
  }
  return { x, z };
}
function dist(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

// src/game/world/mapLayout.ts
var B = BLOCK_HALF;
var O = OUTER_START;
var E = ARM_END;
var C = STREET.chamfer;
var S = STREET_AXIS;
var SW = STREET.sidewalk;
var ROAD_W = STREET.width - 2 * SW;
function makeSegs(points, closed) {
  const segs = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = dist(a, b);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const diagonal = Math.abs(ux) > 0.1 && Math.abs(uz) > 0.1;
    segs.push({ a, b, len, ux, uz, nx: uz, nz: -ux, kind: diagonal ? "chamfer" : "straight" });
  }
  return segs;
}
function makeChain(id, role, points, closed) {
  return { id, role, points, closed, segs: makeSegs(points, closed) };
}
var northBlock = [v2(-B, E), v2(-B, O + C), v2(-B + C, O), v2(B - C, O), v2(B, O + C), v2(B, E)];
var cornerBlock = [v2(O, E), v2(O, O + C), v2(O + C, O), v2(E, O)];
var endcapEast = [v2(B, E), v2(O, E)];
var endcapWest = [v2(-O, E), v2(-B, E)];
var outerChains = [];
for (let k = 0; k < 4; k++) {
  outerChains.push(makeChain(`side${k}`, "outer", northBlock.map((p) => rotateCW(p, k)), false));
  outerChains.push(makeChain(`corner${k}`, "outer", cornerBlock.map((p) => rotateCW(p, k)), false));
}
var endcapChains = [];
for (let k = 0; k < 4; k++) {
  endcapChains.push(makeChain(`cap${k}a`, "endcap", endcapEast.map((p) => rotateCW(p, k)), false));
  endcapChains.push(makeChain(`cap${k}b`, "endcap", endcapWest.map((p) => rotateCW(p, k)), false));
}
var centerChain = makeChain(
  "center",
  "center",
  [
    v2(B, -B + C),
    v2(B, B - C),
    v2(B - C, B),
    v2(-B + C, B),
    v2(-B, B - C),
    v2(-B, -B + C),
    v2(-B + C, -B),
    v2(B - C, -B)
  ],
  true
);
var sidewalkChains = [
  centerChain,
  ...outerChains,
  ...endcapChains.map((c) => {
    const [a, b] = c.points;
    const len = dist(a, b);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    return makeChain(c.id + "_sw", "endcap", [v2(a.x + ux * SW, a.z + uz * SW), v2(b.x - ux * SW, b.z - uz * SW)], false);
  })
];
var buildingChains = [...outerChains, ...endcapChains];
var CROSSWALK_ALONG = 3;
var crosswalks = [];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    crosswalks.push({ x: sx * (B - C - 2), z: sz * S, axis: "x" });
    crosswalks.push({ x: sx * (O + C + 2), z: sz * S, axis: "x" });
    crosswalks.push({ x: sx * S, z: sz * (B - C - 2), axis: "z" });
    crosswalks.push({ x: sx * S, z: sz * (O + C + 2), axis: "z" });
  }
}
function crosswalkRect(c) {
  return c.axis === "x" ? { cx: c.x, cz: c.z, hx: CROSSWALK_ALONG / 2, hz: ROAD_W / 2 } : { cx: c.x, cz: c.z, hx: ROAD_W / 2, hz: CROSSWALK_ALONG / 2 };
}
function nearCrosswalk(x, z, margin) {
  for (const c of crosswalks) {
    const r = crosswalkRect(c);
    if (Math.abs(x - r.cx) < r.hx + margin && Math.abs(z - r.cz) < r.hz + margin) return true;
  }
  return false;
}
var ringHalf = B - C - 6;
var streetRuns = [];
for (const sgn of [-1, 1]) {
  streetRuns.push({ axis: "x", at: sgn * S, from: -ringHalf, to: ringHalf });
  streetRuns.push({ axis: "z", at: sgn * S, from: -ringHalf, to: ringHalf });
  for (const side of [-1, 1]) {
    const a = O + C + 8;
    const b = ARM_END - 2;
    streetRuns.push({ axis: "x", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
    streetRuns.push({ axis: "z", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
  }
}
var props = [];
var rng = new Rng(20260626);
function addProp(kind, x, z, ux, uz, cover, variant = rng.int(0, 7)) {
  props.push({ kind, x, z, ux, uz, variant, cover });
}
for (const chain of [centerChain, ...outerChains]) {
  for (const seg of chain.segs) {
    if (seg.kind === "chamfer") {
      const mx = (seg.a.x + seg.b.x) / 2 + seg.nx * 2.6;
      const mz = (seg.a.z + seg.b.z) / 2 + seg.nz * 2.6;
      addProp("bin", mx, mz, seg.ux, seg.uz, false);
      for (const t of [0.25, 0.75]) {
        addProp("bollard", seg.a.x + seg.ux * seg.len * t + seg.nx * 3.9, seg.a.z + seg.uz * seg.len * t + seg.nz * 3.9, 1, 0, false);
      }
      continue;
    }
    const at = (t, d) => ({ x: seg.a.x + seg.ux * t + seg.nx * d, z: seg.a.z + seg.uz * t + seg.nz * d });
    const free = (t, d, m = 2.6) => {
      const p = at(t, d);
      return !nearCrosswalk(p.x, p.z, m);
    };
    for (let t = 6 + rng.range(0, 3); t < seg.len - 5; t += 12 + rng.range(-1, 1)) {
      if (!free(t, 3.7, 3.2)) continue;
      const p = at(t, 3.7);
      addProp("tree", p.x, p.z, seg.ux, seg.uz, false);
    }
    for (let t = 12 + rng.range(0, 2); t < seg.len - 5; t += 24) {
      if (!free(t, 4)) continue;
      const p = at(t, 4);
      addProp("lamp", p.x, p.z, seg.ux, seg.uz, false);
    }
    for (let t = 8; t < seg.len - 8; t += 17 + rng.range(0, 8)) {
      if (!free(t, 1.2, 2.2)) continue;
      const p = at(t, 1.1);
      addProp(rng.chance(0.7) ? "bench" : "bin", p.x, p.z, seg.ux, seg.uz, true);
    }
    if (seg.len > 40 && chain.role !== "center") {
      const t = seg.len * rng.range(0.35, 0.65);
      if (free(t, 3.9, 3)) {
        const p = at(t, 3.9);
        addProp("planter", p.x, p.z, seg.ux, seg.uz, true);
      }
    }
  }
}
for (const chain of outerChains) {
  for (const seg of chain.segs) {
    if (seg.kind !== "straight" || seg.len < 26) continue;
    let placed = 0;
    for (let attempt = 0; attempt < 24 && placed < 2; attempt++) {
      const t = rng.range(8, seg.len - 8);
      const x = seg.a.x + seg.ux * t + seg.nx * 1.9;
      const z = seg.a.z + seg.uz * t + seg.nz * 1.9;
      if (nearCrosswalk(x, z, 3)) continue;
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < (p.kind === "tree" ? 2.6 : 2.4))) continue;
      addProp("terrace", x, z, seg.ux, seg.uz, true);
      placed++;
    }
  }
}
for (const c of crosswalks) {
  const r = crosswalkRect(c);
  const along = c.axis === "x" ? { ux: 1, uz: 0 } : { ux: 0, uz: 1 };
  const off = ROAD_W / 2 + 0.7;
  if (c.axis === "x") {
    addProp("trafficLight", r.cx - 1.4, r.cz + off, 1, 0, false);
    addProp("sign", r.cx + 1.4, r.cz - off, -along.ux, along.uz, false);
  } else {
    addProp("trafficLight", r.cx + off, r.cz - 1.4, 0, -1, false);
    addProp("sign", r.cx - off, r.cz + 1.4, along.ux, along.uz, false);
  }
}
var PARK_OFFSET = ROAD_W / 2 - 1.25;
for (const run of streetRuns) {
  for (const side of [-1, 1]) {
    for (let t = run.from + 3; t < run.to - 3; t += 5.4) {
      if (!rng.chance(0.55)) continue;
      const x = run.axis === "x" ? t : run.at + side * PARK_OFFSET;
      const z = run.axis === "x" ? run.at + side * PARK_OFFSET : t;
      if (nearCrosswalk(x, z, 1.5)) continue;
      const ux = run.axis === "x" ? 1 : 0;
      const uz = run.axis === "x" ? 0 : 1;
      const r = rng.next();
      const jitter = rng.range(-0.25, 0.25);
      const px = x + (run.axis === "x" ? jitter : 0);
      const pz = z + (run.axis === "z" ? jitter : 0);
      addProp(r < 0.12 ? "van" : r < 0.24 ? "moto" : "car", px, pz, ux, uz, true);
    }
  }
}
var spawns = [
  { x: S + 1.5, z: -28, yaw: -Math.PI / 2 },
  // calle este, mirando a la basílica
  { x: -S - 1.5, z: 24, yaw: Math.PI / 2 },
  { x: 22, z: S + 1.5, yaw: Math.PI },
  { x: -22, z: -S - 1.5, yaw: 0 },
  { x: S + 1.5, z: 100, yaw: Math.PI },
  { x: 100, z: -S - 1.5, yaw: -Math.PI / 2 },
  { x: -S - 1.5, z: -100, yaw: 0 },
  { x: -100, z: S + 1.5, yaw: Math.PI / 2 }
];
var WORLD_HALF = ARM_END + 12;

// server/src/Room.ts
var MAX_SPEED = 7.2;
var SPEED_TOLERANCE = 1.6;
var MAX_REWIND_MS = 400;
var HISTORY_MS = 1500;
var KILL_LIMIT_EFF = process.env.KILL_LIMIT !== void 0 ? Number(process.env.KILL_LIMIT) || 0 : KILL_LIMIT;
var ServerPlayer = class {
  /** Identificador persistente anónimo (hash del token) o null si el cliente no envió un token válido. */
  constructor(id, name, ws, pid) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.pid = pid;
  }
  id;
  name;
  ws;
  pid;
  pos = [0, 0.05, 0];
  yaw = 0;
  pitch = 0;
  ads = false;
  hp = PLAYER_HP;
  alive = true;
  ammo = WEAPON.magazine;
  reserve = WEAPON.reserve;
  cooldown = 0;
  // s
  reloadEnd = 0;
  // ms de sala; 0 = no recargando
  kills = 0;
  deaths = 0;
  respawnAt = 0;
  lastStateAt = 0;
  lastGood = [0, 0.05, 0];
  ack = 0;
  violations = 0;
  history = [];
  lastFireAt = -1e9;
  msgWindowStart = 0;
  msgCount = 0;
  alivePong = true;
  shots = 0;
  hitsLanded = 0;
  info() {
    return { id: this.id, name: this.name, kills: this.kills, deaths: this.deaths, alive: this.alive };
  }
};
var Room = class _Room {
  constructor(code, world2, board, maxPlayers) {
    this.code = code;
    this.world = world2;
    this.board = board;
    this.maxPlayers = maxPlayers;
    this.timer = setInterval(() => this.tick(), 1e3 / SERVER_TICK_HZ);
  }
  code;
  world;
  board;
  maxPlayers;
  players = /* @__PURE__ */ new Map();
  nextId = 1;
  start = performance.now();
  timer;
  over = false;
  overAt = 0;
  /** Para pruebas deterministas. */
  rnd = Math.random;
  boardVersion = -1;
  lastBoardAt = 0;
  now() {
    return performance.now() - this.start;
  }
  get full() {
    return this.players.size >= this.maxPlayers;
  }
  get empty() {
    return this.players.size === 0;
  }
  dispose() {
    clearInterval(this.timer);
  }
  send(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }
  static sanitizeName(raw, fallback) {
    if (typeof raw !== "string") return fallback;
    const clean = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, NAME_MAX);
    return clean || fallback;
  }
  join(ws, name, token) {
    const id = this.nextId++;
    const p = new ServerPlayer(id, _Room.sanitizeName(name, `Jugador ${id}`), ws, Leaderboard.idFromToken(token));
    this.players.set(id, p);
    this.spawn(p, false);
    const mine = this.board.entry(p.pid);
    this.send(p, {
      t: "welcome",
      id,
      room: this.code,
      serverTime: this.now(),
      players: [...this.players.values()].map((q) => q.info()),
      killLimit: KILL_LIMIT_EFF,
      maxPlayers: this.maxPlayers,
      global: mine ? { rank: mine.rank, kills: mine.kills } : null,
      spawn: [...p.pos],
      yaw: p.yaw
    });
    this.sendBoard(p);
    this.broadcast({ t: "joined", player: p.info() }, p);
    return p;
  }
  /** Ranking global (top 10) + posición del jugador. */
  sendBoard(p) {
    const top = this.board.top(10).map((r) => [r.rank, r.name, r.kills, r.deaths, r.headshots]);
    const me = this.board.entry(p.pid);
    this.send(p, { t: "board", top, you: me ? { rank: me.rank, kills: me.kills, deaths: me.deaths, headshots: me.headshots, total: me.total } : null });
  }
  leave(p) {
    if (this.players.delete(p.id)) this.broadcast({ t: "left", id: p.id });
  }
  // ------------------------------------------------------------ mensajes del cliente
  handle(p, msg) {
    const now = this.now();
    if (now - p.msgWindowStart > 1e3) {
      p.msgWindowStart = now;
      p.msgCount = 0;
    }
    if (++p.msgCount > 120) return;
    switch (msg.t) {
      case "state":
        this.onState(p, msg, now);
        break;
      case "fire":
        this.onFire(p, msg, now);
        break;
      case "reload":
        this.onReload(p, now);
        break;
      case "dbg":
        if (process.env.ALLOW_DEBUG === "1" && this.finite3(msg.p)) {
          p.pos = [...msg.p];
          p.lastGood = [...msg.p];
          p.history = [{ t: now, p: [...msg.p] }];
          p.lastStateAt = now;
        }
        break;
      case "ping":
        this.send(p, { t: "pong", c: Number(msg.c) || 0, st: now });
        break;
      default:
        break;
    }
  }
  finite3(v) {
    return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  }
  onState(p, m, now) {
    if (!this.finite3(m.p) || !Number.isFinite(m.yaw) || !Number.isFinite(m.pitch)) return;
    p.ack = Number.isFinite(m.seq) ? m.seq : p.ack;
    if (!p.alive || this.over) return;
    const [x, y, z] = m.p;
    const dt = Math.min(0.5, Math.max(0.01, (now - p.lastStateAt) / 1e3));
    p.lastStateAt = now;
    let reason = null;
    if (Math.abs(x) > 128 || Math.abs(z) > 128 || y < -0.5 || y > 5) reason = "fuera de los l\xEDmites";
    else {
      const dist2 = Math.hypot(x - p.pos[0], z - p.pos[2]);
      if (dist2 > MAX_SPEED * SPEED_TOLERANCE * dt + 0.6) reason = "velocidad imposible";
      else if (this.world.penetration(m.p) > 0.35) reason = "dentro de un s\xF3lido";
    }
    if (reason) {
      p.violations++;
      this.send(p, { t: "correct", p: [...p.lastGood], reason });
      p.pos = [...p.lastGood];
      return;
    }
    p.pos = [x, y, z];
    p.lastGood = [x, y, z];
    p.yaw = m.yaw;
    p.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
    p.ads = !!m.ads;
    p.history.push({ t: now, p: [x, y, z] });
    while (p.history.length && now - p.history[0].t > HISTORY_MS) p.history.shift();
  }
  onReload(p, now) {
    if (!p.alive || this.over || p.reloadEnd > 0 || p.ammo >= WEAPON.magazine || p.reserve <= 0) return;
    p.reloadEnd = now + WEAPON.reloadTime * 1e3;
  }
  /** Posición interpolada de un jugador en el instante `t` (historial de estados). */
  positionAt(q, t) {
    const h = q.history;
    if (h.length === 0) return q.pos;
    if (t >= h[h.length - 1].t) return h[h.length - 1].p;
    if (t <= h[0].t) return h[0].p;
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1];
        const b = h[i];
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        return [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
      }
    }
    return q.pos;
  }
  onFire(p, m, now) {
    if (!p.alive || this.over || p.reloadEnd > 0) return;
    if (p.cooldown > 0.06 || p.ammo <= 0) return;
    if (!this.finite3(m.d) || !Number.isFinite(m.rt)) return;
    p.ammo--;
    p.cooldown = WEAPON.cycleTime;
    p.shots++;
    const origin = [p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]];
    let speed = 0;
    const h = p.history;
    if (h.length >= 2) {
      const a = h[Math.max(0, h.length - 5)];
      const b = h[h.length - 1];
      speed = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / Math.max(0.05, (b.t - a.t) / 1e3);
    }
    const ads = p.ads ? Math.max(0, Math.min(1, Number(m.ads) || 0)) : 0;
    const moving = Math.min(1, speed / 5);
    const spread = (WEAPON.hipSpread * (1 - ads) + WEAPON.adsSpread * ads) * (1 + moving * (ads > 0.5 ? 3 : 0.6));
    const dir = spreadDirection(normalize(m.d), spread, this.rnd);
    const rt = Math.min(now, Math.max(now - MAX_REWIND_MS, m.rt));
    const worldDist = this.world.raycast(origin, dir, WEAPON.range);
    let limit = worldDist ?? WEAPON.range;
    let target = null;
    for (const q2 of this.players.values()) {
      if (q2 === p || !q2.alive) continue;
      const feet = this.positionAt(q2, rt);
      const hit = rayVsPlayer(origin, dir, feet, limit);
      if (hit && hit.dist < limit) {
        limit = hit.dist;
        target = { q: q2, dist: hit.dist, zone: hit.zone };
      }
    }
    const end = [origin[0] + dir[0] * limit, origin[1] + dir[1] * limit, origin[2] + dir[2] * limit];
    const muzzle = [origin[0] + dir[0] * 0.8, origin[1] - 0.12 + dir[1] * 0.8, origin[2] + dir[2] * 0.8];
    this.broadcast({ t: "shot", id: p.id, from: muzzle, to: end, hit: target ? "player" : worldDist !== null ? "world" : "none" }, p);
    if (!target) return;
    p.hitsLanded++;
    const dmg = WEAPON.damage[target.zone];
    const q = target.q;
    q.hp -= dmg;
    const killed = q.hp <= 0;
    this.send(p, { t: "hit", victim: q.id, zone: target.zone, dmg, killed });
    this.send(q, { t: "damaged", from: [...p.pos], hp: Math.max(0, q.hp) });
    if (killed) this.kill(p, q, target.zone, target.dist, now);
  }
  kill(killer, victim, zone, dist2, now) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    killer.kills++;
    victim.respawnAt = now + RESPAWN_SECONDS * 1e3;
    victim.reloadEnd = 0;
    if (!killer.pid || killer.pid !== victim.pid) {
      this.board.recordKill(killer.pid, killer.name, zone === "head");
      this.board.recordDeath(victim.pid);
    }
    this.broadcast({ t: "kill", killer: killer.id, victim: victim.id, zone, dist: dist2 });
    this.send(victim, { t: "died", by: killer.id, respawnIn: RESPAWN_SECONDS });
    this.broadcastScore();
    if (KILL_LIMIT_EFF > 0 && killer.kills >= KILL_LIMIT_EFF && !this.over) {
      this.over = true;
      this.overAt = now;
      this.broadcast({ t: "match", state: "over", winner: killer.id, restartIn: 8 });
    }
  }
  broadcastScore() {
    this.broadcast({ t: "score", players: [...this.players.values()].map((q) => q.info()) });
  }
  // ------------------------------------------------------------ bucle
  /** Aparición lejos de los enemigos vivos. */
  spawn(p, notify) {
    let best = spawns[0];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const q of this.players.values()) if (q !== p && q.alive) d = Math.min(d, Math.hypot(q.pos[0] - s.x, q.pos[2] - s.z));
      if (d === Infinity) d = 1e3 * this.rnd();
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    p.pos = [best.x, 0.05, best.z];
    p.lastGood = [...p.pos];
    p.yaw = best.yaw;
    p.hp = PLAYER_HP;
    p.alive = true;
    p.ammo = WEAPON.magazine;
    p.reserve = WEAPON.reserve;
    p.cooldown = 0;
    p.reloadEnd = 0;
    p.history = [{ t: this.now(), p: [...p.pos] }];
    p.lastStateAt = this.now();
    if (notify) this.send(p, { t: "respawn", p: [...p.pos], yaw: p.yaw });
  }
  lastTick = performance.now();
  tick() {
    const t = performance.now();
    const dt = (t - this.lastTick) / 1e3;
    this.lastTick = t;
    const now = this.now();
    for (const p of this.players.values()) {
      if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.reloadEnd > 0 && now >= p.reloadEnd) {
        const take = Math.min(WEAPON.magazine - p.ammo, p.reserve);
        p.ammo += take;
        p.reserve -= take;
        p.reloadEnd = 0;
      }
      if (!p.alive && !this.over && now >= p.respawnAt) {
        this.spawn(p, true);
        this.broadcastScore();
      }
    }
    if (this.over && now - this.overAt > 8e3) {
      this.over = false;
      for (const p of this.players.values()) {
        p.kills = 0;
        p.deaths = 0;
        this.spawn(p, true);
      }
      this.broadcast({ t: "match", state: "restart" });
      this.broadcastScore();
    }
    if (this.board.version !== this.boardVersion && now - this.lastBoardAt > 1e3) {
      this.boardVersion = this.board.version;
      this.lastBoardAt = now;
      for (const p of this.players.values()) this.sendBoard(p);
    }
    const ps = [];
    for (const p of this.players.values()) ps.push([p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch), p.ads ? 1 : 0, Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0]);
    for (const p of this.players.values()) {
      this.send(p, { t: "snap", st: now, ps, you: { hp: Math.max(0, Math.round(p.hp)), ammo: p.ammo, reserve: p.reserve, reloading: p.reloadEnd > 0, cooldown: p.cooldown }, ack: p.ack });
    }
  }
};
var r2 = (n) => Math.round(n * 100) / 100;
var r3 = (n) => Math.round(n * 1e3) / 1e3;

// server/src/index.ts
var PORT = Number(process.env.PORT ?? 8080);
var HOST = process.env.HOST ?? "0.0.0.0";
var ALLOWED = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
var HERE = import.meta.dirname ?? ".";
var DEFAULT_STATIC = path2.resolve(HERE, "../dist/index.html");
var STATIC_DIR = process.env.STATIC_DIR === "none" ? null : process.env.STATIC_DIR ? path2.resolve(process.env.STATIC_DIR) : fs2.existsSync(path2.resolve("dist/index.html")) ? path2.resolve("dist") : fs2.existsSync(DEFAULT_STATIC) ? path2.dirname(DEFAULT_STATIC) : null;
var worldFile = [path2.resolve(HERE, "../data/world-colliders.json"), path2.resolve(HERE, "data/world-colliders.json")].find((f) => fs2.existsSync(f)) ?? "";
if (!worldFile) throw new Error("No se encuentra world-colliders.json");
var world = new WorldCollision(JSON.parse(fs2.readFileSync(worldFile, "utf8")));
log(`Mundo cargado: ${world.boxes.length} cajas de colisi\xF3n`);
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain"
};
var DATA_DIR = path2.resolve(process.env.DATA_DIR ?? "data");
var leaderboard = new Leaderboard(process.env.DATA_DIR === "none" ? null : path2.join(DATA_DIR, "leaderboard.json"));
var MAX_PLAYERS_EFF = Math.max(2, Math.min(128, Number(process.env.MAX_PLAYERS) || MAX_PLAYERS));
log(`Ranking global: ${leaderboard.size} jugadores con bajas${process.env.DATA_DIR === "none" ? " (solo en memoria)" : ` (${path2.join(DATA_DIR, "leaderboard.json")})`}`);
var room = new Room("GLOBAL", world, leaderboard, MAX_PLAYERS_EFF);
function log(msg) {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)}] ${msg}`);
}
var server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, rooms: 1, players: room.players.size, maxPlayers: MAX_PLAYERS_EFF, ranked: leaderboard.size, protocol: PROTOCOL_VERSION }));
    return;
  }
  if (url === "/api/leaderboard") {
    const q = new URL(req.url ?? "/", "http://x").searchParams;
    const limit = Math.max(1, Math.min(100, Number(q.get("limit")) || 20));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ total: leaderboard.size, top: leaderboard.top(limit) }));
    return;
  }
  if (!STATIC_DIR) {
    res.statusCode = 404;
    res.end("Barcelona FPS server (WebSocket). Usa /health para el estado.");
    return;
  }
  serveStatic(req, res, url);
});
function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url);
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }
  let file = path2.normalize(path2.join(STATIC_DIR, rel === "/" ? "index.html" : rel));
  if (!file.startsWith(STATIC_DIR)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const isFile = (f) => fs2.existsSync(f) && fs2.statSync(f).isFile();
  if (!isFile(file)) {
    if (path2.extname(rel)) {
      res.statusCode = 404;
      res.end("No encontrado");
      return;
    }
    file = path2.join(STATIC_DIR, "index.html");
  }
  const ext = path2.extname(file);
  const headers = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Accept-Encoding"
  };
  const name = path2.basename(file);
  if (ext === ".html") headers["Cache-Control"] = "no-cache";
  else if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name)) headers["Cache-Control"] = "public, max-age=31536000, immutable";
  else headers["Cache-Control"] = "public, max-age=86400";
  let send = file;
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (accept.includes("br") && isFile(file + ".br")) {
    send = file + ".br";
    headers["Content-Encoding"] = "br";
  } else if (accept.includes("gzip") && isFile(file + ".gz")) {
    send = file + ".gz";
    headers["Content-Encoding"] = "gzip";
  }
  const st = fs2.statSync(send);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  headers.ETag = etag;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  headers["Content-Length"] = String(st.size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else fs2.createReadStream(send).pipe(res);
}
var wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (ALLOWED.length > 0 && (!origin || !ALLOWED.includes(origin))) {
    ws.close(1008, "origen no permitido");
    return;
  }
  let player = null;
  let alive = true;
  ws.on("pong", () => alive = true);
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15e3);
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    if (msg.t === "join") {
      if (player) return;
      if (msg.v !== PROTOCOL_VERSION) {
        ws.send(JSON.stringify({ t: "error", msg: "Versi\xF3n de protocolo incompatible" }));
        ws.close();
        return;
      }
      if (room.full) {
        ws.send(JSON.stringify({ t: "error", msg: `Servidor lleno (${MAX_PLAYERS_EFF}/${MAX_PLAYERS_EFF}). Int\xE9ntalo en unos minutos.` }));
        ws.close();
        return;
      }
      player = room.join(ws, msg.name, msg.token);
      log(`${player.name} (#${player.id}${player.pid ? "" : ", sin ranking"}) entra (${room.players.size}/${MAX_PLAYERS_EFF})`);
      return;
    }
    if (player) room.handle(player, msg);
  });
  ws.on("close", () => {
    clearInterval(hb);
    if (player) {
      room.leave(player);
      log(`${player.name} (#${player.id}) sale (${room.players.size}/${MAX_PLAYERS_EFF})`);
    }
  });
  ws.on("error", () => ws.close());
});
server.listen(PORT, HOST, () => log(`Servidor escuchando en ${HOST}:${PORT}${STATIC_DIR ? ` (est\xE1ticos: ${STATIC_DIR})` : ""}`));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`Cerrando (${sig})\u2026`);
    room.dispose();
    leaderboard.flush();
    for (const c of wss.clients) c.close(1001, "servidor cerr\xE1ndose");
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2e3).unref();
  });
}
//# sourceMappingURL=index.mjs.map
