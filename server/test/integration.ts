import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type Vec3 } from "../../shared/protocol";

/**
 * Pruebas de integración del servidor: arranca una instancia en un puerto de prueba y la ataca con clientes
 * reales (WebSocket). Uso: npm run test:server
 */
const PORT = 8181;
const URL = `ws://127.0.0.1:${PORT}`;
let server: ChildProcess;

interface Client {
  ws: WebSocket;
  id: number;
  room: string;
  msgs: ServerMsg[];
  send(m: ClientMsg): void;
  wait<T extends ServerMsg["t"]>(t: T, ms?: number, pred?: (m: Extract<ServerMsg, { t: T }>) => boolean): Promise<Extract<ServerMsg, { t: T }>>;
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined;
  close(): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`);
};

function connect(name: string, room?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const msgs: ServerMsg[] = [];
    const waiters: { t: string; pred?: (m: never) => boolean; resolve: (m: never) => void }[] = [];
    const c: Client = {
      ws,
      id: 0,
      room: "",
      msgs,
      send: (m) => ws.send(JSON.stringify(m)),
      last: (t) => [...msgs].reverse().find((m) => m.t === t) as never,
      wait: (t, ms = 3000, pred) =>
        new Promise((res, rej) => {
          const found = msgs.find((m) => m.t === t && (!pred || pred(m as never)));
          if (found) return res(found as never);
          const w = { t, pred: pred as never, resolve: res as never };
          waiters.push(w);
          setTimeout(() => {
            const i = waiters.indexOf(w);
            if (i >= 0) {
              waiters.splice(i, 1);
              rej(new Error(`timeout esperando '${t}'`));
            }
          }, ms);
        }),
      close: () => ws.close(),
    };
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      msgs.push(m);
      if (msgs.length > 400) msgs.shift();
      if (m.t === "welcome") {
        c.id = m.id;
        c.room = m.room;
      }
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.t === m.t && (!w.pred || w.pred(m as never))) {
          waiters.splice(i, 1);
          w.resolve(m as never);
        }
      }
    });
    ws.on("open", () => {
      c.send({ t: "join", v: PROTOCOL_VERSION, name, room });
      c.wait("welcome").then(() => resolve(c), reject);
    });
    ws.on("error", reject);
  });
}

/** Coloca un cliente (envía estados) y espera a que el servidor lo acepte. */
async function place(c: Client, p: Vec3, yaw = 0, ads = false): Promise<void> {
  c.send({ t: "dbg", p }); // teletransporte de prueba (ALLOW_DEBUG=1)
  await sleep(40);
  for (let i = 0; i < 3; i++) {
    c.send({ t: "state", seq: i + 1000, p, yaw, pitch: 0, ads });
    await sleep(60);
  }
}

/** Vacía el buffer de mensajes de un cliente y espera a una instantánea nueva. */
async function fresh(c: Client): Promise<void> {
  c.msgs.length = 0;
  await c.wait("snap", 1000);
}

async function health(): Promise<{ rooms: number; players: number }> {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`);
  return (await r.json()) as { rooms: number; players: number };
}

async function main(): Promise<void> {
  server = spawn("npx", ["tsx", "server/src/index.ts"], { env: { ...process.env, PORT: String(PORT), KILL_LIMIT: "3", ALLOW_DEBUG: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (d) => process.env.VERBOSE && process.stdout.write(`[srv] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[srv-err] ${d}`));
  for (let i = 0; i < 40; i++) {
    try {
      await health();
      break;
    } catch {
      await sleep(250);
    }
  }

  // ---- 1) salas: 8 por sala, el 9.º va a otra
  const eight: Client[] = [];
  for (let i = 0; i < 8; i++) eight.push(await connect(`J${i}`));
  const ninth = await connect("Noveno");
  check("8 jugadores en la misma sala", new Set(eight.map((c) => c.room)).size === 1, `sala ${eight[0].room}`);
  check("el 9.º jugador va a otra sala pública", ninth.room !== eight[0].room, `sala ${ninth.room}`);
  const h1 = await health();
  check("salud del servidor: 2 salas, 9 jugadores", h1.rooms === 2 && h1.players === 9, JSON.stringify(h1));
  for (const c of [...eight, ninth]) c.close();
  await sleep(300);
  check("las salas vacías se eliminan", (await health()).rooms === 0);

  // ---- 2) protocolo: versión errónea, JSON basura, nombre saneado
  const bad = new WebSocket(URL);
  const errP = new Promise<ServerMsg>((res) => bad.on("message", (d) => res(JSON.parse(d.toString()))));
  await new Promise((r) => bad.on("open", r));
  bad.send("esto no es json");
  bad.send(JSON.stringify({ t: "join", v: 999, name: "x" }));
  const err = await errP;
  check("versión de protocolo incompatible → error", err.t === "error", JSON.stringify(err));
  const named = await connect("  <b>Nombre\u0001Larguísimo-que-supera-el-limite</b>  ");
  const nm = named.last("welcome")!.players[0].name;
  check("nombre saneado (sin <>/control y ≤16)", nm.length <= 16 && !/[<>\u0001]/.test(nm), `"${nm}"`);
  named.close();
  await sleep(200);

  // ---- 3) estado y sincronización entre dos jugadores
  const A = await connect("Tirador", "TEST");
  const B = await connect("Objetivo", "TEST");
  await place(A, [66.5, 0.05, -60], 0, true);
  await place(B, [66.5, 0.05, 0], Math.PI);
  await sleep(150);
  const snap = A.last("snap")!;
  const bInA = snap.ps.find((p) => p[0] === B.id)!;
  check("A recibe la posición de B en las instantáneas", !!bInA && Math.abs(bInA[1] - 66.5) < 0.1 && Math.abs(bInA[3] - 0) < 0.1, JSON.stringify(bInA));
  check("las instantáneas incluyen salud/ammo propios", snap.you.hp === 100 && snap.you.ammo === 5 && snap.you.reserve === 30, JSON.stringify(snap.you));

  // ---- 4) validación de movimiento
  const before = B.msgs.length;
  B.send({ t: "state", seq: 5000, p: [-100, 0.05, 100], yaw: 0, pitch: 0, ads: false }); // teletransporte
  const corr = await B.wait("correct", 1500);
  check("teletransporte imposible → corrección", corr.reason.includes("velocidad") || corr.reason.includes("límites"), corr.reason);
  B.send({ t: "state", seq: 5001, p: [56.2, 0.05, 0.0], yaw: 0, pitch: 0, ads: false }); // dentro del muro de edificio? (x=56.5 es la verja)
  await sleep(150);
  const corr2 = B.msgs.slice(before).filter((m) => m.t === "correct").length;
  check("posición dentro de un sólido → corrección", corr2 >= 2, `correcciones=${corr2}`);
  await place(B, [66.5, 0.05, 0], Math.PI);

  // ---- 5) disparo a la cabeza: muerte, kill feed, puntuación
  const bHead: Vec3 = [66.5, 0.05 + 1.62, 0];
  const eye: Vec3 = [66.5, 0.05 + 1.65, -60];
  const dirTo = (to: Vec3): Vec3 => {
    const d: Vec3 = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const rt = () => A.last("snap")!.st;
  A.send({ t: "fire", o: eye, d: dirTo(bHead), rt: rt(), ads: 1 });
  const hit = await A.wait("hit", 1500);
  check("impacto en la cabeza confirmado al tirador", hit.zone === "head" && hit.killed && hit.dmg === 200, JSON.stringify(hit));
  const died = await B.wait("died", 1500);
  check("la víctima recibe 'died' con cuenta atrás", died.by === A.id && died.respawnIn === 3, JSON.stringify(died));
  const kill = await B.wait("kill", 1500);
  check("la baja se retransmite a todos", kill.killer === A.id && kill.victim === B.id && kill.zone === "head", `dist=${kill.dist.toFixed(1)}`);
  const score = await A.wait("score", 1500, (m) => m.players.some((p) => p.kills === 1));
  check("marcador actualizado (1 baja / 1 muerte)", score.players.find((p) => p.id === A.id)!.kills === 1 && score.players.find((p) => p.id === B.id)!.deaths === 1);
  await sleep(150);
  check("la víctima muerta aparece como no viva en la instantánea", A.last("snap")!.ps.find((p) => p[0] === B.id)![8] === 0);

  // ---- 6) cadencia y munición
  await sleep(1300);
  const ammo0 = A.last("snap")!.you.ammo;
  A.send({ t: "fire", o: eye, d: [0, 0, -1], rt: rt(), ads: 1 });
  A.send({ t: "fire", o: eye, d: [0, 0, -1], rt: rt(), ads: 1 }); // inmediato: no debe salir
  await sleep(200);
  const ammo1 = A.last("snap")!.you.ammo;
  check("el cerrojo impide el 2.º disparo inmediato", ammo0 - ammo1 === 1, `${ammo0} → ${ammo1}`);

  // ---- 7) las balas se detienen en los edificios
  await sleep(1200);
  await fresh(A);
  await fresh(B);
  A.send({ t: "fire", o: eye, d: dirTo([0, 20, -20]), rt: rt(), ads: 1 }); // hacia la basílica (cajas gruesas)
  const shotB = await B.wait("shot", 1500);
  check("disparo contra la basílica: 'world' (no atraviesa)", shotB.hit === "world" && Math.abs(shotB.to[0]) < 60, `impacto=${shotB.to.map((v) => v.toFixed(1))}`);

  // ---- 8) recarga
  await sleep(1200);
  A.send({ t: "reload" });
  await sleep(300);
  check("recargando según el servidor", A.last("snap")!.you.reloading === true);
  await sleep(2600);
  const afterReload = A.last("snap")!.you;
  check("recarga completada (5 en cargador)", !afterReload.reloading && afterReload.ammo === 5, JSON.stringify(afterReload));
  A.send({ t: "fire", o: eye, d: [0, 0, -1], rt: rt(), ads: 1 });
  A.send({ t: "reload" });
  await sleep(100);

  // ---- 9) reaparición tras 3 s
  const resp = await B.wait("respawn", 4000);
  check("reaparición tras 3 s con salud completa", resp.p.length === 3 && B.last("snap")!.you.hp === 100, JSON.stringify(resp));
  await place(B, resp.p, 0);

  // ---- 10) compensación de latencia: B se movió, A dispara a donde B estaba hace ~150 ms
  await sleep(2600); // que termine la recarga iniciada antes
  await place(A, [66.5, 0.05, -60], 0, true);
  await place(B, [66.5, 0.05, 0], Math.PI);
  const tOld = A.last("snap")!.st; // B está en z=0 en este instante
  await sleep(100);
  B.send({ t: "state", seq: 7000, p: [66.5, 0.05, 1.2], yaw: Math.PI, pitch: 0, ads: false });
  await sleep(100);
  B.send({ t: "state", seq: 7001, p: [66.5, 0.05, 2.4], yaw: Math.PI, pitch: 0, ads: false });
  await sleep(60);
  await fresh(A);
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.2, 0]), rt: tOld, ads: 1 }); // apunta al torso donde estaba
  let comp = false;
  try {
    const h = await A.wait("hit", 1000);
    comp = h.victim === B.id;
  } catch {
    comp = false;
  }
  check("compensación de latencia: acierta donde el objetivo ESTABA", comp, comp ? "" : JSON.stringify(A.msgs.filter((m) => m.t !== "snap").slice(-4)) + " snapA=" + JSON.stringify(A.last("snap")?.you));
  await sleep(1300);
  await fresh(A);
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.2, 0]), rt: A.last("snap")!.st, ads: 1 }); // mismo disparo SIN retraso: B ya no está ahí
  let miss = false;
  try {
    await A.wait("hit", 600);
  } catch {
    miss = true;
  }
  check("sin retraso el mismo disparo falla (B ya se movió)", miss);

  // ---- 11) fin de partida (KILL_LIMIT=3) y reinicio
  for (let i = 0; i < 40 && B.last("snap")!.you.hp < 100; i++) await sleep(100); // espera la reaparición de B
  await sleep(1300);
  await place(B, [66.5, 0.05, 0], Math.PI);
  await place(A, [66.5, 0.05, -60], 0, true);
  await fresh(A);
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.62, 0]), rt: A.last("snap")!.st, ads: 1 });
  const over = await A.wait("match", 2000, (m) => m.state === "over").catch(() => null);
  check("partida terminada al alcanzar el límite de bajas", !!over && over.winner === A.id, JSON.stringify(over));
  const restart = await A.wait("match", 12000, (m) => m.state === "restart").catch(() => null);
  const sc = await A.wait("score", 2000, (m) => m.players.every((p) => p.kills === 0)).catch(() => null);
  check("reinicio automático con marcador a cero", !!restart && !!sc);

  // ---- 12) desconexión
  const leftP = A.wait("left", 2000);
  B.close();
  const left = await leftP.catch(() => null);
  check("desconexión retransmitida ('left')", !!left && left.id === B.id);
  A.close();
  await sleep(300);
  check("sala eliminada al quedar vacía", (await health()).rooms === 0);
}

main()
  .catch((e) => {
    check("ejecución sin excepciones", false, String(e));
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed} correctas, ${failed} fallidas`);
    server?.kill();
    process.exit(failed ? 1 : 0);
  });
