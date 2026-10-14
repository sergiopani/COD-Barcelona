/**
 * Perfiles gráficos. Cada campo modifica una opción REAL del renderizado (ver Lighting.applyProfile,
 * Game.applyResolution y GraphicsSettings.applyAnisotropy). Se persisten en localStorage.
 */
export type ProfileName = "low" | "medium" | "high";

export interface GraphicsProfile {
  label: string;
  /** Tope del devicePixelRatio usado como resolución interna. */
  maxPixelRatio: number;
  /** Factor adicional sobre la resolución interna (1 = nativa, <1 = renderiza menos píxeles). */
  renderScale: number;
  /** Muestras MSAA del pipeline HDR (0/1 = sin MSAA). */
  msaa: 0 | 2 | 4;
  /** FXAA solo se usa cuando no hay MSAA (no se duplican antialiasings). */
  fxaa: boolean;
  shadows: {
    enabled: boolean;
    mapSize: number;
    cascades: number;
    maxZ: number;
    quality: "low" | "medium" | "high";
    /** Molduras y balcones de piedra proyectan sombra (cuesta más). */
    detailCasters: boolean;
    /** Sombra de la basílica mediante un proxy de columnas de baja geometría. */
    basilica: boolean;
  };
  ssao: "off" | "half" | "full";
  bloom: boolean;
  sharpen: boolean;
  vignette: boolean;
  anisotropy: number;
  drawDistance: number;
  /** Reflejos en espacio de pantalla (solo se activan con asfalto mojado). */
  ssr: boolean;
  /** Helicópteros que sobrevuelan la ciudad. */
  helicopters: number;
  /** Decorado: la ciudad real de Barcelona (fotogrametría) alrededor del mapa. */
  cityBackdrop: boolean;
}

export const PROFILES: Record<ProfileName, GraphicsProfile> = {
  low: {
    label: "Bajo",
    maxPixelRatio: 1,
    renderScale: 0.8,
    msaa: 0,
    fxaa: true,
    shadows: { enabled: true, mapSize: 1024, cascades: 2, maxZ: 120, quality: "low", detailCasters: false, basilica: false },
    ssao: "off",
    bloom: false,
    sharpen: false,
    vignette: false,
    anisotropy: 4,
    drawDistance: 500,
    ssr: false,
    helicopters: 2,
    cityBackdrop: false,
  },
  medium: {
    label: "Medio",
    maxPixelRatio: 1.5,
    renderScale: 1,
    msaa: 2,
    fxaa: false,
    shadows: { enabled: true, mapSize: 2048, cascades: 3, maxZ: 180, quality: "medium", detailCasters: false, basilica: true },
    ssao: "half",
    bloom: true,
    sharpen: true,
    vignette: true,
    anisotropy: 8,
    drawDistance: 700,
    ssr: false,
    helicopters: 3,
    cityBackdrop: true,
  },
  high: {
    label: "Alto",
    maxPixelRatio: 2,
    renderScale: 1,
    msaa: 4,
    fxaa: false,
    shadows: { enabled: true, mapSize: 4096, cascades: 4, maxZ: 260, quality: "high", detailCasters: true, basilica: true },
    ssao: "full",
    bloom: true,
    sharpen: true,
    vignette: true,
    anisotropy: 16,
    drawDistance: 900,
    ssr: true,
    helicopters: 4,
    cityBackdrop: true,
  },
};

const KEY = "barcelonaFps.graphics.v1";

export interface SavedSettings {
  profile: ProfileName;
  wet: boolean;
  skyPhoto?: boolean;
}

/** Estado de ajustes gráficos del usuario. localStorage puede fallar (modo privado): siempre con try/catch. */
export class GraphicsSettings {
  profile: ProfileName = "medium";
  wet = false;
  /** Cielo con foto real (panorama de Barcelona) en lugar del procedural. */
  skyPhoto = true;
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<SavedSettings>;
        if (s.profile && s.profile in PROFILES) this.profile = s.profile;
        if (typeof s.wet === "boolean") this.wet = s.wet;
        if (typeof s.skyPhoto === "boolean") this.skyPhoto = s.skyPhoto;
      }
    } catch {
      /* sin persistencia */
    }
  }

  get current(): GraphicsProfile {
    return PROFILES[this.profile];
  }

  set(profile: ProfileName, wet = this.wet, persist = true, skyPhoto = this.skyPhoto): void {
    this.profile = profile;
    this.wet = wet;
    this.skyPhoto = skyPhoto;
    if (persist) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ profile, wet, skyPhoto } satisfies SavedSettings));
      } catch {
        /* ignorar */
      }
    }
    this.listeners.forEach((l) => l());
  }

  onChange(l: () => void): void {
    this.listeners.push(l);
  }
}
