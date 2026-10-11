import "./game/ui/styles.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = new Game(canvas);
game.init().catch((err) => {
  console.error("[Barcelona FPS] Error al iniciar el juego:", err);
  const status = document.getElementById("status");
  if (status) status.textContent = "Error al iniciar: " + (err instanceof Error ? err.message : String(err));
});
