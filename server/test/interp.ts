import { ClockSync, interpolate, type NetSample } from "../../shared/interp";

/**
 * Prueba de la interpolación de jugadores remotos con red realista: el servidor emite a 20 Hz, los paquetes llegan con
 * jitter (±30 ms, 40 ms de base) y se dibuja a 60 FPS con 100 ms de retardo de interpolación. Verifica que el error de
 * posición es pequeño y que NO hay saltos entre fotogramas. Uso: npm run test:interp
 */
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// trayectoria real del jugador remoto: 5 m/s en zig-zag
const truth = (t: number) => ({ x: 66.5 + Math.sin(t / 1000) * 4, z: Math.sin(t / 3000) * 20, yaw: (t / 2000) % (Math.PI * 2) });

const offsetServer = 123456; // el reloj del servidor no coincide con el local
const sync = new ClockSync();
const samples: NetSample[] = [];
const packets: { arrive: number; st: number }[] = [];
for (let st = 0; st < 12000; st += 50) packets.push({ st, arrive: st - offsetServer + 40 + (rnd() * 2 - 1) * 30 });
// TCP/WebSocket entrega en orden: la llegada es monótona aunque el retardo tenga jitter
packets.sort((a, b) => a.st - b.st);
for (let i = 1; i < packets.length; i++) packets[i].arrive = Math.max(packets[i].arrive, packets[i - 1].arrive + 1);

let pi = 0;
let maxErr = 0;
let maxStep = 0;
let prev: { x: number; z: number } | null = null;
let frames = 0;
for (let local = packets[0].arrive; local < 11500 - offsetServer; local += 1000 / 60) {
  while (pi < packets.length && packets[pi].arrive <= local) {
    const p = packets[pi++];
    const g = truth(p.st);
    samples.push({ t: p.st, x: g.x, y: 0, z: g.z, yaw: g.yaw, ads: 0, alive: 1 });
    sync.update(p.st, p.arrive);
    while (samples.length > 40) samples.shift();
  }
  if (samples.length < 8) continue; // calentamiento: el buffer debe tener historial
  const renderServerTime = sync.serverNow(local) - 100;
  if (renderServerTime < samples[0].t + 50) continue;
  const it = interpolate(samples, renderServerTime)!;
  const g = truth(renderServerTime);
  const e = Math.hypot(it.x - g.x, it.z - g.z);
  if (e > maxErr) { maxErr = e; if (process.env.DBG) console.log("err", e.toFixed(2), { local: Math.round(local), rt: Math.round(renderServerTime), first: samples[0].t, last: samples[samples.length - 1].t, n: samples.length }); }
  if (prev) maxStep = Math.max(maxStep, Math.hypot(it.x - prev.x, it.z - prev.z));
  prev = it;
  frames++;
}
const vmax = Math.hypot(4, 20 / 3) * 1; // m/s aprox. (cota de la velocidad real)
const stepBound = (vmax / 60) * 2.5;
console.log(`fotogramas=${frames} errorMáx=${maxErr.toFixed(3)} m  pasoMáx=${maxStep.toFixed(3)} m/fotograma (cota ${stepBound.toFixed(3)})`);
const ok = maxErr < 0.35 && maxStep < stepBound;
console.log(ok ? "✔ interpolación fluida y precisa" : "✘ interpolación fuera de tolerancia");
process.exit(ok ? 0 : 1);
