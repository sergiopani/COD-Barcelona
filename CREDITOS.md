# Créditos de datos y modelos

- **Basílica de la Sagrada Família (modelo activo):** modelo `sagrada familia.glb` aportado por el usuario (autor y licencia no documentados aquí; verificar antes de publicar).
- **Basílica, alternativa no activa (fotogrametría):** fotogrametría 3D © **ICGC – Institut Cartogràfic i Geològic de Catalunya**, obtenida de
  <https://betaserver.icgc.cat/cesium/SagradaFamilia3D.html> (teselas `n_bcn_tot/*.gltf`, estado de la obra en 2015). Esa página no indica la licencia:
  los datos abiertos del ICGC suelen publicarse con CC BY 4.0, pero **no está confirmado para este servidor de pruebas**; comprobar los términos antes de publicar el juego.
  Se modifican (giro, recorte, brillo/gamma de texturas) con `scripts/icgc-to-glb.mjs`.
- **Maqueta alternativa de la basílica (no activa):** «Sagrada Familia – Barcelona, Spain» de **MiniWorld3D** (Printables), modelo original de Dany Sánchez y Brian Mauricio Sánchez.
  El PDF recibido pide dar crédito; no indica la licencia (verificar uso en juegos). Conversión: `scripts/stl-to-glb.mjs`; copia del GLB en `assets-src/buildings/`.
- Palmera, rifle M1A y pack de coches: modelos aportados por el usuario (origen y licencia no documentados aquí).
- **Fachada de la Casa Batlló (4 casas del Eixample):** modelo `casa_batllo_-_antoni_gaudi_-_barcelona.glb` aportado por el usuario (el material se llama «tripo_material…», lo que sugiere un modelo generado con IA; autor y licencia desconocidos, verificar antes de publicar). Se hornea a una elevación frontal + mapa de relieve con `scripts/bake-batllo.mjs`.
- **Panorama 360° de Barcelona/Sagrada Família (menú y cielo):** modelo/escena `barcelona sagrada familia.glb` (esfera con foto de dron, procedente de Sketchfab) aportado por el usuario; autor y licencia desconocidos, verificar antes de publicar.
- **Buzón de Correos (8 repartidos por las aceras):** escaneo fotogramétrico `correos_letterbox_barcelona_catalunya.glb` aportado por el usuario (Sketchfab); autor y licencia desconocidos, verificar antes de publicar. Se hornea a un atlas de color con `scripts/bake-letterbox.mjs` (el escaneo incluye un trozo de acera real, no utilizado).
- **Helicóptero de policía:** `police_helicopter_1_unity3d.glb` aportado por el usuario (Sketchfab); autor y licencia desconocidos, verificar antes de publicar.
- **Texturas y HDRI fotográficos (Poly Haven, licencia CC0 — dominio público, <https://polyhaven.com>):** `asphalt_02` (calzada), `concrete_pavement_03` (aceras), `beige_wall_001` (estuco de fachada) y el HDRI `circus_maximus_2` (iluminación y reflejos del cielo). No exigen atribución; se citan por cortesía. Se procesan con `scripts/prepare-polyhaven.mjs` (el HDRI se recorta para quitarle el disco solar).

## Decorado de la ciudad
`barcelona_espana.glb` (fotogrametría de Barcelona aportada por el usuario). Su origen y licencia no constan; el aspecto es el de una captura tipo Google Earth, cuyos
términos suelen prohibir reutilizarla. **Verifica la licencia antes de publicar el juego**; por eso el GLB procesado no se sube a git (se regenera con `npm run build:city`).

## Texturas del parque
Césped, adoquín del camino y madera de los bancos: extraídos del modelo `park.glb` aportado por el usuario (origen y licencia desconocidos; verificar antes de publicar). Salen de `assets-src/park/park.glb`
con `npm run prepare:park-textures` hacia `public/assets/park/` (fuera de git).
