import { Vector3 } from "@babylonjs/core";
import { CLIENT_SEND_HZ, JUMP_BONUS_PER_KILL, type BoardMsg, type PlayerInfo, type ServerMsg } from "../../../shared/protocol";
import type { AudioManager } from "../audio/AudioManager";
import type { CombatSystem } from "../combat/CombatSystem";
import type { PlayerController } from "../player/PlayerController";
import type { Hud } from "../ui/Hud";
import type { Effects } from "../weapons/Effects";
import type { LightingRig } from "../world/Lighting";
import { NetClient } from "./NetClient";
import { RemotePlayers } from "./RemotePlayers";
import type { Scene } from "@babylonjs/core";

/**
 * Sesión multijugador del cliente. El servidor es autoritativo (salud, daño, munición, impactos, bajas, reapariciones):
 * aquí solo se envía el movimiento y la intención de disparar/recargar, y se aplican los eventos recibidos.
 */
export class MultiplayerSession {
  readonly net = new NetClient();
  readonly remotes: RemotePlayers;
  myId = 0;
  room = "";
  killLimit = 0;
  maxPlayers = 0;
  /** true = entraste con Google (usuario guardado). */
  registered = false;
  /** Ranking global (top 10) y mi posición en él; llegan del servidor. */
  board: BoardMsg["top"] = [];
  myGlobal: BoardMsg["you"] = null;
  readonly players = new Map<number, PlayerInfo>();
  private sendTimer = 0;
  private seq = 0;
  private lastSnapAt = 0;
  onDisconnect: (reason: string) => void = () => {};

  constructor(
    scene: Scene,
    lighting: LightingRig,
    private readonly player: PlayerController,
    private readonly combat: CombatSystem,
    private readonly hud: Hud,
    private readonly audio: AudioManager,
    private readonly effects: Effects,
  ) {
    this.remotes = new RemotePlayers(scene, lighting);
  }

  get ping(): number {
    return this.net.ping;
  }
  /** Reloj del servidor que ve este cliente (para la compensación de latencia del servidor). */
  get renderTime(): number {
    return this.remotes.renderTime();
  }

  async start(url: string, name: string, idToken?: string, skin = 0): Promise<void> {
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onClose = (r) => {
      this.hud.setBanner(null);
      this.onDisconnect(r);
    };
    await this.net.connect(url, name, idToken, skin);
  }

  stop(): void {
    this.net.close();
    this.remotes.clear();
  }

  // ------------------------------------------------------------ salida

  sendFire(origin: Vector3, forward: Vector3, ads: number): void {
    this.net.send({
      t: "fire",
      o: [origin.x, origin.y, origin.z],
      d: [forward.x, forward.y, forward.z],
      rt: this.renderTime,
      ads,
    });
  }

  sendReload(): void {
    this.net.send({ t: "reload" });
  }

  /** Llamar cada fotograma: envía el estado a 20 Hz y actualiza los jugadores remotos. */
  update(dt: number): void {
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / CLIENT_SEND_HZ) {
      this.sendTimer = 0;
      const p = this.player.position;
      this.net.send({ t: "state", seq: ++this.seq, p: [p.x, p.y, p.z], yaw: this.player.yaw, pitch: this.player.pitch, ads: this.combat.weapon.ads > 0.5 });
    }
    this.remotes.update(dt, this.player.camera.position);
    // si dejan de llegar instantáneas se avisa
    if (this.lastSnapAt > 0 && performance.now() - this.lastSnapAt > 3000) this.hud.setBanner("Conexión inestable…");
  }

  // ------------------------------------------------------------ entrada

  private names(): Map<number, string> {
    const map = new Map<number, string>();
    for (const p of this.players.values()) map.set(p.id, p.name);
    return map;
  }
  private skins(): Map<number, number> {
    const map = new Map<number, number>();
    for (const p of this.players.values()) map.set(p.id, p.skin ?? 0);
    return map;
  }
  private nameOf(id: number): string {
    return this.players.get(id)?.name ?? `Jugador ${id}`;
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.myId = m.id;
        this.room = m.room;
        this.killLimit = m.killLimit;
        this.maxPlayers = m.maxPlayers;
        this.registered = m.registered;
        this.myGlobal = m.global ? { rank: m.global.rank, kills: m.global.kills, deaths: 0, headshots: 0, total: 0 } : null;
        this.applyJumpBonus();
        this.players.clear();
        for (const p of m.players) this.players.set(p.id, p);
        this.player.teleport(m.spawn[0], m.spawn[1], m.spawn[2], m.yaw);
        this.updateOwnScore();
        break;
      case "joined":
        this.players.set(m.player.id, m.player);
        this.hud.feed(`${m.player.name} se ha unido`);
        break;
      case "left": {
        const n = this.nameOf(m.id);
        this.players.delete(m.id);
        this.remotes.remove(m.id);
        this.hud.feed(`${n} se ha ido`);
        break;
      }
      case "snap": {
        this.lastSnapAt = performance.now();
        this.hud.setBanner(null);
        this.remotes.onSnapshot(m.st, m.ps, this.myId, this.names(), this.skins());
        this.combat.applyServerState(m.you);
        break;
      }
      case "shot": {
        this.effects.tracer(new Vector3(...m.from), new Vector3(...m.to));
        const d = Vector3.Distance(this.player.camera.position, new Vector3(...m.from));
        this.audio.distantShot(d);
        if (m.hit === "world") this.effects.dustAt(new Vector3(...m.to));
        break;
      }
      case "hit":
        this.combat.mpHitConfirmed(m.zone, m.killed);
        break;
      case "damaged":
        this.combat.mpDamaged(new Vector3(...m.from));
        break;
      case "kill": {
        const z = m.zone === "head" ? "cabeza" : m.zone === "torso" ? "torso" : "piernas";
        const mine = m.killer === this.myId;
        const dead = m.victim === this.myId;
        this.hud.feed(`${this.nameOf(m.killer)} eliminó a ${this.nameOf(m.victim)} · ${z} · ${m.dist.toFixed(0)} m`, dead);
        if (mine) this.audio.hitMarker("kill");
        break;
      }
      case "died":
        this.combat.mpDeath(m.respawnIn);
        break;
      case "respawn":
        this.combat.mpRespawn(m.p, m.yaw);
        break;
      case "correct":
        // el servidor rechazó nuestro movimiento: volvemos a la última posición válida
        this.player.teleport(m.p[0], m.p[1], m.p[2]);
        console.warn("[Red] Corrección del servidor:", m.reason);
        break;
      case "score":
        for (const p of m.players) this.players.set(p.id, p);
        this.updateOwnScore();
        break;
      case "board":
        this.board = m.top;
        this.myGlobal = m.you;
        this.applyJumpBonus();
        break;
      case "match":
        if (m.state === "over") this.hud.setBanner(`¡${this.nameOf(m.winner ?? 0)} gana la partida! Nueva partida en ${m.restartIn ?? 8} s`);
        else this.hud.setBanner(null);
        break;
      case "error":
        this.hud.setBanner(m.msg);
        break;
      default:
        break;
    }
  }

  /** Salto: +0,01 % de altura por cada baja global de un usuario guardado (los invitados no tienen bonus). */
  private applyJumpBonus(): void {
    const kills = this.registered ? this.myGlobal?.kills ?? 0 : 0;
    this.player.jumpMultiplier = 1 + kills * JUMP_BONUS_PER_KILL;
    this.hud.setGlobalStats(this.registered ? { kills, rank: this.myGlobal?.rank ?? 0, jumpBonusPct: kills * JUMP_BONUS_PER_KILL * 100 } : null);
  }

  private updateOwnScore(): void {
    const me = this.players.get(this.myId);
    if (me) {
      this.combat.kills = me.kills;
      this.combat.deaths = me.deaths;
    }
  }

  scoreboardRows(): PlayerInfo[] {
    return [...this.players.values()];
  }
}
