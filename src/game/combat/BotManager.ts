import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { Ballistics } from "../weapons/Ballistics";
import type { LightingRig } from "../world/Lighting";
import { centerChain, outerChains } from "../world/mapLayout";
import { Bot, type BotContext } from "./Bot";

/**
 * Gestiona los bots: generación de puntos de patrulla sobre las aceras, aparición lejos del jugador
 * y reaparición 6 s después de morir.
 */
export class BotManager {
  readonly bots: Bot[] = [];
  readonly waypoints: Vector3[] = [];
  private readonly respawnAt = new Map<Bot, number>();
  private time = 0;

  constructor(private readonly scene: Scene, private readonly ballistics: Ballistics, lighting: LightingRig, count: number, playerPos: () => Vector3) {
    // Puntos de patrulla: aceras junto a fachadas y verjas (2,2 m del borde de edificio, centro de la acera)
    for (const chain of [centerChain, ...outerChains]) {
      for (const seg of chain.segs) {
        if (seg.kind !== "straight" || seg.len < 8) continue;
        for (let t = 4; t < seg.len - 3; t += 9) {
          this.waypoints.push(new Vector3(seg.a.x + seg.ux * t + seg.nx * 2.3, 0.14, seg.a.z + seg.uz * t + seg.nz * 2.3));
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const bot = new Bot(this.scene, i + 1, `Objetivo ${i + 1}`);
      bot.body.position.copyFrom(this.pickSpawn(playerPos()));
      bot.body.computeWorldMatrix(true);
      this.bots.push(bot);
      this.ballistics.actors.push(bot);
      for (const m of bot.casters) lighting.addShadowCaster(m, "prop");
    }
  }

  /** Punto de aparición: lejos del jugador y, si es posible, sin línea de visión con él. */
  pickSpawn(player: Vector3): Vector3 {
    let best = this.waypoints[0];
    let bestScore = -Infinity;
    for (let i = 0; i < 25; i++) {
      const w = this.waypoints[Math.floor(Math.random() * this.waypoints.length)];
      const d = Vector3.Distance(w, player);
      const los = this.ballistics.hasLineOfSight(w.add(new Vector3(0, 1.5, 0)), player.add(new Vector3(0, 1.6, 0)));
      const score = Math.min(d, 90) - (los ? 60 : 0) + Math.random() * 10;
      if (d > 35 && score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    return best.clone();
  }

  private enabled = true;

  /** Activa/desactiva los bots (en multijugador no hay bots): se ocultan, no actualizan y no reciben balas. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const b of this.bots) {
      b.setVisible(on && b.alive);
      b.body.checkCollisions = on && b.alive;
    }
    this.ballistics.actors.length = 0;
    if (on) for (const b of this.bots) this.ballistics.actors.push(b);
  }

  /** Bots vivos. */
  get alive(): number {
    return this.bots.filter((b) => b.alive).length;
  }

  /** Aviso de disparo: los bots cercanos giran hacia el origen del sonido. */
  noise(source: Vector3, radius = 90): void {
    for (const b of this.bots) if (b.alive && Vector3.Distance(b.position, source) < radius) b.hear(source);
  }

  update(dt: number, ctx: Omit<BotContext, "waypoints">, playerPos: Vector3): void {
    if (!this.enabled) return;
    this.time += dt;
    const full: BotContext = { ...ctx, waypoints: this.waypoints };
    for (const b of this.bots) {
      b.update(dt, full);
      if (!b.alive) {
        if (!this.respawnAt.has(b)) this.respawnAt.set(b, this.time + 6);
        else if (this.time >= this.respawnAt.get(b)!) {
          b.respawn(this.pickSpawn(playerPos));
          this.respawnAt.delete(b);
        }
      }
    }
  }

  /** Para pruebas: coloca todos los bots vivos y los lleva a una posición. */
  teleportAll(positions: Vector3[]): void {
    this.bots.forEach((b, i) => {
      if (!b.alive) b.respawn(positions[i % positions.length]);
      b.body.position.copyFrom(positions[i % positions.length]);
      b.body.computeWorldMatrix(true);
    });
  }
}
