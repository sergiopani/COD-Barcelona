import {
  Camera,
  Color3,
  Color4,
  CascadedShadowGenerator,
  DefaultRenderingPipeline,
  DirectionalLight,
  Effect,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  ShaderMaterial,
  Vector3,
} from "@babylonjs/core";

/**
 * Sol, cielo procedural, entorno PBR (sonda de reflexión del cielo), sombras en cascada,
 * niebla suave y post-proceso (MSAA/FXAA, ACES, bloom sutil).
 */
export interface LightingRig {
  sun: DirectionalLight;
  shadows: CascadedShadowGenerator | null;
  pipeline: DefaultRenderingPipeline;
  addShadowCaster(mesh: Mesh): void;
  setShadowsEnabled(on: boolean): void;
  readonly shadowsEnabled: boolean;
}

/** Dirección de la luz solar (mañana avanzada, desde el sureste; el norte es +Z). */
const SUN_DIRECTION = new Vector3(-0.5, -0.64, 0.58).normalize();

export function setupLighting(scene: Scene, camera: Camera): LightingRig {
  scene.clearColor = new Color4(0.62, 0.74, 0.9, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0017;
  scene.fogColor = new Color3(0.74, 0.8, 0.88);

  const sun = new DirectionalLight("sun", SUN_DIRECTION, scene);
  sun.intensity = 3.4;
  sun.diffuse = new Color3(1, 0.95, 0.85);
  sun.specular = new Color3(1, 0.96, 0.9);
  sun.position = SUN_DIRECTION.scale(-300);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 330;

  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.25;
  fill.diffuse = new Color3(0.7, 0.8, 1);
  fill.groundColor = new Color3(0.45, 0.4, 0.35);

  // Cielo procedural.
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 1400, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = createSkyMaterial(scene, SUN_DIRECTION.scale(-1).normalize());
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;

  // Entorno PBR: se renderiza el cielo una sola vez en una sonda cúbica.
  const probe = new ReflectionProbe("skyProbe", 256, scene);
  probe.renderList!.push(sky);
  probe.position = new Vector3(0, 10, 0);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.85;

  // Sombras en cascada.
  let shadows: CascadedShadowGenerator | null = new CascadedShadowGenerator(2048, sun);
  configureShadows(shadows);

  // Post-proceso.
  const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [camera]);
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.9;
  pipeline.bloomWeight = 0.16;
  pipeline.bloomKernel = 48;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.3;
  pipeline.imageProcessing.contrast = 1.12;
  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.25;

  const casters: Mesh[] = [];
  let on = true;
  const rig: LightingRig = {
    sun,
    get shadows() {
      return shadows;
    },
    pipeline,
    addShadowCaster(mesh: Mesh) {
      casters.push(mesh);
      shadows?.addShadowCaster(mesh);
    },
    setShadowsEnabled(enable: boolean) {
      if (enable === on) return;
      on = enable;
      if (enable) {
        shadows = new CascadedShadowGenerator(2048, sun);
        configureShadows(shadows);
        casters.forEach((m) => shadows!.addShadowCaster(m));
      } else {
        shadows?.dispose();
        shadows = null;
      }
    },
    get shadowsEnabled() {
      return on;
    },
  };
  return rig;
}

function configureShadows(g: CascadedShadowGenerator): void {
  g.numCascades = 3;
  g.stabilizeCascades = true;
  g.lambda = 0.85;
  g.shadowMaxZ = 220;
  g.autoCalcDepthBounds = true;
  g.bias = 0.0035;
  g.normalBias = 0.025;
  g.usePercentageCloserFiltering = true;
  g.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
  g.darkness = 0.0;
  g.depthClamp = true;
}

/** Cielo degradado mediterráneo con halo solar (valores lineales, antes del tone mapping). */
function createSkyMaterial(scene: Scene, toSun: Vector3): ShaderMaterial {
  Effect.ShadersStore["bfpsSkyVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["bfpsSkyFragmentShader"] = `
    precision highp float;
    varying vec3 vDir;
    uniform vec3 sunDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 horizon = vec3(0.62, 0.74, 0.90);
      vec3 zenith = vec3(0.10, 0.30, 0.78);
      vec3 col = mix(horizon, zenith, pow(h, 0.5));
      float s = max(dot(d, sunDir), 0.0);
      col += vec3(1.0, 0.82, 0.55) * (pow(s, 900.0) * 14.0 + pow(s, 24.0) * 0.35);
      col = mix(col, horizon * 0.75, smoothstep(0.0, -0.12, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`;
  const mat = new ShaderMaterial("skyMat", scene, { vertex: "bfpsSky", fragment: "bfpsSky" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "sunDir"],
  });
  mat.setVector3("sunDir", toSun);
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  return mat;
}
