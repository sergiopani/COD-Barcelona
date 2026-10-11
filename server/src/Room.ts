import type WebSocket from "ws";
import {
  KILL_LIMIT,
  MAX_PLAYERS,
  NAME_MAX,
  RESPAWN_SECONDS,
  SERVER_TICK_HZ,
  type ClientMsg,
  type PlayerInfo,
  type ServerMsg,
  type SnapPlayer,
  type Vec3,
} from "../../shared/protocol";
import { EYE_HEIGHT, PLAYER_HP, WEAPON, normalize, rayVsPlayer, spreadDirection, type V3 } from "../../shared/combat";
import type { WorldCollision } from "../../shared/world";
import { spawns } from "../../src/game/world/mapLayout";

/** Límites de validación de movimiento. */
const MAX_SPEED = 7.2; // m/s en llano (correr = 7,0)
const SPEED_TOLERANCE = 1.6; // margen por jitter de red
const MAX_REWIND_MS = 400;
const HISTORY_MS = 1500;
/** Límite de bajas configurable por entorno (KILL_LIMIT) para pruebas. */
const KILL_LIMIT_EFF = Number(process.env.KILL_LIMIT) || KILL_LIMIT;

interface Sample {
  t: number;
  p: Vec3;
}

export class ServerPlayer {
  pos: Vec3 = [0, 0.05, 0];
  yaw = 0;
  pitch = 0;
  ads = false;
  hp = PLAYER_HP;
  alive = true;
  ammo = WEAPON.magazine;
  reserve = WEAPON.reserve;
  cooldown = 0; // s
  reloadEnd = 0; // ms de sala; 0 = no recargando
  kills = 0;
  deaths = 0;
  respawnAt = 0;
  lastStateAt = 0;
  lastGood: Vec3 = [0, 0.05, 0];
  ack = 0;
  violations = 0;
  history: Sample[] = [];
  lastFireAt = -1e9;
  msgWindowStart = 0;
  msgCount = 0;
  alivePong = true;
  shots = 0;
  hitsLanded = 0;

  constructor(readonly id: number, public name: string, readonly ws: WebSocket) {}

  info(): PlayerInfo {
    return { id: this.id, name: this.name, kills: this.kills, deaths: this.deaths, alive: this.alive };
  }
}

/**
 * Una sala de hasta 8 jugadores: todo el estado de juego importante vive aquí (autoritativo).
 * Modo: todos contra todos hasta KILL_LIMIT bajas.
 */
export class Room {
  readonly players = new Map<number, ServerPlayer>();
  private nextId = 1;
  private readonly start = performance.now();
  private timer: NodeJS.Timeout;
  private over = false;
  private overAt = 0;
  /** Para pruebas deterministas. */
  rnd: () => number = Math.random;

  constructor(readonly code: string, private readonly world: WorldCollision, readonly isPrivate: boolean) {
    this.timer = setInterval(() => this.tick(), 1000 / SERVER_TICK_HZ);
  }

  now(): number {
    return performance.now() - this.start;
  }
  get full(): boolean {
    return this.players.size >= MAX_PLAYERS;
  }
  get empty(): boolean {
    return this.players.size === 0;
  }
  dispose(): void {
    clearInterval(this.timer);
  }

  private send(p: ServerPlayer, msg: ServerMsg): void {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
  private broadcast(msg: ServerMsg, except?: ServerPlayer): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }

  static sanitizeName(raw: unknown, fallback: string): string {
    if (typeof raw !== "string") return fallback;
    // quita caracteres de control y espacios sobrantes
    const clean = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, NAME_MAX);
    return clean || fallback;
  }

  join(ws: WebSocket, name: string): ServerPlayer {
    const id = this.nextId++;
    const p = new ServerPlayer(id, Room.sanitizeName(name, `Jugador ${id}`), ws);
    this.players.set(id, p);
    this.spawn(p, false);
    this.send(p, { t: "welcome", id, room: this.code, serverTime: this.now(), players: [...this.players.values()].map((q) => q.info()), killLimit: KILL_LIMIT_EFF, spawn: [...p.pos] as Vec3, yaw: p.yaw });
    this.broadcast({ t: "joined", player: p.info() }, p);
    return p;
  }

  leave(p: ServerPlayer): void {
    if (this.players.delete(p.id)) this.broadcast({ t: "left", id: p.id });
  }

  // ------------------------------------------------------------ mensajes del cliente

  handle(p: ServerPlayer, msg: ClientMsg): void {
    const now = this.now();
    // límite de tasa: ≤ 120 mensajes/s
    if (now - p.msgWindowStart > 1000) {
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
          p.pos = [...msg.p] as Vec3;
          p.lastGood = [...msg.p] as Vec3;
          p.history = [{ t: now, p: [...msg.p] as Vec3 }];
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

  private finite3(v: unknown): v is Vec3 {
    return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  }

  private onState(p: ServerPlayer, m: Extract<ClientMsg, { t: "state" }>, now: number): void {
    if (!this.finite3(m.p) || !Number.isFinite(m.yaw) || !Number.isFinite(m.pitch)) return;
    p.ack = Number.isFinite(m.seq) ? m.seq : p.ack;
    if (!p.alive || this.over) return;
    const [x, y, z] = m.p;
    const dt = Math.min(0.5, Math.max(0.01, (now - p.lastStateAt) / 1000));
    p.lastStateAt = now;
    let reason: string | null = null;
    if (Math.abs(x) > 128 || Math.abs(z) > 128 || y < -0.5 || y > 5) reason = "fuera de los límites";
    else {
      const dist = Math.hypot(x - p.pos[0], z - p.pos[2]);
      if (dist > MAX_SPEED * SPEED_TOLERANCE * dt + 0.6) reason = "velocidad imposible";
      else if (this.world.penetration(m.p) > 0.35) reason = "dentro de un sólido";
    }
    if (reason) {
      p.violations++;
      this.send(p, { t: "correct", p: [...p.lastGood] as Vec3, reason });
      // tras corregir se parte de la última posición válida
      p.pos = [...p.lastGood] as Vec3;
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

  private onReload(p: ServerPlayer, now: number): void {
    if (!p.alive || this.over || p.reloadEnd > 0 || p.ammo >= WEAPON.magazine || p.reserve <= 0) return;
    p.reloadEnd = now + WEAPON.reloadTime * 1000;
  }

  /** Posición interpolada de un jugador en el instante `t` (historial de estados). */
  private positionAt(q: ServerPlayer, t: number): Vec3 {
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

  private onFire(p: ServerPlayer, m: Extract<ClientMsg, { t: "fire" }>, now: number): void {
    if (!p.alive || this.over || p.reloadEnd > 0) return;
    if (p.cooldown > 0.06 || p.ammo <= 0) return; // el cerrojo manda: tolerancia de red de 60 ms
    if (!this.finite3(m.d) || !Number.isFinite(m.rt)) return;
    p.ammo--;
    p.cooldown = WEAPON.cycleTime;
    p.shots++;

    // el origen lo decide el servidor (posición validada + altura de ojos)
    const origin: V3 = [p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]];
    // velocidad reciente (para la dispersión por movimiento)
    let speed = 0;
    const h = p.history;
    if (h.length >= 2) {
      const a = h[Math.max(0, h.length - 5)];
      const b = h[h.length - 1];
      speed = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / Math.max(0.05, (b.t - a.t) / 1000);
    }
    const ads = p.ads ? Math.max(0, Math.min(1, Number(m.ads) || 0)) : 0;
    const moving = Math.min(1, speed / 5);
    const spread = (WEAPON.hipSpread * (1 - ads) + WEAPON.adsSpread * ads) * (1 + moving * (ads > 0.5 ? 3 : 0.6));
    const dir = spreadDirection(normalize(m.d as V3), spread, this.rnd);

    // compensación de latencia: se rebobina a los demás al instante que veía el tirador
    const rt = Math.min(now, Math.max(now - MAX_REWIND_MS, m.rt));
    const worldDist = this.world.raycast(origin, dir, WEAPON.range);
    let limit = worldDist ?? WEAPON.range;
    let target: { q: ServerPlayer; dist: number; zone: "head" | "torso" | "legs" } | null = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const feet = this.positionAt(q, rt);
      const hit = rayVsPlayer(origin, dir, feet, limit);
      if (hit && hit.dist < limit) {
        limit = hit.dist;
        target = { q, dist: hit.dist, zone: hit.zone };
      }
    }
    const end: Vec3 = [origin[0] + dir[0] * limit, origin[1] + dir[1] * limit, origin[2] + dir[2] * limit];
    const muzzle: Vec3 = [origin[0] + dir[0] * 0.8, origin[1] - 0.12 + dir[1] * 0.8, origin[2] + dir[2] * 0.8];
    this.broadcast({ t: "shot", id: p.id, from: muzzle, to: end, hit: target ? "player" : worldDist !== null ? "world" : "none" }, p);

    if (!target) return;
    p.hitsLanded++;
    const dmg = WEAPON.damage[target.zone];
    const q = target.q;
    q.hp -= dmg;
    const killed = q.hp <= 0;
    this.send(p, { t: "hit", victim: q.id, zone: target.zone, dmg, killed });
    this.send(q, { t: "damaged", from: [...p.pos] as Vec3, hp: Math.max(0, q.hp) });
    if (killed) this.kill(p, q, target.zone, target.dist, now);
  }

  private kill(killer: ServerPlayer, victim: ServerPlayer, zone: "head" | "torso" | "legs", dist: number, now: number): void {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    killer.kills++;
    victim.respawnAt = now + RESPAWN_SECONDS * 1000;
    victim.reloadEnd = 0;
    this.broadcast({ t: "kill", killer: killer.id, victim: victim.id, zone, dist });
    this.send(victim, { t: "died", by: killer.id, respawnIn: RESPAWN_SECONDS });
    this.broadcastScore();
    if (killer.kills >= KILL_LIMIT_EFF && !this.over) {
      this.over = true;
      this.overAt = now;
      this.broadcast({ t: "match", state: "over", winner: killer.id, restartIn: 8 });
    }
  }

  private broadcastScore(): void {
    this.broadcast({ t: "score", players: [...this.players.values()].map((q) => q.info()) });
  }

  // ------------------------------------------------------------ bucle

  /** Aparición lejos de los enemigos vivos. */
  private spawn(p: ServerPlayer, notify: boolean): void {
    let best = spawns[0];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const q of this.players.values()) if (q !== p && q.alive) d = Math.min(d, Math.hypot(q.pos[0] - s.x, q.pos[2] - s.z));
      if (d === Infinity) d = 1000 * this.rnd();
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    p.pos = [best.x, 0.05, best.z];
    p.lastGood = [...p.pos] as Vec3;
    p.yaw = best.yaw;
    p.hp = PLAYER_HP;
    p.alive = true;
    p.ammo = WEAPON.magazine;
    p.reserve = WEAPON.reserve;
    p.cooldown = 0;
    p.reloadEnd = 0;
    p.history = [{ t: this.now(), p: [...p.pos] as Vec3 }];
    p.lastStateAt = this.now();
    if (notify) this.send(p, { t: "respawn", p: [...p.pos] as Vec3, yaw: p.yaw });
  }

  private lastTick = performance.now();
  private tick(): void {
    const t = performance.now();
    const dt = (t - this.lastTick) / 1000;
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

    // fin de partida → reinicio
    if (this.over && now - this.overAt > 8000) {
      this.over = false;
      for (const p of this.players.values()) {
        p.kills = 0;
        p.deaths = 0;
        this.spawn(p, true);
      }
      this.broadcast({ t: "match", state: "restart" });
      this.broadcastScore();
    }

    // instantánea (20 Hz)
    const ps: SnapPlayer[] = [];
    for (const p of this.players.values()) ps.push([p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch), p.ads ? 1 : 0, Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0]);
    for (const p of this.players.values()) {
      this.send(p, { t: "snap", st: now, ps, you: { hp: Math.max(0, Math.round(p.hp)), ammo: p.ammo, reserve: p.reserve, reloading: p.reloadEnd > 0, cooldown: p.cooldown }, ack: p.ack });
    }
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
