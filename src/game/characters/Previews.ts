import { Color3, Color4, CreateScreenshotUsingRenderTargetAsync, DirectionalLight, FreeCamera, HemisphericLight, Scene, TransformNode, Vector3, type AbstractEngine } from "@babylonjs/core";
import { SKIN_COUNT } from "../../../shared/protocol";
import { buildCharacter } from "./Character";

/**
 * Miniaturas 3D de los personajes para el selector del menú: se renderiza cada personaje (el mismo modelo del juego) en una escena
 * aparte con su propia luz y se captura como imagen. Devuelve una URL de datos por personaje (o una lista vacía si falla).
 */
export async function renderCharacterPreviews(engine: AbstractEngine, width = 160, height = 260): Promise<string[]> {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.09, 0.11, 0.16, 1);
  try {
    new HemisphericLight("pvAmb", new Vector3(0, 1, 0.4), scene).intensity = 0.95;
    const sun = new DirectionalLight("pvSun", new Vector3(-0.5, -0.8, -0.7), scene);
    sun.intensity = 1.6;
    sun.diffuse = new Color3(1, 0.96, 0.88);
    const cam = new FreeCamera("pvCam", new Vector3(0.5, 1.12, 3.5), scene);
    cam.setTarget(new Vector3(0, 0.93, 0));
    cam.fov = 0.52;
    cam.minZ = 0.05;
    const out: string[] = [];
    for (let i = 0; i < SKIN_COUNT; i++) {
      const root = new TransformNode(`pv${i}`, scene);
      root.rotation.y = -0.35; // ligero giro para que se vea el volumen
      const parts = buildCharacter(scene, 800 + i, root, i);
      parts.rifle.setEnabled(false); // en el selector sin arma
      await scene.whenReadyAsync();
      out.push(await CreateScreenshotUsingRenderTargetAsync(engine, cam, { width, height }, "image/png", 4, true));
      root.dispose(false, true);
    }
    return out;
  } catch (e) {
    console.warn("[Menú] No se pudieron generar las miniaturas de personajes:", e);
    return [];
  } finally {
    scene.dispose();
  }
}
