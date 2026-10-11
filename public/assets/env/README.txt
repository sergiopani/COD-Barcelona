ENTORNO HDR (Image-Based Lighting) — OPCIONAL
=============================================

Actualmente NO hay ningún archivo HDR en este proyecto. Sin él, el juego genera un entorno procedural
(cielo con nubes + "cañón urbano") y lo prefiltra al arrancar (consola: "[Entorno] IBL: procedural-prefiltrado").

Para usar un HDR real de una plaza/calle diurna con cielo despejado, coloca UNO de estos archivos aquí:

  environment.env   Entorno prefiltrado de Babylon.js (recomendado: carga rápida, ~1-3 MB).
                    Se genera con la herramienta "IBL Tools" de Babylon (https://www.babylonjs.com/tools/ibl/)
                    a partir de un .hdr.
  environment.hdr   Panorama equirectangular HDR de Radiance (p. ej. 2K×1K). Se convierte a cubemap
                    al cargar (más lento que .env).

Fuentes gratuitas habituales con licencia CC0: Poly Haven (polyhaven.com/hdris). Elige una escena exterior
con sol claro; el sol del HDR debería coincidir con la dirección de la luz del juego (SUN_DIRECTION en
src/game/world/Lighting.ts: sol desde el sureste y a unos 40° de altura) o las sombras no concordarán con los reflejos.

Notas:
- El archivo se detecta por su cabecera binaria (no por el estado HTTP), igual que el GLB de la basílica.
- Con un entorno externo el cielo visible sigue siendo el procedural (el HDR solo ilumina y refleja).
- Ajusta la intensidad con `scene.environmentIntensity` (Lighting.ts, parámetro de createEnvironment).
