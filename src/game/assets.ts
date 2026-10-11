/**
 * Rutas de los recursos del juego. Respetan la base de despliegue (`base` de Vite / VITE_BASE) para poder
 * servir el juego desde una subruta (p. ej. https://sitio.com/barcelona-fps/).
 */
const BASE = (import.meta as unknown as { env: { BASE_URL?: string } }).env.BASE_URL ?? "/";

export const assetUrl = (path: string): string => `${BASE}${path.replace(/^\//, "")}`;

export const ASSETS = {
  sagradaFamiliaGlb: assetUrl("assets/buildings/sagrada-familia.glb"),
  palmGlb: assetUrl("assets/props/palm-tree.glb"),
  carPackGlb: assetUrl("assets/props/car-pack.glb"),
  rifleGlb: assetUrl("assets/weapons/m1a-springfield.glb"),
  sagradaFamiliaConfig: assetUrl("assets/buildings/sagrada-familia.config.json"),
  envEnv: assetUrl("assets/env/environment.env"),
  envHdr: assetUrl("assets/env/environment.hdr"),
} as const;
