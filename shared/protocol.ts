/**
 * Protocolo de red cliente ↔ servidor (JSON sobre WebSocket). Compartido por el cliente (Vite) y el servidor (Node).
 *
 * Modelo: el servidor es AUTORITATIVO para salud, daño, munición, cadencia, recarga, impactos, bajas y reapariciones.
 * El cliente solo envía su estado de movimiento (posición/orientación, que el servidor valida) y la intención de
 * disparar/recargar. Los jugadores remotos se renderizan con interpolación (~100 ms de retardo).
 */
export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
/** Frecuencia de instantáneas del servidor y de envío de estado del cliente (Hz). */
export const SERVER_TICK_HZ = 20;
export const CLIENT_SEND_HZ = 20;
/** Retardo de interpolación de los jugadores remotos (ms). */
export const INTERP_DELAY_MS = 100;
export const KILL_LIMIT = 20;
export const RESPAWN_SECONDS = 3;
export const NAME_MAX = 16;

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------- cliente → servidor

export interface JoinMsg {
  t: "join";
  v: number;
  name: string;
  /** Código de sala opcional (para jugar con amigos); si falta se asigna automáticamente. */
  room?: string;
}
/** Estado de movimiento (20 Hz). `p` son los PIES; `ads` = apuntando. */
export interface StateMsg {
  t: "state";
  seq: number;
  p: Vec3;
  yaw: number;
  pitch: number;
  ads: boolean;
}
/** Intención de disparo. `o` = ojo, `d` = dirección de la mirada (sin dispersión), `rt` = tiempo de servidor que veía el cliente. */
export interface FireMsg {
  t: "fire";
  o: Vec3;
  d: Vec3;
  rt: number;
  ads: number;
}
export interface ReloadMsg {
  t: "reload";
}
export interface PingMsg {
  t: "ping";
  c: number;
}
/** SOLO pruebas: teletransporte (el servidor lo ignora salvo con ALLOW_DEBUG=1). */
export interface DebugTeleportMsg {
  t: "dbg";
  p: Vec3;
}
export type ClientMsg = JoinMsg | StateMsg | FireMsg | ReloadMsg | PingMsg | DebugTeleportMsg;

// ---------------------------------------------------------------- servidor → cliente

export interface PlayerInfo {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  alive: boolean;
}

export interface WelcomeMsg {
  t: "welcome";
  id: number;
  room: string;
  serverTime: number;
  players: PlayerInfo[];
  killLimit: number;
  /** Posición y orientación de aparición asignadas por el servidor. */
  spawn: Vec3;
  yaw: number;
}
/** Instantánea: [id, x, y, z, yaw, pitch, ads(0/1), hp, alive(0/1)] por jugador. */
export type SnapPlayer = [number, number, number, number, number, number, number, number, number];
export interface SnapMsg {
  t: "snap";
  st: number;
  ps: SnapPlayer[];
  /** Estado propio autoritativo. */
  you: { hp: number; ammo: number; reserve: number; reloading: boolean; cooldown: number };
  /** Eco del último `seq` de estado aceptado (para detectar correcciones). */
  ack: number;
}
export interface JoinedMsg {
  t: "joined";
  player: PlayerInfo;
}
export interface LeftMsg {
  t: "left";
  id: number;
}
/** Disparo de otro jugador (o propio, para efectos): de dónde a dónde. */
export interface ShotMsg {
  t: "shot";
  id: number;
  from: Vec3;
  to: Vec3;
  hit: "none" | "world" | "player";
}
/** Confirmación de impacto para el tirador. */
export interface HitMsg {
  t: "hit";
  victim: number;
  zone: "head" | "torso" | "legs";
  dmg: number;
  killed: boolean;
}
/** Has recibido daño (dirección del atacante). */
export interface DamagedMsg {
  t: "damaged";
  from: Vec3;
  hp: number;
}
export interface KillMsg {
  t: "kill";
  killer: number;
  victim: number;
  zone: "head" | "torso" | "legs";
  dist: number;
}
export interface DiedMsg {
  t: "died";
  by: number;
  respawnIn: number;
}
export interface RespawnMsg {
  t: "respawn";
  p: Vec3;
  yaw: number;
}
/** El servidor corrige la posición del cliente (movimiento no válido). */
export interface CorrectMsg {
  t: "correct";
  p: Vec3;
  reason: string;
}
export interface ScoreMsg {
  t: "score";
  players: PlayerInfo[];
}
export interface MatchMsg {
  t: "match";
  state: "over" | "restart";
  winner?: number;
  restartIn?: number;
}
export interface PongMsg {
  t: "pong";
  c: number;
  st: number;
}
export interface ErrorMsg {
  t: "error";
  msg: string;
}
export type ServerMsg =
  | WelcomeMsg
  | SnapMsg
  | JoinedMsg
  | LeftMsg
  | ShotMsg
  | HitMsg
  | DamagedMsg
  | KillMsg
  | DiedMsg
  | RespawnMsg
  | CorrectMsg
  | ScoreMsg
  | MatchMsg
  | PongMsg
  | ErrorMsg;
