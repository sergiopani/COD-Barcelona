/**
 * Constantes del juego y de la escala del mapa (metros).
 * Los valores urbanos son una APROXIMACIÓN del Eixample (ver docs/MAPA.md).
 */
export const STREET = {
  /** Distancia entre ejes de calles contiguas (Eixample ≈ 133 m). */
  pitch: 133,
  /** Ancho de calle de fachada a fachada. */
  width: 20,
  /** Ancho de cada acera. */
  sidewalk: 4.5,
  /** Altura del bordillo. */
  curbHeight: 0.14,
  /** Lado de los chaflanes (xamfrans) de las esquinas, a 45°. */
  chamfer: 14,
  /** Longitud de las calles salientes desde la esquina de la manzana exterior. */
  armLength: 45,
} as const;

/** Semi-lado de la manzana de la basílica (fachada a fachada). */
export const BLOCK_HALF = (STREET.pitch - STREET.width) / 2; // 56.5
/** Coordenada del eje de las calles perimetrales. */
export const STREET_AXIS = STREET.pitch / 2; // 66.5
/** Inicio de las manzanas exteriores. */
export const OUTER_START = STREET_AXIS + STREET.width / 2; // 76.5
/** Fin de las calles salientes (línea de las fachadas de remate). */
export const ARM_END = OUTER_START + STREET.armLength + STREET.sidewalk; // 126

export const PLAYER = {
  eyeHeight: 1.65,
  /** Semi-ejes del elipsoide de colisión (x, y, z). */
  ellipsoid: { x: 0.4, y: 0.9, z: 0.4 },
  walkSpeed: 4.4,
  sprintSpeed: 7.0,
  accel: 14,
  airControl: 0.35,
  jumpSpeed: 5.4,
  gravity: 18,
  maxStep: 0.35,
  mouseSensitivity: 0.0022,
  killPlaneY: -20,
} as const;

export const ASSETS = {
  sagradaFamiliaGlb: "/assets/buildings/sagrada-familia.glb",
  sagradaFamiliaConfig: "/assets/buildings/sagrada-familia.config.json",
} as const;
