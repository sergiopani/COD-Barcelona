# Combate (Fase 2): francotirador

Modo individual con **un único arma: el francotirador M1A** (modelo `public/assets/weapons/m1a-springfield.glb`).
Las partidas son solo con francotirador; el sistema está montado sobre `WeaponDefinition`, así que añadir armas después no exige reescribirlo.

## Controles

| Entrada | Acción |
| --- | --- |
| Clic izquierdo | Disparar (cerrojo: 1,15 s entre disparos) |
| Clic derecho (mantener) | **Apuntar** por la mira telescópica (zoom 4×) |
| Rueda del ratón (apuntando) | Cambiar zoom 4× ↔ 8× |
| Shift (apuntando) | Aguantar la respiración (reduce la oscilación; se agota en ~3,5 s) |
| R | Recargar (2,6 s) |
| W A S D / Espacio / Shift | Moverse / saltar / correr |
| Esc | Pausa (el juego se congela) |

## Reglas

- Cargador de **5** balas + **30** de reserva.
- Daño: **cabeza 200**, **torso 100**, **piernas 60**. Bots y jugador tienen **100 PS** (los bots mueren de un tiro a cabeza o torso).
- Hitscan sin caída de bala. Dispersión: ~2,6° a cadera (no se puede acertar de lejos sin apuntar), ~0,05° apuntando y quieto; aumenta al moverte
  y justo tras un disparo. La mira oscila de forma natural (más con 8× y en movimiento).
- Al apuntar: FOV 90° → 28° (4×) / 14° (8×), sensibilidad del ratón escalada con el zoom, velocidad al 45 %, sin correr, arma oculta y mira dibujada en pantalla.
- Retroceso de cámara con recuperación parcial; el arma tiene animaciones procedurales (respiración, paso, carrera, retroceso, cerrojo, recarga).
- Salud 100 PS, regeneración lenta (5 PS/s tras 8 s sin recibir daño). Al morir: cámara al suelo y reaparición a los 3 s lejos de los bots, con salud y munición completas.
- Marcador: bajas, muertes, % de precisión y cabezas. Marcadores de impacto (cabeza/baja en rojo) y registro de bajas.

## Bots-objetivo (6)

Maniquíes con chaleco naranja que **patrullan por las aceras**, te detectan por visión (línea de visión comprobada con rayos, cono de ~140°, hasta 130 m)
y por el sonido de tus disparos, **apuntan** (0,5–1,6 s) y disparan (probabilidad de acierto decreciente con la distancia y con tu velocidad; 25 de daño).
Un indicador rojo muestra de qué dirección te dispararon. Reaparecen 6 s después de caer. Son la base para el multijugador (Fase 3): ahí los
impactos y la salud los decidirá el servidor.

## Cómo está construido

```
src/game/weapons/   WeaponDefinition (datos) · WeaponController (munición, cerrojo, ADS, sway, disparo) · Viewmodel (GLB + animación)
                    Ballistics (rayos analíticos contra cajas de colisión, suelo, proxy de la basílica y actores) · Effects (trazadoras, impactos, agujeros, fogonazo)
src/game/combat/    CombatSystem (salud, muerte/reaparición, marcador) · Bot · BotManager
src/game/audio/     AudioManager (todo sintetizado con WebAudio, con eco de calle; sin archivos de sonido)
src/game/ui/        Hud (munición, salud, mira telescópica, impactos, daño, muerte)
```

- El balazo NO usa el picking de Babylon: los colliders son invisibles. Se hace un trazado de rayo propio (OBB/cilindro/esfera), así que el coste es mínimo.
  La verja de la basílica no detiene balas; la basílica sí (mediante su proxy de columnas).
- El arma se dibuja en un grupo de renderizado aparte con el depth limpio: nunca atraviesa paredes. El modelo tiene 274 mil triángulos (44 MB, excluido de git).
- Sonido: disparo, cerrojo, recarga, impacto, hit-marker, daño, muerte; los disparos de los bots llegan con retardo y filtrado según la distancia.

## Pruebas automáticas (consola del navegador)

```js
__game.combatTest()   // 14 pruebas: impacto en cabeza/torso/piernas, cadencia, recarga, ADS/zoom/sensibilidad, agujeros de bala, daño, muerte y reaparición
__game.selfTest()     // 19 pruebas de movimiento y colisiones (tarda ~30–60 s con todo el mobiliario)
```

## Limitaciones

- El audio y el bloqueo del ratón real **no se han probado en un navegador con sonido/Pointer Lock** (el panel integrado no los permite): las pruebas
  simulan los eventos de ratón y teclado y avanzan los fotogramas a mano.
- Los bots no esquivan ni usan cobertura; se atascan en obstáculos raros y entonces eligen otro destino. No hay animación de muerte compleja (caen de espaldas).
- El modelo del rifle es un M1A con mira; es el que aportó el usuario, y la «mira» dibujada en pantalla es una superposición, no el visor del modelo.
- Un único jugador local; la validación autoritativa en servidor llega con el multijugador.
