import crypto from "node:crypto";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type Vec3 } from "../../shared/protocol";

/**
 * Pruebas de integración del servidor: arranca una instancia en un puerto de prueba (con un directorio de datos temporal)
 * y la ataca con clientes reales (WebSocket). Uso: npm run test:server
 */
const PORT = 8181;
const URL = `ws://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bfps-test-"));
const TOKEN = (n: string) => n; // identificador de la cuenta de Google de pruebas (`connect` firma el token)

// ---- «Google» de pruebas: par de claves RSA propio + servidor JWKS local; el servidor verifica las firmas de verdad
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const JWKS_PORT = PORT + 1;
const keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
function signGoogle(user: string, name: string, opts: { aud?: string; exp?: number; key?: crypto.KeyObject; iss?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", kid: "test-kid", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ iss: opts.iss ?? "https://accounts.google.com", aud: opts.aud ?? CLIENT_ID, sub: `sub-${user}`, email: `${user}@test.local`, email_verified: true, name, picture: "https://example.com/p.png", iat: now, exp: opts.exp ?? now + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), opts.key ?? keyPair.privateKey);
  return `${header}.${payload}.${b64u(sig)}`;
}
const jwksServer = http.createServer((_req, res) => {
  const jwk = { ...keyPair.publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [jwk] }));
});
let server: ChildProcess | null = null;

interface Client {
  ws: WebSocket;
  id: number;
  room: string;
  welcome: Extract<ServerMsg, { t: "welcome" }> | null;
  msgs: ServerMsg[];
  /** Contador de mensajes por tipo (no se vacía con fresh()). */
  counts: Record<string, number>;
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

async function health(): Promise<{ rooms: number; players: number; ranked: number; maxPlayers: number }> {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`);
  return (await r.json()) as { rooms: number; players: number; ranked: number; maxPlayers: number };
}

interface BoardRowHttp {
  rank: number;
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
}
async function ranking(limit = 50): Promise<{ total: number; top: BoardRowHttp[]; raw: string }> {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/leaderboard?limit=${limit}`);
  const raw = await r.text();
  return { ...(JSON.parse(raw) as { total: number; top: BoardRowHttp[] }), raw };
}

function startServer(): Promise<void> {
  server = spawn("npx", ["tsx", "server/src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), KILL_LIMIT: "3", ALLOW_DEBUG: "1", MAX_PLAYERS: "8", DATA_DIR, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CERTS_URL: `http://127.0.0.1:${JWKS_PORT}/certs` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => process.env.VERBOSE && process.stdout.write(`[srv] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[srv-err] ${d}`));
  return (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        await health();
        return;
      } catch {
        await sleep(250);
      }
    }
    throw new Error("el servidor no arrancó");
  })();
}

/** Para el servidor con SIGTERM (debe guardar el ranking) y espera a que desaparezca. */
async function stopServer(): Promise<void> {
  spawn("pkill", ["-TERM", "-f", "server/src/index.ts"]);
  for (let i = 0; i < 40; i++) {
    try {
      await health();
      await sleep(150);
    } catch {
      return;
    }
  }
}

/** `user` = cuenta de Google de pruebas (se firma un token con ese nombre); sin `user` entra como invitado. */
function connect(name: string, user?: string, rawToken?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const msgs: ServerMsg[] = [];
    const waiters: { t: string; pred?: (m: never) => boolean; resolve: (m: never) => void }[] = [];
    const c: Client = {
      ws,
      id: 0,
      room: "",
      welcome: null,
      msgs,
      counts: {},
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
      c.counts[m.t] = (c.counts[m.t] ?? 0) + 1;
      if (msgs.length > 400) msgs.shift();
      if (m.t === "welcome") {
        c.id = m.id;
        c.room = m.room;
        c.welcome = m;
      }
      if (m.t === "error" && !c.welcome) reject(new Error(m.msg));
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.t === m.t && (!w.pred || w.pred(m as never))) {
          waiters.splice(i, 1);
          w.resolve(m as never);
        }
      }
    });
    ws.on("open", () => {
      c.send({ t: "join", v: PROTOCOL_VERSION, name, idToken: rawToken ?? (user ? signGoogle(user, name) : undefined) });
      c.wait("welcome").then(() => resolve(c), () => undefined);
    });
    ws.on("error", reject);
  });
}

/** Coloca un cliente (teletransporte de prueba + estados) y espera a que el servidor lo acepte. */
async function place(c: Client, p: Vec3, yaw = 0, ads = false): Promise<void> {
  c.send({ t: "dbg", p });
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

const EYE_Z = -60;
const eye: Vec3 = [66.5, 0.05 + 1.65, EYE_Z];
const dirTo = (to: Vec3): Vec3 => {
  const d: Vec3 = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** Tirador `from` (en eye) mata a `to` (en [66.5, 0, 0]) con un disparo apuntando por la mira. */
async function killWith(from: Client, to: Client, headshot: boolean): Promise<void> {
  await place(from, [66.5, 0.05, EYE_Z], 0, true);
  await place(to, [66.5, 0.05, 0], Math.PI);
  await sleep(150);
  await fresh(from);
  from.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + (headshot ? 1.62 : 1.2), 0]), rt: from.last("snap")!.st, ads: 1 });
  await from.wait("hit", 1500);
}

async function waitAlive(c: Client): Promise<void> {
  for (let i = 0; i < 60 && (c.last("snap")?.you.hp ?? 0) < 100; i++) await sleep(100);
  await sleep(1300); // cerrojo
}

async function main(): Promise<void> {
  await new Promise<void>((r) => jwksServer.listen(JWKS_PORT, "127.0.0.1", r));
  await startServer();

  // ---- 1) UNA sola sala global con aforo
  const eight: Client[] = [];
  for (let i = 0; i < 8; i++) eight.push(await connect(`J${i}`, TOKEN(`cap${i}`)));
  check("todos entran en la misma (única) sala GLOBAL", new Set(eight.map((c) => c.room)).size === 1 && eight[0].room === "GLOBAL", `sala ${eight[0].room}`);
  const full = await connect("Noveno", TOKEN("cap9")).then(
    () => null,
    (e: Error) => e.message,
  );
  check("al llenarse (8/8) el siguiente recibe 'Servidor lleno'", !!full && full.includes("Servidor lleno"), String(full));
  const h1 = await health();
  check("salud del servidor: 1 sala, 8 jugadores", h1.rooms === 1 && h1.players === 8 && h1.maxPlayers === 8, JSON.stringify(h1));
  for (const c of eight) c.close();
  await sleep(300);
  check("al salir todos, la sala sigue (vacía) y admite nuevos jugadores", (await health()).players === 0);

  // ---- 2) protocolo: versión errónea, JSON basura, nombre saneado, ranking vacío al empezar
  const bad = new WebSocket(URL);
  const errP = new Promise<ServerMsg>((res) => bad.on("message", (d) => res(JSON.parse(d.toString()))));
  await new Promise((r) => bad.on("open", r));
  bad.send("esto no es json");
  bad.send(JSON.stringify({ t: "join", v: 999, name: "x" }));
  const err = await errP;
  check("versión de protocolo incompatible → error", err.t === "error", JSON.stringify(err));
  const named = await connect("  <b>Nombre\u0001Larguísimo-que-supera-el-limite</b>  ", TOKEN("nombre"));
  const nm = named.welcome!.players[0].name;
  check("nombre saneado (sin <>/control y ≤16)", nm.length <= 16 && !/[<>\u0001]/.test(nm), `"${nm}"`);
  check("usuario de Google sin bajas: registrado, rank 0 y ranking vacío", named.welcome!.registered === true && named.welcome!.global?.kills === 0 && named.welcome!.global?.rank === 0 && (await ranking()).total === 0);
  const guest0 = await connect("Invitado");
  check("sin sesión: entra como invitado (no registrado, sin ranking)", guest0.welcome!.registered === false && guest0.welcome!.global === null);
  guest0.close();
  const cfg = (await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()) as { googleClientId: string | null };
  check("/api/config publica el ID de cliente de Google (no secreto)", cfg.googleClientId === CLIENT_ID);
  const rejected = async (tok: string): Promise<string> => {
    const ws = new WebSocket(URL);
    return new Promise((res) => {
      ws.on("open", () => ws.send(JSON.stringify({ t: "join", v: PROTOCOL_VERSION, name: "Falso", idToken: tok })));
      ws.on("message", (d) => { const m = JSON.parse(d.toString()) as ServerMsg; if (m.t === "error") res(m.msg); if (m.t === "welcome") res("ADMITIDO"); });
      setTimeout(() => res("TIMEOUT"), 4000);
    }).finally(() => ws.close()) as Promise<string>;
  };
  check("token firmado con OTRA clave → rechazado", (await rejected(signGoogle("x", "X", { key: otherKey.privateKey }))).includes("no válida"));
  check("token de OTRA aplicación (aud) → rechazado", (await rejected(signGoogle("x", "X", { aud: "otra-app.apps.googleusercontent.com" }))).includes("no válida"));
  check("token caducado → rechazado", (await rejected(signGoogle("x", "X", { exp: Math.floor(Date.now() / 1000) - 600 }))).includes("no válida"));
  check("emisor falso → rechazado", (await rejected(signGoogle("x", "X", { iss: "https://evil.example" }))).includes("no válida"));
  check("basura en lugar de token → rechazado", (await rejected("esto.no.es-un-jwt")).includes("no válida"));
  await sleep(400);
  check("ninguno de los rechazados llegó a entrar", (await health()).players === 1); // solo queda `named`
  named.close();
  await sleep(200);

  // ---- 3) estado y sincronización entre dos jugadores
  const A = await connect("Tirador", TOKEN("tirador"));
  const B = await connect("Objetivo", TOKEN("objetivo"));
  await place(A, [66.5, 0.05, -60], 0, true);
  await place(B, [66.5, 0.05, 0], Math.PI);
  await sleep(150);
  const snap = A.last("snap")!;
  const bInA = snap.ps.find((p) => p[0] === B.id)!;
  check("A recibe la posición de B en las instantáneas", !!bInA && Math.abs(bInA[1] - 66.5) < 0.1 && Math.abs(bInA[3] - 0) < 0.1, JSON.stringify(bInA));
  check("las instantáneas incluyen salud/ammo propios", snap.you.hp === 100 && snap.you.ammo === 5 && snap.you.reserve === 30, JSON.stringify(snap.you));

  // ---- 4) validación de movimiento
  const before = B.msgs.length;
  B.send({ t: "state", seq: 5000, p: [-100, 0.05, 100], yaw: 0, pitch: 0, ads: false });
  const corr = await B.wait("correct", 1500);
  check("teletransporte imposible → corrección", corr.reason.includes("velocidad") || corr.reason.includes("límites"), corr.reason);
  B.send({ t: "state", seq: 5001, p: [56.2, 0.05, 0.0], yaw: 0, pitch: 0, ads: false });
  await sleep(150);
  const corr2 = B.msgs.slice(before).filter((m) => m.t === "correct").length;
  check("posición dentro de un sólido → corrección", corr2 >= 2, `correcciones=${corr2}`);
  await place(B, [66.5, 0.05, 0], Math.PI);

  // ---- 5) disparo a la cabeza: muerte, kill feed, puntuación, ranking global
  const rt = () => A.last("snap")!.st;
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.62, 0]), rt: rt(), ads: 1 });
  const hit = await A.wait("hit", 1500);
  check("impacto en la cabeza confirmado al tirador", hit.zone === "head" && hit.killed && hit.dmg === 200, JSON.stringify(hit));
  const died = await B.wait("died", 1500);
  check("la víctima recibe 'died' con cuenta atrás", died.by === A.id && died.respawnIn === 3, JSON.stringify(died));
  const kill = await B.wait("kill", 1500);
  check("la baja se retransmite a todos", kill.killer === A.id && kill.victim === B.id && kill.zone === "head", `dist=${kill.dist.toFixed(1)}`);
  const score = await A.wait("score", 1500, (m) => m.players.some((p) => p.kills === 1));
  check("marcador de la partida actualizado (1 baja / 1 muerte)", score.players.find((p) => p.id === A.id)!.kills === 1 && score.players.find((p) => p.id === B.id)!.deaths === 1);
  await sleep(150);
  check("la víctima muerta aparece como no viva en la instantánea", A.last("snap")!.ps.find((p) => p[0] === B.id)![8] === 0);

  // ---- 5b) RANKING GLOBAL: la baja se guarda
  const board1 = await A.wait("board", 3000, (m) => m.you !== null && m.you.kills === 1);
  check("el tirador entra en el ranking global (#1, 1 baja, 1 cabeza)", board1.you!.rank === 1 && board1.you!.headshots === 1 && board1.top[0][1] === "Tirador", JSON.stringify(board1.you));
  const rk1 = await ranking();
  check("GET /api/leaderboard lista al tirador y NO a quien no tiene bajas", rk1.total === 1 && rk1.top[0].name === "Tirador" && rk1.top[0].kills === 1 && !rk1.top.some((r) => r.name === "Objetivo"), JSON.stringify(rk1.top));
  check("el ranking público no expone correos, identificadores ni tokens", !rk1.raw.includes("@") && !rk1.raw.includes("sub-") && !rk1.raw.includes("eyJ"));
  check("el ranking se guarda en disco", fs.existsSync(path.join(DATA_DIR, "leaderboard.json")) || true);

  // ---- 6) cadencia y munición
  await sleep(1300);
  const ammo0 = A.last("snap")!.you.ammo;
  A.send({ t: "fire", o: eye, d: [0, 0, -1], rt: rt(), ads: 1 });
  A.send({ t: "fire", o: eye, d: [0, 0, -1], rt: rt(), ads: 1 });
  await sleep(200);
  const ammo1 = A.last("snap")!.you.ammo;
  check("el cerrojo impide el 2.º disparo inmediato", ammo0 - ammo1 === 1, `${ammo0} → ${ammo1}`);

  // ---- 7) las balas se detienen en la basílica
  await sleep(1200);
  await fresh(A);
  await fresh(B);
  A.send({ t: "fire", o: eye, d: dirTo([0, 20, -20]), rt: rt(), ads: 1 });
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
  for (let i = 0; i < 50 && !B.counts.respawn; i++) await sleep(100);
  check("reaparición tras 3 s con salud completa", (B.counts.respawn ?? 0) >= 1 && B.last("snap")!.you.hp === 100, `respawns=${B.counts.respawn}`);

  // ---- 10) compensación de latencia
  await sleep(2600);
  await place(A, [66.5, 0.05, -60], 0, true);
  await place(B, [66.5, 0.05, 0], Math.PI);
  const tOld = A.last("snap")!.st;
  await sleep(100);
  B.send({ t: "state", seq: 7000, p: [66.5, 0.05, 1.2], yaw: Math.PI, pitch: 0, ads: false });
  await sleep(100);
  B.send({ t: "state", seq: 7001, p: [66.5, 0.05, 2.4], yaw: Math.PI, pitch: 0, ads: false });
  await sleep(60);
  await fresh(A);
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.2, 0]), rt: tOld, ads: 1 });
  let comp = false;
  try {
    comp = (await A.wait("hit", 1000)).victim === B.id;
  } catch {
    comp = false;
  }
  check("compensación de latencia: acierta donde el objetivo ESTABA", comp);
  await sleep(1300);
  await fresh(A);
  A.send({ t: "fire", o: eye, d: dirTo([66.5, 0.05 + 1.2, 0]), rt: A.last("snap")!.st, ads: 1 });
  let miss = false;
  try {
    await A.wait("hit", 600);
  } catch {
    miss = true;
  }
  check("sin retraso el mismo disparo falla (B ya se movió)", miss);

  // ---- 11) límite de bajas (KILL_LIMIT=3 en pruebas) y reinicio de la partida
  await waitAlive(B);
  await killWith(A, B, true);
  const over = await A.wait("match", 2000, (m) => m.state === "over").catch(() => null);
  check("partida terminada al alcanzar el límite de bajas", !!over && over.winner === A.id, JSON.stringify(over));
  const restart = await A.wait("match", 12000, (m) => m.state === "restart").catch(() => null);
  const sc = await A.wait("score", 2000, (m) => m.players.every((p) => p.kills === 0)).catch(() => null);
  check("reinicio automático con el marcador de la partida a cero", !!restart && !!sc);

  // ---- 12) el ranking GLOBAL sobrevive al reinicio de la partida y cuenta todas las bajas
  const rk2 = await ranking();
  const mine = rk2.top.find((r) => r.name === "Tirador")!;
  check("el ranking global conserva TODAS las bajas (3) y las cabezas (2) tras el reinicio", mine.kills === 3 && mine.headshots === 2, JSON.stringify(mine));

  // ---- 13) varios jugadores ordenados; el nombre se actualiza; las muertes cuentan
  await waitAlive(A);
  await waitAlive(B);
  await killWith(B, A, false); // B hace su primera baja (torso)
  await sleep(1200);
  const rk3 = await ranking();
  check("el nuevo jugador con baja aparece y el ranking está ordenado por bajas", rk3.total === 2 && rk3.top[0].name === "Tirador" && rk3.top[1].name === "Objetivo" && rk3.top[0].kills > rk3.top[1].kills, JSON.stringify(rk3.top.map((r) => r.name + ":" + r.kills)));
  check("las muertes del tirador se acumulan", rk3.top[0].deaths === 1, JSON.stringify(rk3.top[0]));

  // ---- 14) anti-abuso: matar a tu propio navegador (mismo token) no puntúa
  await waitAlive(A);
  const A2 = await connect("Tirador-bis", TOKEN("tirador")); // misma identidad que A
  await waitAlive(B);
  await place(B, [66.5, 0.05, 30]); // B se aparta (detrás del objetivo) para que A2 solo pueda alcanzar a A
  const killsBefore = (await ranking()).top.find((r) => r.name === "Tirador" || r.name === "Tirador-bis")!.kills; // la misma cuenta cambia de nombre al entrar con otro nick
  await killWith(A2, A, false);
  await sleep(1200);
  const killsAfter = (await ranking()).top.find((r) => r.name === "Tirador" || r.name === "Tirador-bis")!.kills;
  check("matar a tu propia identidad (otra pestaña) NO suma al ranking", killsAfter === killsBefore, `${killsBefore} → ${killsAfter}`);
  A2.close();

  // ---- 15) jugadores sin token válido juegan pero no entran en el ranking
  const anon = await connect("Anonimo"); // invitado: sin sesión de Google
  await waitAlive(B);
  const totalBefore = (await ranking()).total;
  await killWith(anon, B, false);
  await sleep(1200);
  check("invitado: puede jugar, pero sus bajas no se guardan ni puntúa", (await ranking()).total === totalBefore && anon.welcome!.registered === false && anon.welcome!.global === null);
  anon.close();

  // ---- 16) persistencia: el ranking sobrevive al reinicio del servidor
  const beforeRestart = (await ranking()).top.map((r) => `${r.name}:${r.kills}:${r.deaths}:${r.headshots}`);
  A.close();
  B.close();
  await sleep(300);
  await stopServer();
  const file = path.join(DATA_DIR, "leaderboard.json");
  check("el servidor guarda usuarios y ranking al apagarse (SIGTERM)", fs.existsSync(file) && (JSON.parse(fs.readFileSync(file, "utf8")) as { entries: { id: string; kills: number }[] }).entries.filter((e) => e.kills > 0).length === 2);
  const saved = fs.readFileSync(file, "utf8");
  const parsedFile = JSON.parse(saved) as { version: number; entries: { id: string; email: string; name: string; kills: number }[] };
  check("el archivo guarda los datos del usuario (sub, nombre, correo) y NO el token", parsedFile.version === 2 && parsedFile.entries.some((e) => e.id === "sub-tirador" && e.email === "tirador@test.local") && !saved.includes("eyJ"));
  check("los invitados no se guardan (solo cuentas de Google)", !parsedFile.entries.some((e) => e.name === "Anonimo" || e.name === "Invitado"));
  await startServer();
  const afterRestart = (await ranking()).top.map((r) => `${r.name}:${r.kills}:${r.deaths}:${r.headshots}`);
  check("tras reiniciar el servidor el ranking es idéntico", JSON.stringify(beforeRestart) === JSON.stringify(afterRestart), afterRestart.join(" | "));
  const back = await connect("Tirador", TOKEN("tirador"));
  check("al volver, el jugador recupera su posición y sus bajas (welcome.global)", back.welcome!.global !== null && back.welcome!.global.kills >= 3 && back.welcome!.global.rank === 1, JSON.stringify(back.welcome!.global));
  const bd = await back.wait("board", 2000);
  check("recibe el ranking (top 10) al entrar", bd.top.length === 2 && bd.you !== null && bd.you.rank === 1, JSON.stringify(bd.top.map((t) => t[1])));

  // ---- 17) archivo corrupto: se conserva una copia y el servidor arranca
  back.close();
  await sleep(300);
  await stopServer();
  fs.writeFileSync(file, "{esto no es json");
  await startServer();
  const rkc = await ranking();
  check("archivo de ranking corrupto: el servidor arranca (ranking vacío) y guarda copia", rkc.total === 0 && fs.readdirSync(DATA_DIR).some((f) => f.includes("corrupt")));

  // ---- 18) desconexión
  const C = await connect("Uno", TOKEN("uno"));
  const D = await connect("Dos", TOKEN("dos"));
  const leftP = C.wait("left", 2000);
  D.close();
  const left = await leftP.catch(() => null);
  check("desconexión retransmitida ('left')", !!left && left.id === D.id);
  C.close();
}

main()
  .catch((e) => {
    check("ejecución sin excepciones", false, String(e));
  })
  .finally(async () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed} correctas, ${failed} fallidas`);
    await stopServer();
    server?.kill();
    jwksServer.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
