import {
  Camera,
  Color3,
  Color4,
  CascadedShadowGenerator,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  Scene,
  SSAO2RenderingPipeline,
  SSRRenderingPipeline,
  Vector3,
} from "@babylonjs/core";
import { createEnvironment, type EnvironmentRig } from "../graphics/Environment";
import type { GraphicsProfile } from "../graphics/GraphicsSettings";

/**
 * Sol, sombras en cascada, post-proceso y oclusión ambiental. Todo lo que cambia con el perfil
 * gráfico se aplica en `applyProfile` sin recrear materiales ni geometría.
 */
export type CasterKind = "mass" | "detail" | "prop" | "proxy";

export interface LightingRig {
  sun: DirectionalLight;
  env: EnvironmentRig;
  pipeline: DefaultRenderingPipeline;
  readonly shadows: CascadedShadowGenerator | null;
  addShadowCaster(mesh: Mesh, kind?: CasterKind): void;
  applyProfile(p: GraphicsProfile): void;
  setWet(on: boolean): void;
  readonly shadowsEnabled: boolean;
  readonly ssaoActive: boolean;
  readonly ssrActive: boolean;
}

/** Dirección de la luz solar (mañana avanzada, desde el sureste; el norte es +Z). */
export const SUN_DIRECTION = new Vector3(-0.5, -0.64, 0.58).normalize();

const TONEMAP = ImageProcessingConfiguration.TONEMAPPING_ACES;

export function setupLighting(scene: Scene, camera: Camera): LightingRig {
  scene.clearColor = new Color4(0.62, 0.74, 0.9, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0015;
  scene.fogColor = new Color3(0.72, 0.79, 0.88);

  const sun = new DirectionalLight("sun", SUN_DIRECTION, scene);
  sun.intensity = 3.3;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  sun.specular = new Color3(1, 0.96, 0.9);
  sun.position = SUN_DIRECTION.scale(-300);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 330;

  // Relleno suave: la luz ambiental principal viene del IBL; esto evita negros absolutos en zonas de sombra.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.3;
  fill.diffuse = new Color3(0.75, 0.82, 1);
  fill.groundColor = new Color3(0.5, 0.44, 0.38);

  const env = createEnvironment(scene, SUN_DIRECTION.scale(-1).normalize(), 1.05);

  // Post-proceso HDR: un único pipeline (MSAA o FXAA, nunca ambos).
  const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [camera]);
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = TONEMAP;
  ip.exposure = 1.2;
  ip.contrast = 1.1;
  // Corrección de color sutil: algo más de saturación, sombras frías y luces cálidas.
  ip.colorCurvesEnabled = true;
  const cc = ip.colorCurves!;
  cc.globalSaturation = 22;
  cc.shadowsHue = 215;
  cc.shadowsDensity = 3;
  cc.highlightsHue = 42;
  cc.highlightsDensity = 10;
  ip.vignetteEnabled = false;
  ip.vignetteWeight = 1.2;
  ip.vignetteStretch = 0;
  ip.vignetteColor = new Color4(0, 0, 0, 0);
  pipeline.bloomThreshold = 0.95;
  pipeline.bloomWeight = 0.12;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;
  pipeline.sharpen.edgeAmount = 0.2;

  let shadows: CascadedShadowGenerator | null = null;
  let shadowSig = "";
  let ssao: SSAO2RenderingPipeline | null = null;
  let ssaoMode: "off" | "half" | "full" = "off";
  let ssr: SSRRenderingPipeline | null = null;
  let wet = false;
  let profile: GraphicsProfile | null = null;
  const casters: { mesh: Mesh; kind: CasterKind }[] = [];

  const allowed = (kind: CasterKind, p: GraphicsProfile): boolean => {
    if (kind === "detail") return p.shadows.detailCasters;
    if (kind === "proxy") return p.shadows.basilica;
    return true;
  };

  const syncCasters = (): void => {
    if (!shadows || !profile) return;
    const rl = shadows.getShadowMap()!.renderList!;
    rl.length = 0;
    for (const c of casters) if (allowed(c.kind, profile)) rl.push(c.mesh);
  };

  const syncSsr = (): void => {
    const want = wet && !!profile?.ssr;
    if (want && !ssr) {
      try {
        ssr = new SSRRenderingPipeline("ssr", scene, [camera], false);
        ssr.strength = 0.9;
        ssr.reflectivityThreshold = 0.05;
        ssr.thickness = 0.6;
        ssr.maxDistance = 90;
        ssr.maxSteps = 80;
        ssr.step = 1;
        ssr.blurDispersionStrength = 0.03;
        ssr.roughnessFactor = 0.2;
        ssr.enableAutomaticThicknessComputation = false;
        ssr.selfCollisionNumSkip = 2;
      } catch (e) {
        console.warn("[SSR] No disponible en este navegador/configuración:", e);
        ssr = null;
      }
    } else if (!want && ssr) {
      ssr.dispose();
      ssr = null;
    }
  };

  const rig: LightingRig = {
    sun,
    env,
    pipeline,
    get shadows() {
      return shadows;
    },
    get shadowsEnabled() {
      return !!shadows;
    },
    get ssaoActive() {
      return !!ssao;
    },
    get ssrActive() {
      return !!ssr;
    },
    addShadowCaster(mesh, kind = "prop") {
      casters.push({ mesh, kind });
      if (shadows && profile && allowed(kind, profile)) shadows.getShadowMap()!.renderList!.push(mesh);
    },
    setWet(on) {
      wet = on;
      syncSsr();
    },
    applyProfile(p) {
      profile = p;
      camera.maxZ = p.drawDistance;
      // la esfera del cielo (radio 700) debe quedar dentro del plano lejano de la cámara
      env.sky.scaling.setAll((p.drawDistance * 0.92) / 700);

      // --- Sombras (se recrea el generador solo si cambia el tamaño/número de cascadas)
      const sig = `${p.shadows.enabled}|${p.shadows.mapSize}|${p.shadows.cascades}`;
      if (sig !== shadowSig) {
        shadows?.dispose();
        shadows = null;
        shadowSig = sig;
        if (p.shadows.enabled) {
          shadows = new CascadedShadowGenerator(p.shadows.mapSize, sun);
          shadows.numCascades = p.shadows.cascades;
          shadows.stabilizeCascades = true;
          shadows.lambda = 0.9;
          shadows.autoCalcDepthBounds = true;
          shadows.depthClamp = true;
          shadows.bias = 0.0025;
          shadows.normalBias = 0.02;
          shadows.usePercentageCloserFiltering = true;
          shadows.darkness = 0;
        }
      }
      if (shadows) {
        shadows.shadowMaxZ = Math.min(p.shadows.maxZ, p.drawDistance);
        shadows.filteringQuality =
          p.shadows.quality === "high"
            ? CascadedShadowGenerator.QUALITY_HIGH
            : p.shadows.quality === "medium"
              ? CascadedShadowGenerator.QUALITY_MEDIUM
              : CascadedShadowGenerator.QUALITY_LOW;
      }
      syncCasters();

      // --- Postproceso: MSAA o FXAA, nunca los dos
      pipeline.samples = p.msaa === 0 ? 1 : p.msaa;
      pipeline.fxaaEnabled = p.msaa === 0 && p.fxaa;
      pipeline.bloomEnabled = p.bloom;
      pipeline.sharpenEnabled = p.sharpen;
      pipeline.imageProcessing.vignetteEnabled = p.vignette;

      // --- Oclusión ambiental (SSAO2) solo en MEDIO/ALTO
      if (p.ssao !== ssaoMode) {
        ssao?.dispose();
        ssao = null;
        ssaoMode = p.ssao;
        if (p.ssao !== "off") {
          try {
            ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: p.ssao === "full" ? 0.75 : 0.5, blurRatio: 1 }, [camera], false);
            ssao.radius = 1.6;
            ssao.totalStrength = 0.9;
            ssao.base = 0.05;
            ssao.maxZ = 70;
            ssao.minZAspect = 0.4;
            ssao.samples = p.ssao === "full" ? 24 : 12;
            ssao.expensiveBlur = p.ssao === "full";
          } catch (e) {
            console.warn("[SSAO] No disponible:", e);
            ssao = null;
          }
        }
      }
      syncSsr();
    },
  };
  return rig;
}
