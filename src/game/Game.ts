import { Engine, FreeCamera, Scene, SceneInstrumentation, Vector3 } from "@babylonjs/core";
import { PLAYER } from "./config";
import { GraphicsSettings, PROFILES, type ProfileName } from "./graphics/GraphicsSettings";
import { InputManager } from "./player/InputManager";
import { PlayerController } from "./player/PlayerController";
import { AudioManager } from "./audio/AudioManager";
import { CombatSystem } from "./combat/CombatSystem";
import { Hud } from "./ui/Hud";
import { MenuScreen } from "./ui/MenuScreen";
import { BarcelonaMap } from "./world/BarcelonaMap";
import { setupLighting, type LightingRig } from "./world/Lighting";
import { runCollisionSelfTest } from "./debug/selfTest";
import { runCombatTest } from "./debug/combatTest";

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

    // Perfil gráfico y asfalto mojado (aplican opciones reales de renderizado)
    this.applyGraphics();
    this.menu.bindGraphics(this.settings.profile, this.settings.wet, (profile, wet) => {
      this.settings.set(profile as ProfileName, wet);
      this.applyGraphics();
    });

    this.player.safety = this.map.collisions;
    const s = this.map.spawnPosition(0);
    this.player.teleport(s.position.x, s.position.y, s.position.z, s.yaw);

    // Estado de Pointer Lock ↔ menú
    this.input.onLockChange = (locked) => {
      if (locked) this.menu.hide();
      else if (this.started) this.menu.showPause();
    };
    this.input.onLockError = () => this.menu.setNote("El navegador rechazó el bloqueo del ratón. Vuelve a pulsar el botón.");

    this.scene.executeWhenReady(() => {
      this.menu.ready(() => {
        this.started = true;
        this.audio.resume(); // el AudioContext solo puede arrancar tras un gesto del usuario
        this.menu.setNote("");
        void this.input.requestLock();
      });
      if (this.map.sagrada.usedPlaceholder) {
        this.menu.setNote("Modelo sagrada-familia.glb no encontrado: se usa una basílica provisional.");
      }
    });

    this.engine.runRenderLoop(() => this.frame());
    this.exposeDebug();
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    // El juego (bots, arma, salud) solo avanza con el cursor bloqueado; en pausa queda congelado.
    const active = this.input.locked;
    this.player.update(dt);
    this.combat.update(dt, active);
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
    }
  }

  /** Aplica el perfil actual: resolución interna, sombras, postproceso, SSAO, filtrado, distancia y asfalto mojado. */
  applyGraphics(): void {
    const p = this.settings.current;
    const dpr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio);
    this.engine.setHardwareScalingLevel(1 / (dpr * p.renderScale));
    this.lighting.applyProfile(p);
    this.map.setWet(this.settings.wet);
    this.lighting.setWet(this.settings.wet);
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
      hud: this.hud,
      stats: () => ({ ...this.map.stats, fps: this.engine.getFps(), drawCalls: this.instrumentation.drawCallsCounter.current, frameMs: this.instrumentation.frameTimeCounter.average }),
      tp: (x: number, z: number, yawDeg = 0, y = 0.05) => this.player.teleport(x, y, z, (yawDeg * Math.PI) / 180),
      selfTest: () => runCollisionSelfTest(this.scene, this.player, this.map),
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
