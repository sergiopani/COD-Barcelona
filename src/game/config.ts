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

/**
 * El parque (Plaça de Gaudí): una segunda manzana, contigua al OESTE de la basílica (es la manzana de la basílica trasladada un paso de cuadrícula).
 * Al oeste del parque corre una calle norte-sur cerrada por una fachada continua.
 */
export const PARK_CX = -STREET.pitch; // centro del parque: x = -133
export const WEST_STREET_AXIS = PARK_CX - STREET_AXIS; // calle al oeste del parque: x = -199.5
export const WEST_WALL = WEST_STREET_AXIS - STREET.width / 2; // fachada que cierra el mapa por el oeste: x = -209.5
/** Muros invisibles del mundo jugable (el lado oeste llega hasta la fachada del fondo). */
export const WORLD = { minX: WEST_WALL - 8, maxX: ARM_END + 8, minZ: -(ARM_END + 8), maxZ: ARM_END + 8 } as const;
/** Plano de asfalto bajo todo el mundo (6 m de margen). */
export const GROUND = {
  cx: (WEST_WALL - 6 + ARM_END + 6) / 2,
  width: ARM_END + 6 - (WEST_WALL - 6),
  depth: (ARM_END + 6) * 2,
} as const;
/** ¿Está el punto fuera del mundo jugable? */
export function outOfWorld(x: number, z: number): boolean {
  return x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ;
}

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
