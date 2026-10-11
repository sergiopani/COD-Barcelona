import { Scene, Vector3 } from "@babylonjs/core";
import type { AudioManager } from "../audio/AudioManager";
import type { InputManager } from "../player/InputManager";
import type { PlayerController } from "../player/PlayerController";
import type { Hud } from "../ui/Hud";
import { Ballistics } from "../weapons/Ballistics";
import { Effects } from "../weapons/Effects";
import { Viewmodel } from "../weapons/Viewmodel";
import { M1A_SNIPER, type WeaponDefinition } from "../weapons/WeaponDefinition";
import { WeaponController } from "../weapons/WeaponController";
import type { MultiplayerSession } from "../multiplayer/MultiplayerSession";
import type { BarcelonaMap } from "../world/BarcelonaMap";
import type { LightingRig } from "../world/Lighting";
import type { Bot } from "./Bot";
import { BotManager } from "./BotManager";

const RESPAWN_SECONDS = 3;
const REGEN_DELAY = 8;
const REGEN_RATE = 5;

/**
 * Sistema de combate para un jugador: salud (100 PS), muerte y reaparición, estadísticas, bots-objetivo y arma.
 * La lógica es local (modo individual). El servidor autoritativo llegará con el multijugador (Fase 3).
 */
export class CombatSystem {
  health = 100;
  alive = true;
  kills = 0;
  deaths = 0;
  headshots = 0;
  shots = 0;
  hits = 0;
  private respawnTimer = 0;
  /** Sesión multijugador (null = modo individual con bots). */
  mp: MultiplayerSession | null = null;
  private sinceDamage = 99;
  readonly ballistics: Ballistics;
  readonly effects: Effects;
  readonly bots: BotManager;
  readonly viewmodel: Viewmodel;
  readonly weapon: WeaponController;

  constructor(
    private readonly scene: Scene,
    private readonly map: BarcelonaMap,
    private readonly player: PlayerController,
    input: InputManager,
    private readonly audio: AudioManager,
    private readonly hud: Hud,
    lighting: LightingRig,
    def: WeaponDefinition = M1A_SNIPER,
    botCount = 6,
  ) {
    this.ballistics = new Ballistics(map.collisions);
    this.effects = new Effects(scene);
    this.viewmodel = new Viewmodel(scene, player.camera, def);
    this.bots = new BotManager(scene, this.ballistics, lighting, botCount, () => player.position);
    this.weapon = new WeaponController(def, player, input, this.ballistics, this.effects, audio, this.viewmodel, {
      onShot: () => {
        this.shots++;
        if (!this.mp) this.bots.noise(player.position);
      },
      onFire: (origin, forward, ads) => this.mp?.sendFire(origin, forward, ads),
      onReload: () => this.mp?.sendReload(),
      onActorHit: (actor, dmg, zone) => this.hitBot(actor as Bot, dmg, zone),
    });
  }

  async init(): Promise<void> {
    await this.viewmodel.load();
    this.scene.setRenderingAutoClearDepthStencil(1, true, true, false); // el arma se dibuja sobre el mundo
  }

  /** Proxy de la basílica para que las balas también impacten en ella. */
  setBasilicaProxy(): void {
    const proxy = this.scene.getMeshByName("sagradaShadowProxy");
    if (proxy) this.ballistics.setBasilicaProxy(proxy as never);
  }

  private hitBot(bot: Bot, damage: number, zone: "head" | "torso" | "legs"): boolean {
    this.hits++;
    const killed = bot.damage(damage, this.player.position);
    const dist = Vector3.Distance(this.player.position, bot.position);
    if (killed) {
      this.kills++;
      if (zone === "head") this.headshots++;
      this.hud.hitMarker("kill");
      this.audio.hitMarker("kill");
      this.hud.feed(`${bot.name} eliminado · ${zone === "head" ? "cabeza" : zone === "torso" ? "torso" : "piernas"} · ${dist.toFixed(0)} m`);
    } else {
      const kind = zone === "head" ? "head" : "body";
      this.hud.hitMarker(kind);
      this.audio.hitMarker(kind);
    }
    return killed;
  }

  /** Entra en modo multijugador: sin bots, el servidor decide salud, munición y bajas. */
  enterMultiplayer(session: MultiplayerSession): void {
    this.mp = session;
    this.bots.setEnabled(false);
    this.kills = this.deaths = this.headshots = this.shots = this.hits = 0;
    this.health = 100;
    this.alive = true;
    this.weapon.reset();
  }

  // ---- eventos del servidor (multijugador)
  applyServerState(you: { hp: number; ammo: number; reserve: number; reloading: boolean }): void {
    if (this.alive) this.health = you.hp;
    this.weapon.applyServerState(you);
  }
  mpHitConfirmed(zone: "head" | "torso" | "legs", killed: boolean): void {
    this.hits++;
    if (killed && zone === "head") this.headshots++;
    const kind = killed ? "kill" : zone === "head" ? "head" : "body";
    this.hud.hitMarker(kind);
    this.audio.hitMarker(kind);
  }
  mpDamaged(from: Vector3): void {
    this.sinceDamage = 0;
    this.hud.damageFrom(Math.atan2(from.x - this.player.position.x, from.z - this.player.position.z) - this.player.yaw);
    this.audio.hurt();
  }
  mpDeath(respawnIn: number): void {
    this.alive = false;
    this.health = 0;
    this.respawnTimer = respawnIn;
    this.player.setDead(true);
    this.audio.death();
    this.hud.showDeath(respawnIn);
  }
  mpRespawn(p: [number, number, number], yaw: number): void {
    this.player.teleport(p[0], p[1], p[2], yaw);
    this.player.setDead(false);
    this.alive = true;
    this.health = 100;
    this.weapon.reset();
    this.audio.respawn();
    this.hud.hideDeath();
  }

  /** Daño recibido por el jugador (de bots). */
  damagePlayer(amount: number, from: Vector3): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceDamage = 0;
    const dx = from.x - this.player.position.x;
    const dz = from.z - this.player.position.z;
    this.hud.damageFrom(Math.atan2(dx, dz) - this.player.yaw);
    this.audio.hurt();
    if (this.health <= 0) this.die();
  }

  private die(): void {
    this.alive = false;
    this.deaths++;
    this.respawnTimer = RESPAWN_SECONDS;
    this.player.setDead(true);
    this.audio.death();
    this.hud.showDeath(this.respawnTimer);
    this.hud.feed("Has sido eliminado", true);
  }

  respawn(): void {
    // aparición lo más lejos posible de los bots vivos
    let best = this.map.spawns[0];
    let bestD = -1;
    for (const s of this.map.spawns) {
      let d = Infinity;
      for (const b of this.bots.bots) if (b.alive) d = Math.min(d, Vector3.Distance(new Vector3(s.x, 0, s.z), b.position));
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    this.player.teleport(best.x, 0.05, best.z, best.yaw);
    this.player.setDead(false);
    this.health = 100;
    this.alive = true;
    this.weapon.reset();
    this.audio.respawn();
    this.hud.hideDeath();
  }

  /** `active` = el juego está en marcha (cursor bloqueado). */
  update(dt: number, active: boolean): void {
    this.effects.update(dt);
    if (!active) {
      this.weapon.update(dt, false);
      return;
    }
    if (this.mp) {
      // multijugador: salud/muerte/bots los gobierna el servidor
      if (!this.alive) {
        this.respawnTimer = Math.max(0, this.respawnTimer - dt);
        this.hud.showDeath(this.respawnTimer);
      }
      this.weapon.update(dt, this.alive);
      return;
    }
    if (!this.alive) {
      this.respawnTimer -= dt;
      this.hud.showDeath(Math.max(0, this.respawnTimer));
      if (this.respawnTimer <= 0) this.respawn();
    } else {
      this.sinceDamage += dt;
      if (this.health < 100 && this.sinceDamage > REGEN_DELAY) this.health = Math.min(100, this.health + REGEN_RATE * dt);
    }
    this.weapon.update(dt, this.alive);
    this.bots.update(
      dt,
      {
        playerEye: this.player.camera.position,
        playerAlive: this.alive,
        playerSpeed: this.player.speed,
        ballistics: this.ballistics,
        effects: this.effects,
        audio: this.audio,
        damagePlayer: (a, f) => this.damagePlayer(a, f),
      },
      this.player.position,
    );
  }

  refreshHud(): void {
    const w = this.weapon;
    this.hud.update({
      health: this.health,
      ammo: w.ammo,
      reserve: w.reserve,
      magazine: w.def.magazine,
      weaponName: w.def.name,
      reloading: w.isReloading,
      scoped: w.scoped && this.alive,
      ads: this.alive ? w.ads : 0,
      zoom: w.zoom,
      breath: w.breath,
      kills: this.kills,
      deaths: this.deaths,
      headshots: this.headshots,
      accuracy: this.shots > 0 ? this.hits / this.shots : null,
    });
  }
}
