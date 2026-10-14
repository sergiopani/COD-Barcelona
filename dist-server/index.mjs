// server/src/loadEnv.ts
import fs from "node:fs";
import path from "node:path";
var file = path.resolve(process.env.ENV_FILE ?? ".env");
try {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === void 0 && v !== "") process.env[m[1]] = v;
  }
} catch {
}

// server/src/index.ts
import fs3 from "node:fs";
import http from "node:http";
import path3 from "node:path";
import { WebSocketServer } from "ws";

// shared/protocol.ts
var PROTOCOL_VERSION = 4;
var MAX_PLAYERS = 32;
var SERVER_TICK_HZ = 20;
var KILL_LIMIT = 0;
var RESPAWN_SECONDS = 3;
var NAME_MAX = 16;
var SKIN_COUNT = 4;

// server/src/GoogleAuth.ts
import crypto from "node:crypto";
var ISSUERS = /* @__PURE__ */ new Set(["https://accounts.google.com", "accounts.google.com"]);
var DEFAULT_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
var GoogleAuth = class {
  constructor(clientId, certsUrl = process.env.GOOGLE_CERTS_URL || DEFAULT_CERTS) {
    this.clientId = clientId;
    this.certsUrl = certsUrl;
  }
  clientId;
  certsUrl;
  keys = /* @__PURE__ */ new Map();
  fetchedAt = 0;
  lastMissRefresh = 0;
  async refreshKeys() {
    const res = await fetch(this.certsUrl, { signal: AbortSignal.timeout(5e3) });
    if (!res.ok) throw new Error(`certificados de Google: HTTP ${res.status}`);
    const body = await res.json();
    const next = /* @__PURE__ */ new Map();
    for (const k of body.keys ?? []) {
      if (k.kty !== "RSA" || !k.kid) continue;
      next.set(k.kid, crypto.createPublicKey({ key: k, format: "jwk" }));
    }
    if (next.size === 0) throw new Error("certificados de Google vac\xEDos");
    this.keys = next;
    this.fetchedAt = Date.now();
  }
  async keyFor(kid) {
    const fresh = Date.now() - this.fetchedAt < 36e5;
    if (!fresh || this.keys.size === 0) await this.refreshKeys();
    let key = this.keys.get(kid) ?? null;
    if (!key && Date.now() - this.lastMissRefresh > 6e4) {
      this.lastMissRefresh = Date.now();
      await this.refreshKeys();
      key = this.keys.get(kid) ?? null;
    }
    return key;
  }
  /** Devuelve el perfil si el token es válido; lanza un Error con el motivo si no. */
  async verify(idToken) {
    if (typeof idToken !== "string" || idToken.length > 4096) throw new Error("token ausente o demasiado largo");
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("formato de token no v\xE1lido");
    const b64 = (s) => Buffer.from(s, "base64url");
    let header;
    let claims;
    try {
      header = JSON.parse(b64(parts[0]).toString("utf8"));
      claims = JSON.parse(b64(parts[1]).toString("utf8"));
    } catch {
      throw new Error("token ilegible");
    }
    if (header.alg !== "RS256" || !header.kid) throw new Error("algoritmo no admitido");
    const key = await this.keyFor(header.kid);
    if (!key) throw new Error("clave de firma desconocida");
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
    if (!ok) throw new Error("firma no v\xE1lida");
    const now = Math.floor(Date.now() / 1e3);
    if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new Error("emisor no v\xE1lido");
    const aud = claims.aud;
    if (aud !== this.clientId && !(Array.isArray(aud) && aud.includes(this.clientId))) throw new Error("el token es de otra aplicaci\xF3n");
    if (typeof claims.exp !== "number" || claims.exp < now - 30) throw new Error("token caducado");
    if (typeof claims.iat === "number" && claims.iat > now + 300) throw new Error("token emitido en el futuro");
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 64) throw new Error("sin identificador de cuenta");
    const email = typeof claims.email === "string" ? claims.email.slice(0, 254) : "";
    const name = typeof claims.name === "string" && claims.name.trim() ? claims.name : typeof claims.given_name === "string" && claims.given_name ? claims.given_name : email.split("@")[0] || "Jugador";
    const picture = typeof claims.picture === "string" && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : "";
    return { sub: claims.sub, name, email, picture };
  }
};

// server/src/Leaderboard.ts
import fs2 from "node:fs";
import path2 from "node:path";
var MAX_ENTRIES = 1e4;
var FILE_VERSION = 2;
var Leaderboard = class {
  /** `file` null = solo en memoria (pruebas). */
  constructor(file2) {
    this.file = file2;
    if (file2) this.load();
  }
  file;
  entries = /* @__PURE__ */ new Map();
  sorted = null;
  saveTimer = null;
  /** Se incrementa en cada cambio (para difundir el ranking solo cuando cambia). */
  version = 0;
  load() {
    const f = this.file;
    try {
      if (!fs2.existsSync(f)) return;
      const data = JSON.parse(fs2.readFileSync(f, "utf8"));
      if (data.version !== FILE_VERSION) throw new Error(`versi\xF3n de archivo ${data.version} (se esperaba ${FILE_VERSION}): ranking an\xF3nimo antiguo`);
      for (const e of data.entries ?? []) {
        if (e && typeof e.id === "string" && Number.isFinite(e.kills)) this.entries.set(e.id, e);
      }
    } catch (err) {
      try {
        fs2.copyFileSync(f, `${f}.corrupt-${Date.now()}`);
      } catch {
      }
      console.error("[Ranking] Archivo corrupto, se ha guardado una copia y se reinicia:", err);
    }
  }
  /** Usuarios con al menos una baja (los que aparecen en el ranking). */
  get size() {
    return this.order().length;
  }
  /** Usuarios guardados (con sesión de Google), tengan bajas o no. */
  get users() {
    return this.entries.size;
  }
  touchChange() {
    this.sorted = null;
    this.version++;
    this.scheduleSave();
  }
  /** Alta o actualización del usuario al iniciar sesión (nombre, correo, foto). Devuelve su ficha. */
  upsertUser(p) {
    const now = Date.now();
    let e = this.entries.get(p.sub);
    if (!e) {
      if (this.entries.size >= MAX_ENTRIES) this.prune();
      e = { id: p.sub, name: p.name, email: p.email, picture: p.picture, kills: 0, deaths: 0, headshots: 0, first: now, last: now, logins: 0 };
      this.entries.set(p.sub, e);
    }
    const nameChanged = e.name !== p.name;
    e.name = p.name;
    e.email = p.email;
    e.picture = p.picture;
    e.last = now;
    e.logins++;
    this.sorted = null;
    if (nameChanged && e.kills > 0) this.version++;
    this.scheduleSave();
    return e;
  }
  /** Suma una baja a un usuario guardado (los invitados no puntúan). */
  recordKill(id, headshot) {
    const e = id ? this.entries.get(id) : void 0;
    if (!e) return;
    e.kills++;
    if (headshot) e.headshots++;
    e.last = Date.now();
    this.touchChange();
  }
  /** Las muertes se acumulan solo para usuarios guardados. */
  recordDeath(id) {
    const e = id ? this.entries.get(id) : void 0;
    if (!e) return;
    e.deaths++;
    this.touchChange();
  }
  order() {
    if (!this.sorted) this.sorted = [...this.entries.values()].filter((e) => e.kills > 0).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.first - b.first);
    return this.sorted;
  }
  top(n) {
    return this.order().slice(0, n).map((e, i) => ({ rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots }));
  }
  /** Cifras de un usuario guardado (null si es invitado). `rank` es 0 mientras no tenga bajas. */
  entry(id) {
    const e = id ? this.entries.get(id) : void 0;
    if (!e) return null;
    const list = this.order();
    const i = e.kills > 0 ? list.findIndex((x) => x.id === e.id) : -1;
    return { rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots, total: list.length };
  }
  prune() {
    const all = [...this.entries.values()].sort((a, b) => b.kills - a.kills || b.last - a.last);
    for (const e of all.slice(MAX_ENTRIES - 100)) this.entries.delete(e.id);
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
      fs2.mkdirSync(path2.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs2.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, entries: [...this.entries.values()] }));
      fs2.renameSync(tmp, this.file);
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
var PARK_CX = -STREET.pitch;
var WEST_STREET_AXIS = PARK_CX - STREET_AXIS;
var WEST_WALL = WEST_STREET_AXIS - STREET.width / 2;
var WORLD = { minX: WEST_WALL - 8, maxX: ARM_END + 8, minZ: -(ARM_END + 8), maxZ: ARM_END + 8 };
var GROUND = {
  cx: (WEST_WALL - 6 + ARM_END + 6) / 2,
  width: ARM_END + 6 - (WEST_WALL - 6),
  depth: (ARM_END + 6) * 2
};

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
  if (x < -100) return isRoadBase(x, z) || isRoadBase(x - PARK_CX, z);
  return isRoadBase(x, z);
}
function isRoadBase(x, z) {
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
var PW = PARK_CX - B;
var cornerNW = [v2(PW, E), v2(PW, O + C), v2(PW + C, O), v2(-(O + C), O), v2(-O, O + C), v2(-O, E)];
var cornerSW = [v2(-O, -E), v2(-O, -(O + C)), v2(-(O + C), -O), v2(PW + C, -O), v2(PW, -(O + C)), v2(PW, -E)];
var outerChains = [];
for (let k = 0; k < 4; k++) {
  if (k !== 3) outerChains.push(makeChain(`side${k}`, "outer", northBlock.map((p) => rotateCW(p, k)), false));
  const pts = k === 3 ? cornerNW : k === 2 ? cornerSW : cornerBlock.map((p) => rotateCW(p, k));
  outerChains.push(makeChain(`corner${k}`, "outer", pts, false));
}
outerChains.push(makeChain("wallW", "outer", [v2(WEST_WALL, -E), v2(WEST_WALL, E)], false));
var endcapChains = [];
for (let k = 0; k < 4; k++) {
  if (k === 3) continue;
  endcapChains.push(makeChain(`cap${k}a`, "endcap", endcapEast.map((p) => rotateCW(p, k)), false));
  endcapChains.push(makeChain(`cap${k}b`, "endcap", endcapWest.map((p) => rotateCW(p, k)), false));
}
endcapChains.push(makeChain("capW0", "endcap", [v2(WEST_WALL, E), v2(WEST_WALL + STREET.width, E)], false));
endcapChains.push(makeChain("capW1", "endcap", [v2(WEST_WALL + STREET.width, -E), v2(WEST_WALL, -E)], false));
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
var parkChain = makeChain("park", "park", centerChain.points.map((p) => v2(p.x + PARK_CX, p.z)), true);
var sidewalkChains = [
  centerChain,
  parkChain,
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
for (const sz of [-1, 1]) {
  crosswalks.push({ x: WEST_STREET_AXIS, z: sz * (B - C - 2), axis: "z" });
  crosswalks.push({ x: WEST_STREET_AXIS, z: sz * (O + C + 2), axis: "z" });
  crosswalks.push({ x: WEST_STREET_AXIS + (S - (B - C - 2)), z: sz * S, axis: "x" });
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
    streetRuns.push({ axis: "x", at: sgn * S, from: side > 0 ? a : WEST_STREET_AXIS + 32, to: side > 0 ? b : -a });
    streetRuns.push({ axis: "z", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
  }
}
streetRuns.push({ axis: "z", at: WEST_STREET_AXIS, from: -ringHalf, to: ringHalf });
for (const side of [-1, 1]) {
  const a = O + C + 8;
  const b = ARM_END - 2;
  streetRuns.push({ axis: "z", at: WEST_STREET_AXIS, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
}
var props = [];
var rng = new Rng(20260626);
function addProp(kind, x, z, ux, uz, cover, variant = rng.int(0, 7)) {
  props.push({ kind, x, z, ux, uz, variant, cover });
}
for (const chain of [centerChain, parkChain, ...outerChains]) {
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
    if (seg.len > 40 && chain.role !== "center" && chain.role !== "park") {
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
{
  const wanted = /* @__PURE__ */ new Map([["side0", [0.3, 0.72]], ["side1", [0.3, 0.72]], ["side2", [0.3, 0.72]], ["side3", [0.3, 0.72]]]);
  for (const chain of outerChains) {
    for (const frac of wanted.get(chain.id) ?? []) {
      const seg = chain.segs.filter((s) => s.kind === "straight").sort((a, b) => b.len - a.len)[0];
      if (!seg) continue;
      for (let k = 0; k < 40; k++) {
        const t = seg.len * frac + k * 0.8;
        if (t > seg.len - 4) break;
        const x = seg.a.x + seg.ux * t + seg.nx * 1.7, z = seg.a.z + seg.uz * t + seg.nz * 1.7;
        if (nearCrosswalk(x, z, 3)) continue;
        if (props.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4)) continue;
        addProp("mailbox", x, z, seg.ux, seg.uz, true, 0);
        break;
      }
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
  { x: -100, z: S + 1.5, yaw: Math.PI / 2 },
  { x: WEST_STREET_AXIS + 1.5, z: -30, yaw: Math.PI / 2 },
  // calle oeste, mirando al parque
  { x: -150, z: -S - 1.5, yaw: -Math.PI / 2 }
];
var POND = { u: 18, v: -12, rx: 23, rz: 25 };
function pondFactor(th) {
  return 1 + 0.1 * Math.sin(3 * th + 0.8) + 0.06 * Math.sin(5 * th + 2.1);
}
function pondPoint(th, scale = 1, extra = 0) {
  const k = pondFactor(th);
  return v2(POND.u + Math.cos(th) * (POND.rx * k * scale + extra), POND.v + Math.sin(th) * (POND.rz * k * scale + extra));
}
var PARK_RING_EXTRA = 6;
var parkPaths = [];
{
  const ring = [];
  for (let i = 0; i < 48; i++) ring.push(pondPoint(i / 48 * Math.PI * 2, 1, PARK_RING_EXTRA));
  parkPaths.push({ pts: ring, width: 3.2, closed: true });
  const spoke = (th, to) => parkPaths.push({ pts: [pondPoint(th, 1, PARK_RING_EXTRA), to], width: 2.6, closed: false });
  spoke(Math.PI / 2, v2(POND.u + 4, B));
  spoke(-Math.PI / 2, v2(POND.u - 4, -B));
  spoke(Math.PI, v2(-B, POND.v - 3));
}
var parkPlaza = { u0: B - 13, u1: B, v0: -(B - C), v1: B - C };
function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
function distToParkPath(u, v) {
  let best = Infinity;
  for (const path4 of parkPaths) {
    const n = path4.pts.length;
    const count = path4.closed ? n : n - 1;
    for (let i = 0; i < count; i++) best = Math.min(best, distToSeg(v2(u, v), path4.pts[i], path4.pts[(i + 1) % n]) - path4.width / 2);
  }
  return best;
}
function distToPond(u, v) {
  const du = u - POND.u;
  const dv = v - POND.v;
  const th = Math.atan2(dv / POND.rz, du / POND.rx);
  const edge = pondPoint(th);
  return Math.hypot(du, dv) - Math.hypot(edge.x - POND.u, edge.z - POND.v);
}
function insidePark(u, v, margin = 0) {
  const h = B - margin;
  return Math.abs(u) <= h && Math.abs(v) <= h && Math.abs(u) + Math.abs(v) <= 2 * B - C - margin * 1.414;
}
function inParkPlaza(u, v, margin = 0) {
  return u > parkPlaza.u0 - margin && u < parkPlaza.u1 + margin && v > parkPlaza.v0 - margin && v < parkPlaza.v1 + margin;
}
var parkBushes = [];
{
  const prng = new Rng(20260705);
  const free = (u, v, pondM, pathM) => insidePark(u, v, 3) && !inParkPlaza(u, v, 2) && distToPond(u, v) > pondM && distToParkPath(u, v) > pathM;
  const wx = (u) => u + PARK_CX;
  const trees = [];
  for (let tries = 0; tries < 900 && trees.length < 30; tries++) {
    const u = prng.range(-B, B);
    const v = prng.range(-B, B);
    if (!free(u, v, 3.5, 2.2) || trees.some((t) => Math.hypot(t.x - u, t.z - v) < 8)) continue;
    trees.push(v2(u, v));
    addProp("tree", wx(u), v, 1, 0, false, prng.int(0, 7));
  }
  for (let tries = 0; tries < 1400 && parkBushes.length < 90; tries++) {
    const u = prng.range(-B, B);
    const v = prng.range(-B, B);
    if (!free(u, v, 0.8, 1.4) || trees.some((t) => Math.hypot(t.x - u, t.z - v) < 1.6)) continue;
    const r = prng.range(0.7, 1.7);
    parkBushes.push({ x: wx(u), z: v, r, h: r * prng.range(0.55, 0.9), tint: prng.range(0.8, 1.15) });
  }
  for (let i = 0; i < 10; i++) {
    const th = (i + 0.5) / 10 * Math.PI * 2;
    const p = pondPoint(th, 1, PARK_RING_EXTRA + 2.6);
    const q = pondPoint(th, 1, 0);
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    if (!insidePark(p.x, p.z, 4) || inParkPlaza(p.x, p.z, 3)) continue;
    addProp(i % 2 === 0 ? "bench" : "lamp", wx(p.x), p.z, -dz / l, dx / l, i % 2 === 0, prng.int(0, 7));
  }
  for (const [u, v] of [[-30, 50], [-8, -46], [50, 30], [-48, -20]]) addProp("bin", wx(u), v, 1, 0, false);
}

// server/src/Room.ts
var MAX_SPEED = 7.2;
var SPEED_TOLERANCE = 1.6;
var MAX_REWIND_MS = 400;
var HISTORY_MS = 1500;
var KILL_LIMIT_EFF = process.env.KILL_LIMIT !== void 0 ? Number(process.env.KILL_LIMIT) || 0 : KILL_LIMIT;
var ServerPlayer = class {
  /** `sub` de Google si es un usuario guardado; null = invitado (no puntúa ni se guarda). */
  constructor(id, name, ws, pid, skin = 0) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.pid = pid;
    this.skin = skin;
  }
  id;
  name;
  ws;
  pid;
  skin;
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
    return { id: this.id, name: this.name, kills: this.kills, deaths: this.deaths, alive: this.alive, skin: this.skin };
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
  /** Personaje válido (entero 0..SKIN_COUNT-1) o 0. */
  static sanitizeSkin(raw) {
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < SKIN_COUNT ? raw : 0;
  }
  static sanitizeName(raw, fallback) {
    if (typeof raw !== "string") return fallback;
    const clean = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, NAME_MAX);
    return clean || fallback;
  }
  /** `user` = perfil de Google ya VERIFICADO por el servidor (null = invitado con nickname). */
  join(ws, name, user = null, skinRaw) {
    const id = this.nextId++;
    if (user) this.board.upsertUser(user);
    const p = new ServerPlayer(id, _Room.sanitizeName(user ? user.name : name, `Jugador ${id}`), ws, user ? user.sub : null, _Room.sanitizeSkin(skinRaw));
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
      registered: !!user,
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
    if (x < WORLD.minX + 6 || x > 128 || Math.abs(z) > 128 || y < -0.5 || y > 5) reason = "fuera de los l\xEDmites";
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
      this.board.recordKill(killer.pid, zone === "head");
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
var DEFAULT_STATIC = path3.resolve(HERE, "../dist/index.html");
var STATIC_DIR = process.env.STATIC_DIR === "none" ? null : process.env.STATIC_DIR ? path3.resolve(process.env.STATIC_DIR) : fs3.existsSync(path3.resolve("dist/index.html")) ? path3.resolve("dist") : fs3.existsSync(DEFAULT_STATIC) ? path3.dirname(DEFAULT_STATIC) : null;
var worldFile = [path3.resolve(HERE, "../data/world-colliders.json"), path3.resolve(HERE, "data/world-colliders.json")].find((f) => fs3.existsSync(f)) ?? "";
if (!worldFile) throw new Error("No se encuentra world-colliders.json");
var world = new WorldCollision(JSON.parse(fs3.readFileSync(worldFile, "utf8")));
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
var DATA_DIR = path3.resolve(process.env.DATA_DIR ?? "data");
var leaderboard = new Leaderboard(process.env.DATA_DIR === "none" ? null : path3.join(DATA_DIR, "leaderboard.json"));
var MAX_PLAYERS_EFF = Math.max(2, Math.min(128, Number(process.env.MAX_PLAYERS) || MAX_PLAYERS));
log(`Ranking global: ${leaderboard.size} jugadores con bajas${process.env.DATA_DIR === "none" ? " (solo en memoria)" : ` (${path3.join(DATA_DIR, "leaderboard.json")})`}`);
var room = new Room("GLOBAL", world, leaderboard, MAX_PLAYERS_EFF);
var GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
var googleAuth = GOOGLE_CLIENT_ID ? new GoogleAuth(GOOGLE_CLIENT_ID) : null;
log(googleAuth ? `Inicio de sesi\xF3n con Google activo (cliente ${GOOGLE_CLIENT_ID.slice(0, 12)}\u2026)` : "Inicio de sesi\xF3n con Google NO configurado (define GOOGLE_CLIENT_ID): solo invitados");
function log(msg) {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)}] ${msg}`);
}
var server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, rooms: 1, players: room.players.size, maxPlayers: MAX_PLAYERS_EFF, ranked: leaderboard.size, users: leaderboard.users, google: !!googleAuth, protocol: PROTOCOL_VERSION }));
    return;
  }
  if (url === "/api/config") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID || null, maxPlayers: MAX_PLAYERS_EFF }));
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
  let file2 = path3.normalize(path3.join(STATIC_DIR, rel === "/" ? "index.html" : rel));
  if (!file2.startsWith(STATIC_DIR)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const isFile = (f) => fs3.existsSync(f) && fs3.statSync(f).isFile();
  if (!isFile(file2)) {
    if (path3.extname(rel)) {
      res.statusCode = 404;
      res.end("No encontrado");
      return;
    }
    file2 = path3.join(STATIC_DIR, "index.html");
  }
  const ext = path3.extname(file2);
  const headers = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Accept-Encoding"
  };
  const name = path3.basename(file2);
  if (ext === ".html") headers["Cache-Control"] = "no-cache";
  else if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name)) headers["Cache-Control"] = "public, max-age=31536000, immutable";
  else headers["Cache-Control"] = "public, max-age=86400";
  let send = file2;
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (accept.includes("br") && isFile(file2 + ".br")) {
    send = file2 + ".br";
    headers["Content-Encoding"] = "br";
  } else if (accept.includes("gzip") && isFile(file2 + ".gz")) {
    send = file2 + ".gz";
    headers["Content-Encoding"] = "gzip";
  }
  const st = fs3.statSync(send);
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
  else fs3.createReadStream(send).pipe(res);
}
var wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (ALLOWED.length > 0 && (!origin || !ALLOWED.includes(origin))) {
    ws.close(1008, "origen no permitido");
    return;
  }
  let player = null;
  let joining = false;
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
      if (joining) return;
      const finish = (user) => {
        if (ws.readyState !== ws.OPEN) return;
        if (room.full) {
          ws.send(JSON.stringify({ t: "error", msg: `Servidor lleno (${MAX_PLAYERS_EFF}/${MAX_PLAYERS_EFF}). Int\xE9ntalo en unos minutos.` }));
          ws.close();
          return;
        }
        player = room.join(ws, msg.name, user, msg.skin);
        log(`${player.name} (#${player.id}${user ? ", Google" : ", invitado"}) entra (${room.players.size}/${MAX_PLAYERS_EFF})`);
      };
      if (msg.idToken === void 0 || msg.idToken === null || msg.idToken === "") {
        finish(null);
        return;
      }
      if (!googleAuth) {
        ws.send(JSON.stringify({ t: "error", msg: "El inicio de sesi\xF3n con Google no est\xE1 disponible en este servidor" }));
        ws.close();
        return;
      }
      joining = true;
      googleAuth.verify(msg.idToken).then(
        (user) => {
          joining = false;
          finish(user);
        },
        (err) => {
          joining = false;
          log(`Inicio de sesi\xF3n rechazado: ${err.message}`);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "error", msg: "Sesi\xF3n de Google no v\xE1lida o caducada: vuelve a iniciar sesi\xF3n" }));
          ws.close();
        }
      );
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
