// Arranca cliente (Vite) y servidor de juego (tsx watch) juntos, con la salida prefijada. Ctrl+C detiene ambos.
import { spawn } from "node:child_process";

const procs = [
  ["cliente", "npx", ["vite"], "\x1b[36m"],
  ["servidor", "npx", ["tsx", "watch", "server/src/index.ts"], "\x1b[33m"],
].map(([name, cmd, args, color]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  const out = (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(`${color}[${name}]\x1b[0m ${l}`));
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  return p;
});
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", stop));
