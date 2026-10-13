import { ASSETS } from "../assets";
import {
  BaseTexture,
  CubeTexture,
  EnvironmentTextureTools,
  Effect,
  HDRCubeTexture,
  Matrix,
  Constants,
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  VertexData,
  RawCubeTexture,
  Scene,
  ShaderMaterial,
  Vector3,
} from "@babylonjs/core";

/**
 * Cielo procedural con nubes + Image-Based Lighting.
 *
 *  1. Si existe un entorno externo en public/assets/env/ (environment.env prefiltrado de Babylon o
 *     environment.hdr equirectangular) se usa como IBL (ver public/assets/env/README.txt).
 *  2. Si no, se renderiza el cielo procedural (SIN disco solar, para no duplicar el sol direccional)
 *     en una sonda cúbica y se prefiltra con EnvironmentTextureTools (mips por rugosidad + armónicos
 *     esféricos para la luz difusa).
 */
export interface EnvironmentRig {
  sky: Mesh;
  /** Cielo con foto real (panorama 360° de Barcelona sin la basílica). Sustituye al cielo procedural cuando está activo. */
  setPhotoSky(on: boolean, quality: "medium" | "high"): void;
  ready: Promise<{ source: "externo-env" | "externo-hdr" | "procedural-prefiltrado" | "procedural-sin-prefiltrar" }>;
  setIntensity(v: number): void;
  dispose(): void;
}

const ENV_URLS = { env: ASSETS.envEnv, hdr: ASSETS.envHdr };

function registerSkyShader(): void {
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
    uniform float sunDisk;
    uniform float time;
    uniform float cloudCover;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float a = 0.5, s = 0.0;
      for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
      return s;
    }

    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      // degradado mediterráneo (valores lineales)
      vec3 horizon = vec3(0.60, 0.72, 0.88);
      vec3 zenith = vec3(0.09, 0.27, 0.72);
      vec3 col = mix(horizon, zenith, pow(h, 0.45));

      // nubes (cirros/cúmulos suaves) proyectadas sobre un plano
      if (d.y > 0.02) {
        vec2 p = d.xz / (d.y + 0.18) * 1.6 + vec2(time * 0.004, time * 0.0015);
        float c = fbm(p);
        float cov = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.28, c);
        float shade = clamp(fbm(p + sunDir.xz * 0.15) - c + 0.5, 0.0, 1.0);
        vec3 cloudCol = mix(vec3(0.55, 0.6, 0.7), vec3(1.0, 0.98, 0.95), shade);
        cov *= smoothstep(0.02, 0.22, d.y);
        col = mix(col, cloudCol, cov * 0.92);
      }

      float s = max(dot(d, sunDir), 0.0);
      col += vec3(1.0, 0.82, 0.55) * (pow(s, 24.0) * 0.30 + pow(s, 6.0) * 0.06);
      col += vec3(1.0, 0.9, 0.7) * pow(s, 1200.0) * 16.0 * sunDisk;
      col = mix(col, horizon * 0.7, smoothstep(0.0, -0.12, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`;
}

// --- Cielo en CPU (mismo degradado y nubes que el shader, sin sol) para generar el cubemap de IBL ---
const fract = (x: number): number => x - Math.floor(x);
const hash2 = (x: number, y: number): number => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let fx = x - ix,
    fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  return mix(mix(hash2(ix, iy), hash2(ix + 1, iy), fx), mix(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy);
}
function fbm2(x: number, y: number): number {
  let a = 0.5,
    s = 0;
  for (let i = 0; i < 5; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17;
    y = y * 2.03 + 17;
    a *= 0.5;
  }
  return s;
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function skyColor(dx: number, dy: number, dz: number, sunX: number, sunZ: number): [number, number, number] {
  const horizon = [0.6, 0.72, 0.88];
  const zenith = [0.09, 0.27, 0.72];
  const h = Math.max(0, Math.min(1, dy));
  const k = Math.pow(h, 0.45);
  let c = [mix(horizon[0], zenith[0], k), mix(horizon[1], zenith[1], k), mix(horizon[2], zenith[2], k)];
  if (dy > 0.02) {
    const px = (dx / (dy + 0.18)) * 1.6;
    const pz = (dz / (dy + 0.18)) * 1.6;
    const n = fbm2(px, pz);
    let cov = smooth(0.5, 0.78, n);
    const shade = Math.max(0, Math.min(1, fbm2(px + sunX * 0.15, pz + sunZ * 0.15) - n + 0.5));
    const cc = [mix(0.55, 1.0, shade), mix(0.6, 0.98, shade), mix(0.7, 0.95, shade)];
    cov *= smooth(0.02, 0.22, dy) * 0.92;
    c = [mix(c[0], cc[0], cov), mix(c[1], cc[1], cov), mix(c[2], cc[2], cov)];
  }
  // Cañón urbano: cerca del horizonte la luz/reflejo que llega NO es cielo sino fachadas del Eixample
  // (gris cálido), pesando menos al subir. Hace que reflejos y ambiente sean coherentes en la calle.
  const canyon = smooth(0.7, 0.1, dy) * 0.72;
  c = [mix(c[0], 0.36, canyon), mix(c[1], 0.32, canyon), mix(c[2], 0.27, canyon)];
  // hemisferio inferior: rebote urbano (gris cálido) en lugar de cielo
  const g = smooth(0.0, -0.12, dy);
  return [mix(c[0], 0.24, g), mix(c[1], 0.225, g), mix(c[2], 0.2, g)];
}

/** Seis caras RGBA float en el orden de Babylon: +X, -X, +Y, -Y, +Z, -Z. */
function proceduralSkyFaces(size: number, toSun: Vector3): Float32Array[] {
  const faces: Float32Array[] = [];
  for (let f = 0; f < 6; f++) {
    const data = new Float32Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sc = ((x + 0.5) / size) * 2 - 1;
        const tc = ((y + 0.5) / size) * 2 - 1;
        let d: [number, number, number];
        switch (f) {
          case 0: d = [1, -tc, -sc]; break;
          case 1: d = [-1, -tc, sc]; break;
          case 2: d = [sc, 1, tc]; break;
          case 3: d = [sc, -1, -tc]; break;
          case 4: d = [sc, -tc, 1]; break;
          default: d = [-sc, -tc, -1]; break;
        }
        const l = Math.hypot(d[0], d[1], d[2]);
        const col = skyColor(d[0] / l, d[1] / l, d[2] / l, toSun.x, toSun.z);
        // el aire/calina real desatura el cielo visto como fuente de luz: 30 % hacia el gris luminoso
        const lum = col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11;
        col[0] = mix(col[0], lum, 0.3);
        col[1] = mix(col[1], lum, 0.3);
        col[2] = mix(col[2], lum, 0.3);
        const i = (y * size + x) * 4;
        data[i] = col[0];
        data[i + 1] = col[1];
        data[i + 2] = col[2];
        data[i + 3] = 1;
      }
    }
    faces.push(data);
  }
  return faces;
}

function createSkyMaterial(scene: Scene, toSun: Vector3): ShaderMaterial {
  const mat = new ShaderMaterial("skyMat", scene, { vertex: "bfpsSky", fragment: "bfpsSky" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "sunDir", "sunDisk", "time", "cloudCover"],
  });
  mat.setVector3("sunDir", toSun);
  mat.setFloat("sunDisk", 1);
  mat.setFloat("time", 0);
  mat.setFloat("cloudCover", 0.5);
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  return mat;
}

async function exists(url: string, magic: (b: Uint8Array) => boolean): Promise<boolean> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) return false;
    const reader = res.body?.getReader();
    if (!reader) return false;
    const { value } = await reader.read();
    ctrl.abort();
    return !!value && magic(value);
  } catch {
    return false;
  }
}

/** Gira el HDRI en Y hasta que su dirección dominante de luz (término lineal de los armónicos esféricos) apunte al sol del juego. */
async function alignEnvironmentToSun(tex: HDRCubeTexture, toSun: Vector3): Promise<void> {
  for (let i = 0; i < 60 && !tex.sphericalPolynomial; i++) await new Promise((r) => setTimeout(r, 100));
  const sp = tex.sphericalPolynomial;
  if (!sp) return;
  // cada término lineal es un Vector3 con los canales R, G, B en x, y, z
  const dx = sp.x.x + sp.x.y + sp.x.z;
  const dz = sp.z.x + sp.z.y + sp.z.z;
  if (Math.hypot(dx, dz) < 1e-6) return;
  const envAz = Math.atan2(dx, dz); // acimut de la luz en el HDRI
  const sunAz = Math.atan2(toSun.x, toSun.z);
  // el cubo se muestrea con R(θ)·dirección_mundo; se busca θ tal que R(θ)·sol = dirección dominante del HDRI
  const probe = new Vector3(toSun.x, 0, toSun.z).normalize();
  for (const sign of [1, -1]) {
    const theta = sign * (envAz - sunAz);
    const v = Vector3.TransformNormal(probe, Matrix.RotationY(theta));
    if (Math.abs(Math.atan2(Math.sin(Math.atan2(v.x, v.z) - envAz), Math.cos(Math.atan2(v.x, v.z) - envAz))) < 0.05) {
      tex.rotationY = theta;
      console.info(`[Entorno] HDRI orientado al sol: giro ${((theta * 180) / Math.PI).toFixed(0)}° (luz del HDRI a ${((envAz * 180) / Math.PI).toFixed(0)}°, sol a ${((sunAz * 180) / Math.PI).toFixed(0)}°)`);
      return;
    }
  }
}

export function createEnvironment(scene: Scene, toSun: Vector3, intensity = 1): EnvironmentRig {
  registerSkyShader();
  const skyMat = createSkyMaterial(scene, toSun);
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 1400, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;
  sky.alwaysSelectAsActiveMesh = true;

  // Nubes en movimiento lento (un único uniform por fotograma).
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    skyMat.setFloat("time", t);
  });

  let envTex: BaseTexture | null = null;
  scene.environmentIntensity = intensity;

  const ready = (async () => {
    // 1) Entorno externo, si el usuario lo ha colocado.
    try {
      if (await exists(ENV_URLS.env, (b) => b[0] === 0x86 && b[1] === 0x16 && b[2] === 0x87 && b[3] === 0x96)) {
        envTex = CubeTexture.CreateFromPrefilteredData(ENV_URLS.env, scene, ".env");
        scene.environmentTexture = envTex;
        console.info("[Entorno] IBL cargado desde", ENV_URLS.env);
        return { source: "externo-env" as const };
      }
      if (await exists(ENV_URLS.hdr, (b) => b[0] === 0x23 && b[1] === 0x3f)) {
        const hdr = new HDRCubeTexture(ENV_URLS.hdr, scene, 256, false, true, false, true);
        envTex = hdr;
        scene.environmentTexture = hdr;
        // Orienta el HDRI para que su zona más luminosa (donde estaba el sol al hacer la foto) coincida con el sol del juego:
        // así la luz difusa y los reflejos del cielo vienen del mismo lado que las sombras.
        void alignEnvironmentToSun(hdr, toSun);
        console.info("[Entorno] IBL cargado desde", ENV_URLS.hdr, "(equirectangular HDR)");
        return { source: "externo-hdr" as const };
      }
    } catch (e) {
      console.warn("[Entorno] No se pudo cargar el entorno externo; se usa el procedural.", e);
    }

    // 2) Entorno procedural: cubemap del cielo calculado en CPU (128² por cara, sin disco solar para no
    //    duplicar el sol direccional) y prefiltrado con EnvironmentTextureTools (mips por rugosidad +
    //    armónicos esféricos para la luz difusa). No depende de renderizar fotogramas.
    console.info("[Entorno] Generando IBL procedural…");
    let source: "procedural-prefiltrado" | "procedural-sin-prefiltrar" = "procedural-sin-prefiltrar";
    try {
      const raw = new RawCubeTexture(scene, proceduralSkyFaces(128, toSun), 128, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_FLOAT, true, false);
      const buffer = await EnvironmentTextureTools.CreateEnvTextureAsync(raw);
      raw.dispose();
      const url = URL.createObjectURL(new Blob([buffer], { type: "octet/stream" }));
      const cube = CubeTexture.CreateFromPrefilteredData(url, scene, ".env");
      await new Promise<void>((resolve) => {
        if (cube.isReady()) resolve();
        else cube.onLoadObservable.addOnce(() => resolve());
      });
      envTex = cube;
      scene.environmentTexture = cube;
      source = "procedural-prefiltrado";
    } catch (e) {
      console.warn("[Entorno] Falló la generación/prefiltrado del entorno procedural.", e);
    }
    return { source };
  })();

  // ---- Cielo con foto real: cúpula (desde -12° bajo el horizonte hasta el cénit) hija del cielo procedural,
  //      que sigue calculando la iluminación; solo se oculta su esfera visible.
  let photo: { mesh: Mesh; quality: "medium" | "high" } | null = null;
  let photoLoading = false;
  const buildPhotoSky = async (quality: "medium" | "high"): Promise<void> => {
    if (photoLoading) return;
    photoLoading = true;
    try {
      const meta = (await (await fetch(ASSETS.skyPhoto.meta)).json()) as { bandRows: number; horizonRow: number; belowDeg: number };
      const R = 700, SEG = 128, rings: number[] = [];
      // anillos de elevación: más densos cerca del horizonte
      for (let i = 0; i <= 24; i++) rings.push(-meta.belowDeg + (i / 24) * (meta.belowDeg + 8));
      for (let i = 1; i <= 24; i++) rings.push(8 + (i / 24) * 82);
      const rowOf = (e: number): number => (e >= 0 ? meta.horizonRow * (1 - e / 90) : meta.horizonRow + (-e / meta.belowDeg) * (meta.bandRows - meta.horizonRow));
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let r = 0; r < rings.length; r++) {
        const e = (rings[r] * Math.PI) / 180, v = 1 - rowOf(rings[r]) / meta.bandRows;
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * Math.PI * 2;
          pos.push(R * Math.cos(e) * Math.sin(a), R * Math.sin(e), R * Math.cos(e) * Math.cos(a));
          uv.push(s / SEG, v);
        }
      }
      for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const mesh = new Mesh("skyPhoto", scene);
      const vd = new VertexData();
      vd.positions = pos; vd.uvs = uv; vd.indices = idx;
      vd.applyToMesh(mesh);
      const tex = new Texture(quality === "high" ? ASSETS.skyPhoto.high : ASSETS.skyPhoto.medium, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = 4;
      const m = new StandardMaterial("skyPhotoMat", scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(0.13, 0.13, 0.13); // la canalización HDR del juego expone mucho más que una foto LDR: sin atenuar se quema
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.backFaceCulling = false;
      m.fogEnabled = false;
      mesh.material = m;
      mesh.parent = sky;
      // orientación: la torre Glòries y el mar de la foto quedan al sureste (+X, -Z) y el Tibidabo al noroeste, como en la realidad
      mesh.rotation.y = (-85 * Math.PI) / 180;
      mesh.isPickable = false;
      mesh.applyFog = false;
      mesh.alwaysSelectAsActiveMesh = true;
      photo?.mesh.dispose(false, true);
      photo = { mesh, quality };
    } catch (e) {
      console.warn("[Cielo] No se pudo cargar el cielo con foto; se usa el procedural.", e);
      photo = null;
    } finally {
      photoLoading = false;
    }
  };
  const applyPhotoVisibility = (on: boolean): void => {
    sky.isVisible = !(on && photo);
    if (photo) photo.mesh.isVisible = on;
  };
  let wantPhoto = false;

  return {
    sky,
    setPhotoSky: (on, quality) => {
      wantPhoto = on;
      if (on && (!photo || photo.quality !== quality)) void buildPhotoSky(quality).then(() => applyPhotoVisibility(wantPhoto));
      applyPhotoVisibility(on);
    },
    ready,
    setIntensity: (v) => {
      scene.environmentIntensity = v;
    },
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      envTex?.dispose();
      sky.dispose();
    },
  };
}
