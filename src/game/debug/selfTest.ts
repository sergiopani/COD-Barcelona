import { Matrix, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { ARM_END, PARK_CX, WEST_WALL, outOfWorld } from "../config";
import type { PlayerController } from "../player/PlayerController";
import type { BarcelonaMap } from "../world/BarcelonaMap";
import { crosswalks } from "../world/mapLayout";

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const DT = 1 / 60;

/** ¿Está el punto dentro de alguna caja de colisión sólida? (prueba OBB exacta). */
function insideSolid(scene: Scene, p: Vector3, margin = 0): string | null {
  const local = new Vector3();
  const inv = new Matrix();
  for (const m of scene.meshes) {
    if (!m.checkCollisions || !m.metadata?.collider || m.metadata.tag === "ground") continue;
    m.getWorldMatrix().invertToRef(inv);
    Vector3.TransformCoordinatesToRef(p, inv, local);
    const bb = (m as Mesh).getBoundingInfo().boundingBox;
    if (local.x > bb.minimum.x - margin && local.x < bb.maximum.x + margin && local.y > bb.minimum.y && local.y < bb.maximum.y && local.z > bb.minimum.z - margin && local.z < bb.maximum.z + margin) {
      return `${m.name} (${m.metadata.tag})`;
    }
  }
  return null;
}

/** ¿Se solapa el cuerpo completo (pies, torso y cabeza) con algún sólido, con margen horizontal? */
function bodyOverlaps(scene: Scene, feet: Vector3, margin: number): boolean {
  return [0.05, 0.6, 1.2, 1.75].some((h) => insideSolid(scene, feet.add(new Vector3(0, h, 0)), margin) !== null);
}

/** Busca una z con la franja x0..x1 libre de sólidos (para pruebas de bordillo/salto que no dependan de la disposición del mobiliario). */
function findClearZ(scene: Scene, x0: number, x1: number): number {
  for (let z = -40; z <= 40; z += 1) {
    let clear = true;
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) && clear; x += 0.5) {
      for (const dz of [-0.7, 0, 0.7]) {
        if (bodyOverlaps(scene, new Vector3(x, 0.05, z + dz), 0.5)) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return z;
  }
  return -5;
}

/**
 * Pruebas automáticas de movimiento/colisión ejecutadas dentro del navegador (window.__game.selfTest()).
 * Simulan al jugador a 60 Hz sin necesidad de teclado ni Pointer Lock.
 */
export function runCollisionSelfTest(scene: Scene, player: PlayerController, map: BarcelonaMap): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  const saved = { pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch };
  const add = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

  const run = (frames: number, forward = 1, sprint = true, strafe = 0, onFrame?: () => void) => {
    for (let i = 0; i < frames; i++) {
      player.step({ forward, strafe, sprint, jump: false }, DT);
      onFrame?.();
    }
  };

  // 1) Aparición y suelo estable
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i];
    player.teleport(s.x, 1.5, s.z, s.yaw);
    run(120, 0, false);
    const y = player.position.y;
    const hit = insideSolid(scene, player.position.add(new Vector3(0, 0.9, 0)));
    add(`spawn ${i} apoya en el suelo`, player.grounded && y > -0.05 && y < 0.2 && !hit, `grounded=${player.grounded} y=${y.toFixed(3)}${hit ? " dentro de " + hit : ""}`);
  }

  // 2) Empujar contra todo en 16 direcciones desde varios puntos: nunca atravesar sólidos ni salir del mapa
  const origins: [number, number][] = [[62, 0], [-62, 10], [10, 62], [-10, -62], [66.5, 70], [66.5, 100], [100, 66.5], [-66.5, -100], [-100, -66.5], [0, 0.0001 + 66.5], [75, 75], [-75, 75], [75, -75], [-75, -75]];
  let pushFail = 0;
  let pushCount = 0;
  const failDetails: string[] = [];
  let skipped = 0;
  for (const [ox, oz] of origins) {
    player.teleport(ox, 0.5, oz, 0);
    if (bodyOverlaps(scene, player.position, 0.5)) {
      skipped++; // origen dentro de un coche/mobiliario: no es un punto de partida válido
      continue;
    }
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2;
      player.teleport(ox, 0.5, oz, yaw);
      let bad: string | null = null;
      run(240, 1, true, 0, () => {
        const p = player.position;
        const hit = insideSolid(scene, p.add(new Vector3(0, 0.9, 0)));
        if (hit && !bad) bad = hit;
        if (outOfWorld(p.x, p.z) && !bad) bad = "fuera de los límites";
        if (p.y < -1 && !bad) bad = "cayó bajo el suelo";
      });
      pushCount++;
      if (bad) {
        pushFail++;
        if (failDetails.length < 5) failDetails.push(`(${ox},${oz}) yaw=${((yaw * 180) / Math.PI).toFixed(0)}° → ${bad}`);
      }
    }
  }
  add(`empuje en 16 direcciones desde ${origins.length - skipped} puntos (${pushCount} carreras)`, pushFail === 0, pushFail === 0 ? "ninguna penetración" : `${pushFail} fallos: ${failDetails.join(" | ")}`);

  // 3) Bordillo: de la calzada a la acera (debe subir) y la verja debe frenar
  const clearZ = findClearZ(scene, 58, 68);
  player.teleport(63, 0.05, clearZ, -Math.PI / 2);
  let maxY = 0;
  run(150, 1, false, 0, () => (maxY = Math.max(maxY, player.position.y)));
  add("sube el bordillo (0,14 m) hacia la acera", maxY > 0.12, `y máx = ${maxY.toFixed(3)}`);
  add("la verja de la manzana frena al jugador", player.position.x > 56.5, `x final = ${player.position.x.toFixed(2)} (verja en x = 56.5)`);

  // 4) Bajar de la acera a la calzada
  player.teleport(58, 0.2, clearZ, Math.PI / 2);
  run(120, 1, false);
  add("baja del bordillo a la calzada", player.grounded && player.position.y < 0.05, `y = ${player.position.y.toFixed(3)} grounded=${player.grounded} (z=${clearZ}, x final=${player.position.x.toFixed(1)})`);

  // 5) Salto: despega y aterriza
  player.teleport(63.5, 0.05, clearZ - 6, 0);
  run(30, 0, false);
  let apex = 0;
  player.step({ forward: 0, strafe: 0, sprint: false, jump: true }, DT);
  for (let i = 0; i < 90; i++) {
    player.step({ forward: 0, strafe: 0, sprint: false, jump: false }, DT);
    apex = Math.max(apex, player.position.y);
  }
  add("salto: despega y aterriza", apex > 0.6 && apex < 1.2 && player.grounded && Math.abs(player.position.y) < 0.05, `apex = ${apex.toFixed(2)} m, y final = ${player.position.y.toFixed(3)}`);

  // 6) Todos los pasos de peatones se pueden cruzar de acera a acera
  let crossFail = 0;
  const crossDetails: string[] = [];
  for (const cw of crosswalks) {
    const dir = cw.axis === "x" ? [0, 1] : [1, 0];
    const sx = cw.x - dir[0] * 7;
    const sz = cw.z - dir[1] * 7;
    const yaw = cw.axis === "x" ? 0 : Math.PI / 2;
    player.teleport(sx, 0.3, sz, yaw);
    run(210, 1, false);
    const d = Math.hypot(player.position.x - (cw.x + dir[0] * 7), player.position.z - (cw.z + dir[1] * 7));
    if (d > 1.2) {
      crossFail++;
      if (crossDetails.length < 4) crossDetails.push(`(${cw.x.toFixed(1)}, ${cw.z.toFixed(1)}) quedó a ${d.toFixed(1)} m`);
    }
  }
  add(`${crosswalks.length} pasos de peatones transitables`, crossFail === 0, crossFail === 0 ? "todos cruzados" : crossDetails.join(" | "));

  // 7) Recorrido largo de las calles salientes hasta el remate
  const arms: [number, number, number][] = [[66.5, 60, 0], [66.5, -60, Math.PI], [60, 66.5, Math.PI / 2], [-60, 66.5, -Math.PI / 2]];
  for (const [ax, az, yaw] of arms) {
    player.teleport(ax, 0.05, az, yaw);
    run(600, 1, true);
    add(`calle saliente desde (${ax},${az}) termina en el remate`, player.position.x > WEST_WALL - 1 && player.position.x < ARM_END + 1 && Math.abs(player.position.z) < ARM_END + 1, `(${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)})`);
  }

  // 8) Prueba aleatoria (fuzz): 300 recorridos con giros, laterales y saltos desde puntos de calle
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let fuzzFail = 0;
  let fuzzRuns = 0;
  const fuzzDetails: string[] = [];
  for (let n = 0; n < 300; n++) {
    const axis = rnd() < 0.5 ? "x" : "z";
    const street = (rnd() < 0.5 ? -1 : 1) * 66.5;
    const t = (rnd() * 2 - 1) * 120;
    const off = (rnd() * 2 - 1) * 9.5;
    const x = axis === "x" ? t : street + off;
    const z = axis === "x" ? street + off : t;
    if (Math.abs(x) < 57 && Math.abs(z) < 57) continue;
    player.teleport(x, 0.5, z, rnd() * Math.PI * 2);
    if (bodyOverlaps(scene, player.position, 0.5)) continue; // empezaría solapado con un sólido
    fuzzRuns++;
    let bad: string | null = null;
    let fwd = 1;
    let str = 0;
    for (let i = 0; i < 360 && !bad; i++) {
      if (i % 45 === 0) {
        fwd = rnd() < 0.75 ? 1 : -1;
        str = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) : 0;
        player.yaw += (rnd() - 0.5) * 2.2;
      }
      player.step({ forward: fwd, strafe: str, sprint: rnd() < 0.8, jump: i % 70 === 0 }, DT);
      const p = player.position;
      const hit = insideSolid(scene, p.add(new Vector3(0, 0.9, 0))) ?? insideSolid(scene, p.add(new Vector3(0, 0.3, 0)));
      if (hit) bad = hit;
      else if (outOfWorld(p.x, p.z)) bad = "fuera de los límites";
      else if (p.y < -1) bad = "bajo el suelo";
      else if (p.y > 4) bad = "se subió a un sólido (y=" + p.y.toFixed(1) + ")";
    }
    if (bad) {
      fuzzFail++;
      if (fuzzDetails.length < 4) fuzzDetails.push(`(${x.toFixed(1)},${z.toFixed(1)}) → ${bad}`);
    }
  }
  add(`prueba aleatoria (${fuzzRuns} recorridos con giros, laterales y saltos)`, fuzzFail === 0, fuzzFail === 0 ? "ninguna penetración" : `${fuzzFail} fallos: ${fuzzDetails.join(" | ")}`);

  // 9) El parque y la calle oeste: recorridos aleatorios por el césped, el estanque (borde sólido), los caminos y las calles de su alrededor
  let parkFail = 0;
  let parkRuns = 0;
  const parkDetails: string[] = [];
  for (let n = 0; n < 150; n++) {
    const x = PARK_CX + (rnd() * 2 - 1) * 70;
    const z = (rnd() * 2 - 1) * 70;
    player.teleport(x, 0.5, z, rnd() * Math.PI * 2);
    if (bodyOverlaps(scene, player.position, 0.5)) continue;
    parkRuns++;
    let bad: string | null = null;
    let fwd = 1;
    let str = 0;
    for (let i = 0; i < 420 && !bad; i++) {
      if (i % 45 === 0) {
        fwd = rnd() < 0.8 ? 1 : -1;
        str = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
        player.yaw += (rnd() - 0.5) * 2.4;
      }
      player.step({ forward: fwd, strafe: str, sprint: rnd() < 0.8, jump: i % 70 === 0 }, DT);
      const p = player.position;
      const hit = insideSolid(scene, p.add(new Vector3(0, 0.9, 0))) ?? insideSolid(scene, p.add(new Vector3(0, 0.3, 0)));
      if (hit) bad = hit;
      else if (outOfWorld(p.x, p.z)) bad = "fuera de los límites";
      else if (p.y < -1) bad = "bajo el suelo";
      else if (p.y > 4) bad = "se subió a un sólido (y=" + p.y.toFixed(1) + ")";
    }
    if (bad) {
      parkFail++;
      if (parkDetails.length < 4) parkDetails.push(`(${x.toFixed(1)},${z.toFixed(1)}) → ${bad}`);
    }
  }
  add(`parque y calle oeste (${parkRuns} recorridos aleatorios)`, parkFail === 0, parkFail === 0 ? "ninguna penetración" : `${parkFail} fallos: ${parkDetails.join(" | ")}`);

  player.teleport(saved.pos.x, saved.pos.y, saved.pos.z, saved.yaw);
  player.pitch = saved.pitch;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.table(results.map((r) => ({ prueba: r.name, ok: r.pass ? "✔" : "✘", detalle: r.detail })));
  console.info(`[SelfTest] ${passed} correctas, ${failed} fallidas`);
  return { passed, failed, results };
}
