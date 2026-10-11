import "./game/ui/styles.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game") as HTMLCanvasElement;

/** El juego necesita WebGL2 (Chrome/Edge 94+, Firefox 92+, Safari 15+). */
function showFatal(msg: string): void {
  const status = document.getElementById("status");
  const play = document.getElementById("play") as HTMLButtonElement | null;
  if (status) status.textContent = msg;
  if (play) play.textContent = "No compatible";
}
try {
  const probe = document.createElement("canvas");
  if (!probe.getContext("webgl2")) throw new Error("webgl2");
} catch {
  showFatal("Tu navegador o tu equipo no soporta WebGL 2. Prueba con una versión reciente de Chrome, Edge, Firefox o Safari y activa la aceleración por hardware.");
  throw new Error("WebGL2 no disponible");
}
const game = new Game(canvas);
game.init().catch((err) => {
  console.error("[Barcelona FPS] Error al iniciar el juego:", err);
  const status = document.getElementById("status");
  if (status) status.textContent = "Error al iniciar: " + (err instanceof Error ? err.message : String(err));
});
