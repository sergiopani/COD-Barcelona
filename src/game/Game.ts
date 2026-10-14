import { Engine, FreeCamera, Scene, SceneInstrumentation, Vector3 } from "@babylonjs/core";
import { PLAYER } from "./config";
import { GraphicsSettings, PROFILES, type ProfileName } from "./graphics/GraphicsSettings";
import { InputManager } from "./player/InputManager";
import { PlayerController } from "./player/PlayerController";
import { AudioManager } from "./audio/AudioManager";
import { CombatSystem } from "./combat/CombatSystem";
import { renderCharacterPreviews } from "./characters/Previews";
import { Hud } from "./ui/Hud";
import { MenuScreen } from "./ui/MenuScreen";
import { MultiplayerSession } from "./multiplayer/MultiplayerSession";
import { NetClient } from "./multiplayer/NetClient";
import { signOut } from "./multiplayer/auth";
import { BarcelonaMap } from "./world/BarcelonaMap";
import { setupLighting, type LightingRig } from "./world/Lighting";
import { loadHelicopters, type HeliSet } from "./world/Helicopters";
import { runCollisionSelfTest } from "./debug/selfTest";
import { runCombatTest } from "./debug/combatTest";
import { dumpWorld } from "./debug/dumpWorld";

/**
 * Motor, escena, bucle principal y estados (cargando → menú → jugando → pausa).
 */
export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly menu = new MenuScreen();
  private readonly input: InputManager;
  private player!: PlayerController;
  private map!: BarcelonaMap;
  private lighting!: LightingRig;
  private combat!: CombatSystem;
  private session: MultiplayerSession | null = null;
  private helis: HeliSet | null = null;
  private readonly audio = new AudioManager();
  private readonly hud = new Hud();
  private started = false;
  private fpsTimer = 0;
  private slowTime = 0;
  private readonly instrumentation: SceneInstrumentation;
  readonly settings = new GraphicsSettings();

  constructor(canvas: HTMLCanvasElement) {
    // Sin antialiasing del canvas: el pipeline HDR ya aplica MSAA/FXAA según el perfil.
    this.engine = new Engine(canvas, false, { preserveDrawingBuffer: false, stencil: false, powerPreference: "high-performance" }, true);
    this.scene = new Scene(this.engine);
    this.input = new InputManager(canvas);
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;
    window.addEventListener("resize", () => this.engine.resize());
  }

  async init(): Promise<void> {
    const camera = new FreeCamera("fpsCamera", new Vector3(0, 2, 0), this.scene);
    this.lighting = setupLighting(this.scene, camera);
    this.player = new PlayerController(this.scene, camera, this.input);

    this.map = new BarcelonaMap(this.scene, this.lighting);
    const steps = 9;
    let n = 0;
    this.menu.setProgress("Preparando entorno e iluminación…", 0.02);
    const envInfo = await this.lighting.env.ready;
    console.info(`[Entorno] IBL: ${envInfo.source}`);
    await this.map.build((label) => this.menu.setProgress(label, ++n / (steps + 1)));

    // Combate: arma (GLB), balística, bots-objetivo, salud y HUD
    this.menu.setProgress("Cargando el arma…", 0.95);
    this.combat = new CombatSystem(this.scene, this.map, this.player, this.input, this.audio, this.hud, this.lighting);
    await this.combat.init();
    this.combat.setBasilicaProxy();

    // Helicópteros decorativos que sobrevuelan la ciudad
    this.menu.setProgress("Preparando los helicópteros…", 0.97);
    this.helis = await loadHelicopters(this.scene, this.lighting, this.settings.current.helicopters);

    // Perfil gráfico y asfalto mojado (aplican opciones reales de renderizado)
    this.applyGraphics();
    this.menu.bindGraphics(this.settings.profile, this.settings.wet, this.settings.skyPhoto, (profile, wet, skyPhoto) => {
      this.settings.set(profile as ProfileName, wet, true, skyPhoto);
      this.applyGraphics();
    });

    this.player.safety = this.map.collisions;
    const s = this.map.spawnPosition(0);
    this.player.teleport(s.position.x, s.position.y, s.position.z, s.yaw);

    // Estado de Pointer Lock ↔ menú
    this.input.onLockChange = (locked) => {
      if (locked) this.menu.hide();
      else if (this.started) {
        this.menu.showPause();
        if (this.session) {
          this.menu.setNote("En multijugador la partida NO se pausa: el servidor sigue en marcha.");
          void this.refreshGlobalBoard();
        }
      }
    };
    this.input.onLockError = () => this.menu.setNote("El navegador rechazó el bloqueo del ratón. Vuelve a pulsar el botón.");

    this.menu.setUrlPlaceholder(NetClient.defaultUrl());
    // Solo multijugador: se carga el ranking global y la configuración de inicio de sesión (ID de cliente de Google) del servidor
    void this.refreshGlobalBoard();
    void this.loadAuthConfig();
    this.scene.executeWhenReady(() => {
      this.menu.ready(() => {
        if (!this.menu.canPlay()) return; // sin sesión de Google ni nickname: no se entra
        this.audio.resume(); // el AudioContext solo puede arrancar tras un gesto del usuario
        this.menu.setNote("");
        void this.input.requestLock(); // dentro del manejador del clic (gesto del usuario)
        void this.startMultiplayer();
      });
      if (this.map.sagrada.usedPlaceholder) {
        this.menu.setNote("Modelo sagrada-familia.glb no encontrado: se usa una basílica provisional.");
      }
    });

    this.engine.runRenderLoop(() => this.frame());
    // miniaturas 3D de los personajes para el selector del menú (con el bucle ya en marcha)
    window.setTimeout(() => void renderCharacterPreviews(this.engine).then((urls) => this.menu.setSkinPreviews(urls)), 400);
    this.exposeDebug();
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    // El juego (bots, arma, salud) solo avanza con el cursor bloqueado; en pausa queda congelado.
    const active = this.input.locked;
    this.player.update(dt);
    this.combat.update(dt, active);
    if (this.helis) {
      const cam = this.player.camera;
      this.helis.update(dt, cam.position);
      const near = this.helis.nearest(cam.position, cam.getDirection(Vector3.Right()));
      // el sonido solo suena con el juego activo; baja con la distancia (se oye hasta ~450 m)
      this.audio.setHeli(active && near ? Math.pow(Math.max(0, 1 - near.dist / 450), 1.6) : 0, near?.pan ?? 0);
    }
    if (this.session) {
      this.session.update(dt);
      // marcador con Tab
      this.hud.setScoreboard(active && this.input.isDown("Tab"), this.session.scoreboardRows(), this.session.myId, this.session);
    }
    this.combat.refreshHud();
    // caída fuera del mundo → reaparición
    if (this.player.position.y < PLAYER.killPlaneY) {
      const s = this.map.spawnPosition(0);
      this.player.teleport(s.position.x, s.position.y, s.position.z, s.yaw);
    }
    this.scene.render();
    this.input.endFrame();

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      const fps = this.engine.getFps();
      this.menu.setFps(`FPS ${fps.toFixed(0)} · ${this.instrumentation.frameTimeCounter.average.toFixed(1)} ms · ${this.instrumentation.drawCallsCounter.current} draws`);
      this.autoQuality(fps, 0.5);
      if (this.session) this.hud.setNetInfo(this.session.ping);
    }
  }

  /** Descarga el top 10 del ranking global (API HTTP del mismo servidor) y lo muestra en el menú. */
  private async loadAuthConfig(): Promise<void> {
    const url = this.menu.mpSettings.url || NetClient.defaultUrl();
    try {
      const r = await fetch(`${NetClient.httpBase(url)}/api/config`, { signal: AbortSignal.timeout(4000) });
      const j = (await r.json()) as { googleClientId: string | null };
      await this.menu.setupAuth(j.googleClientId);
    } catch {
      await this.menu.setupAuth(null);
      this.menu.setNote("No se pudo contactar con el servidor. ¿Está en marcha? (npm run server)");
    }
  }

  private async refreshGlobalBoard(): Promise<void> {
    const url = this.menu.mpSettings.url || NetClient.defaultUrl();
    try {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${NetClient.httpBase(url)}/api/leaderboard?limit=10`, { signal: ctl.signal });
      window.clearTimeout(timer);
      const j = (await r.json()) as { total: number; top: { rank: number; name: string; kills: number; headshots: number }[] };
      this.menu.showGlobalBoard(j.top, j.total);
    } catch {
      this.menu.showGlobalBoard(null);
    }
  }

  /** Conecta con el servidor y entra en la sala global. La orden de bloqueo del ratón ya se pidió en el clic. */
  private async startMultiplayer(): Promise<void> {
    const cfg = this.menu.mpSettings;
    const url = cfg.url || NetClient.defaultUrl();
    this.hud.setBanner("Conectando con el servidor…");
    const session = new MultiplayerSession(this.scene, this.lighting, this.player, this.combat, this.hud, this.audio, this.combat.effects);
    try {
      await session.start(url, cfg.name || "Jugador", cfg.idToken, cfg.skin);
    } catch (e) {
      this.hud.setBanner(null);
      session.stop();
      this.input.exitLock();
      this.menu.showPause();
      this.menu.setPlayLabel("Reintentar");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Sesión de Google")) signOut(); // token caducado o rechazado: hay que volver a iniciar sesión
      this.menu.setNote(msg.includes("Sesión de Google") ? msg : `${msg}. ¿Está el servidor en marcha? (npm run server)`);
      return;
    }
    session.onDisconnect = (reason) => {
      this.input.exitLock();
      this.session = null;
      this.menu.showError(reason, "Recargar");
    };
    this.session = session;
    this.combat.enterMultiplayer(session);
    this.started = true;
    this.menu.lockMode();
    this.hud.setBanner(null);
    console.info(`[Red] Conectado a ${url} · sala global · jugador #${session.myId}`);
  }

  /** Aplica el perfil actual: resolución interna, sombras, postproceso, SSAO, filtrado, distancia y asfalto mojado. */
  applyGraphics(): void {
    const p = this.settings.current;
    const dpr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio);
    this.engine.setHardwareScalingLevel(1 / (dpr * p.renderScale));
    this.lighting.applyProfile(p);
    this.map.setWet(this.settings.wet);
    this.lighting.setWet(this.settings.wet);
    this.helis?.setCount(p.helicopters);
    this.lighting.env.setPhotoSky(this.settings.skyPhoto, this.settings.profile === "high" ? "high" : "medium");
    // filtrado anisotrópico en todas las texturas de la escena
    for (const t of this.scene.textures) t.anisotropicFilteringLevel = Math.min(p.anisotropy, this.engine.getCaps().maxAnisotropy || 4);
    this.menu.setQualityValue(this.settings.profile);
    console.info(`[Gráficos] perfil ${p.label} · render ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()} · asfalto mojado: ${this.settings.wet ? "sí" : "no"}`);
  }

  /** Si el rendimiento es bajo de forma sostenida baja un escalón de perfil (sin guardarlo como preferencia). */
  private autoQuality(fps: number, dt: number): void {
    if (!this.input.locked) return;
    this.slowTime = fps < 30 ? this.slowTime + dt : 0;
    if (this.slowTime > 4) {
      this.slowTime = 0;
      const next: Record<ProfileName, ProfileName | null> = { high: "medium", medium: "low", low: null };
      const to = next[this.settings.profile];
      if (to) {
        this.settings.set(to, this.settings.wet, false);
        this.applyGraphics();
        console.warn(`[Calidad] FPS bajos sostenidos: perfil ${PROFILES[to].label}.`);
      }
    }
  }

  private exposeDebug(): void {
    const g: Record<string, any> = {
      scene: this.scene,
      engine: this.engine,
      player: this.player,
      input: this.input,
      map: this.map,
      lighting: this.lighting,
      game: this,
      combat: this.combat,
      session: () => this.session,
      helis: () => this.helis,
      hud: this.hud,
      stats: () => ({ ...this.map.stats, fps: this.engine.getFps(), drawCalls: this.instrumentation.drawCallsCounter.current, frameMs: this.instrumentation.frameTimeCounter.average }),
      tp: (x: number, z: number, yawDeg = 0, y = 0.05) => this.player.teleport(x, y, z, (yawDeg * Math.PI) / 180),
      selfTest: () => runCollisionSelfTest(this.scene, this.player, this.map),
      dumpWorld: () => dumpWorld(this.scene, this.map),
      combatTest: () =>
        runCombatTest(
          this.combat,
          this.player,
          (n) => g.frames(n),
          (v) => ((this.input as unknown as { lockedState: boolean }).lockedState = v),
        ),
      /** Simula n fotogramas completos a mano (útil cuando la pestaña está oculta y no hay requestAnimationFrame). */
      frames: (n: number, dt = 1 / 60) => {
        for (let i = 0; i < n; i++) {
          this.player.update(dt);
          this.combat.update(dt, this.input.locked);
          this.combat.refreshHud();
          this.scene.render();
          this.input.endFrame();
        }
      },
      /** Entra en juego sin Pointer Lock (útil para capturas y pruebas automáticas). */
      hideMenu: () => this.menu.hide(),
    };
    (window as unknown as { __game: typeof g }).__game = g;
  }
}
