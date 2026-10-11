import { Vector3 } from "@babylonjs/core";
import type { CombatSystem } from "../combat/CombatSystem";
import type { PlayerController } from "../player/PlayerController";
import type { TestResult } from "./selfTest";

/**
 * Pruebas automáticas de combate (window.__game.combatTest()). Simulan entrada de ratón/teclado reales
 * sobre los objetos del juego y avanzan los fotogramas a mano.
 */
export function runCombatTest(combat: CombatSystem, player: PlayerController, frames: (n: number) => void, setLocked: (v: boolean) => void): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
  const mouse = (t: string, b: number) => document.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true }));
  const key = (t: string, code: string) => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true }));
  const W = combat.weapon;
  const bot = combat.bots.bots[0];
  setLocked(true);

  const farAway = [new Vector3(-66.5, 0.05, -100), new Vector3(100, 0.05, 66.5), new Vector3(-100, 0.05, 66.5), new Vector3(-66.5, 0.05, 100), new Vector3(66.5, 0.05, 100), new Vector3(0, 0.05, -66.5)];
  const resetScene = () => {
    combat.bots.teleportAll([new Vector3(66.5, 0.05, 0), ...farAway.slice(0, 5)]);
    combat.health = 100;
    combat.alive = true;
    player.setDead(false);
    W.reset();
    player.teleport(66.5, 0.05, -60, 0);
    frames(5);
  };
  const wait = (s: number) => frames(Math.ceil(s * 60));
  const aimAt = (p: Vector3) => {
    const d = p.subtract(player.camera.position);
    player.yaw = Math.atan2(d.x, d.z);
    player.pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    frames(2);
  };
  /** Dispara apuntando por la mira (precisión máxima; a cadera la dispersión impediría acertar a 60 m). */
  const shoot = (scoped = true) => {
    if (scoped) {
      mouse("mousedown", 2);
      wait(0.5);
    }
    mouse("mousedown", 0);
    frames(1);
    mouse("mouseup", 0);
    frames(2);
    if (scoped) {
      mouse("mouseup", 2);
      frames(3);
    }
  };
  // los bots de prueba no deben disparar al jugador durante estas pruebas
  const freezeBotAi = (on: boolean) => bot.freeze(on);

  resetScene();
  freezeBotAi(true);

  // --- disparo: cabeza / torso / piernas
  const cases: [string, number, boolean, number][] = [
    ["cabeza", 1.62, false, 1],
    ["torso", 1.2, false, 1],
    ["piernas (1.er tiro)", 0.4, true, 0],
  ];
  for (const [label, h, survives] of cases.map((c) => [c[0], c[1], c[2]] as const)) {
    bot.respawn(new Vector3(66.5, 0.05, 0));
    frames(2);
    aimAt(new Vector3(bot.position.x, bot.position.y + h, bot.position.z));
    const kills0 = combat.kills;
    shoot();
    add(`impacto en ${label}`, survives ? bot.alive && bot.health === 40 : !bot.alive && combat.kills === kills0 + 1, `vivo=${bot.alive} PS=${bot.health}`);
    wait(1.3);
  }
  add("estadística de cabezas", combat.headshots >= 1, `cabezas=${combat.headshots}`);

  // --- munición y cadencia (cerrojo)
  resetScene();
  freezeBotAi(true);
  const a0 = W.ammo;
  shoot();
  const afterFirst = W.ammo;
  shoot(); // inmediato: el cerrojo aún no está listo
  add("cadencia: el 2.º disparo inmediato no sale", a0 === 5 && afterFirst === 4 && W.ammo === 4, `${a0} → ${afterFirst} → ${W.ammo}`);
  wait(1.3);

  // --- recarga
  key("keydown", "KeyR");
  frames(1);
  key("keyup", "KeyR");
  const reloading = W.isReloading;
  wait(W.def.reloadTime + 0.2);
  add("recarga", reloading && !W.isReloading && W.ammo === 5 && W.reserve === 29, `ammo=${W.ammo} reserva=${W.reserve}`);

  // --- apuntado y zoom
  mouse("mousedown", 2);
  wait(0.6);
  const fov4 = (player.camera.fov * 180) / Math.PI;
  const scoped = W.scoped && !document.getElementById("scope")!.hidden && document.getElementById("crosshair")!.style.display === "none";
  window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  wait(0.5);
  const fov8 = (player.camera.fov * 180) / Math.PI;
  add("apuntar: mira telescópica visible y mira de cadera oculta", scoped, `ads=${W.ads.toFixed(2)}`);
  add("zoom 4× → 8× (FOV baja)", W.zoom === 8 && fov8 < fov4 * 0.6, `FOV ${fov4.toFixed(1)}° → ${fov8.toFixed(1)}°`);
  add("sensibilidad reducida con zoom", player.sensScale < 0.3, `escala=${player.sensScale.toFixed(2)}`);
  mouse("mouseup", 2);
  wait(0.6);
  add("soltar el botón sale de la mira", W.ads < 0.01 && player.fovTarget === null, `ads=${W.ads.toFixed(2)}`);

  // --- impacto contra el mundo (decal) y basílica
  resetScene();
  freezeBotAi(true);
  const decals = () => player.camera.getScene().meshes.filter((m) => m.name.startsWith("fxDecal") && m.isEnabled()).length;
  const d0 = decals();
  player.teleport(66.5, 0.05, -20, -Math.PI / 2);
  player.pitch = -0.1;
  frames(3);
  shoot();
  add("la bala impacta en el edificio y deja agujero", decals() === d0 + 1, `agujeros ${d0} → ${decals()}`);

  // --- daño recibido, muerte y reaparición
  resetScene();
  freezeBotAi(true);
  const deaths0 = combat.deaths;
  combat.damagePlayer(60, new Vector3(66.5, 0, -30));
  frames(2);
  add("daño al jugador (100 → 40 PS)", combat.health === 40, `PS=${combat.health}`);
  combat.damagePlayer(50, new Vector3(66.5, 0, -30));
  frames(2);
  add("muerte: bloqueo de control y pantalla de eliminado", !combat.alive && player.isDead && !document.getElementById("death")!.hidden && combat.deaths === deaths0 + 1, `vivo=${combat.alive}`);
  wait(3.2);
  add("reaparición con salud y munición completas", combat.alive && !player.isDead && combat.health === 100 && W.ammo === 5 && document.getElementById("death")!.hidden, `PS=${combat.health} ammo=${W.ammo}`);

  freezeBotAi(false);
  resetScene();
  setLocked(false);
  const passed = results.filter((r) => r.pass).length;
  console.table(results.map((r) => ({ prueba: r.name, ok: r.pass ? "✔" : "✘", detalle: r.detail })));
  console.info(`[CombatTest] ${passed} correctas, ${results.length - passed} fallidas`);
  return { passed, failed: results.length - passed, results };
}
