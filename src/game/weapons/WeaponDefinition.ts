/**
 * Definición de armas. El juego solo tiene un arma (francotirador), pero todo el sistema
 * (WeaponController, Viewmodel, HUD, Ballistics) se alimenta de este tipo para poder añadir más en el futuro.
 */
export interface DamageProfile {
  head: number;
  torso: number;
  legs: number;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  /** Cargador y munición de reserva. */
  magazine: number;
  reserve: number;
  /** Tiempo entre disparos (cerrojo), s. */
  cycleTime: number;
  reloadTime: number;
  damage: DamageProfile;
  /** Dispersión (radianes) sin mira, y apuntando. */
  hipSpread: number;
  adsSpread: number;
  /** Aumentos de la mira (por nivel; la rueda del ratón cambia de nivel). */
  zoomLevels: number[];
  /** Tiempo para entrar/salir de la mira, s. */
  adsTime: number;
  /** Multiplicador de velocidad al apuntar. */
  adsMoveSpeed: number;
  /** Retroceso de cámara por disparo (rad). */
  recoilPitch: number;
  recoilYaw: number;
  /** Distancia máxima de la bala. */
  range: number;
  /** Longitud del modelo en la mano (m). */
  modelLength: number;
}

export const M1A_SNIPER: WeaponDefinition = {
  id: "m1a-sniper",
  name: "M1A Francotirador",
  magazine: 5,
  reserve: 30,
  cycleTime: 1.15,
  reloadTime: 2.6,
  damage: { head: 200, torso: 100, legs: 60 },
  hipSpread: 0.045,
  adsSpread: 0.0008,
  zoomLevels: [4, 8],
  adsTime: 0.18,
  adsMoveSpeed: 0.45,
  recoilPitch: 0.03,
  recoilYaw: 0.008,
  range: 400,
  modelLength: 1.12,
};
