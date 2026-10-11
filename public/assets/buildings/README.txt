SAGRADA FAMÍLIA — modelo 3D
===========================

Coloca aquí tu modelo con el nombre exacto:

    sagrada-familia.glb

Si el archivo no existe (o no es un GLB válido) el juego muestra un error claro en la consola
del navegador y usa una basílica provisional procedural.

Ajustes (sin recompilar, basta recargar la página): sagrada-familia.config.json

  position       [x, y, z] donde se coloca el modelo. Con centerXZ=true es el centro de su huella
                 en planta; la manzana de la basílica está centrada en el origen (0, 0).
  rotationYDeg   giro alrededor del eje vertical, en grados. Convención del mapa (provisional,
                 comprobar con tu modelo): fachada del Nacimiento al ESTE (+X, calle Marina),
                 fachada de la Pasión al OESTE (-X, calle Sardenya), fachada de la Gloria al SUR
                 (-Z, calle Mallorca), ábside al NORTE (+Z, calle Provença).
  scale          factor de escala (1 = tamaño original del GLB, que se asume en metros).
  targetHeight   si no es null, ignora scale y escala el modelo a esa altura en metros
                 (la torre de Jesucristo mide unos 172 m).
  centerXZ       centra la huella del modelo en `position`.
  alignToGround  apoya el punto más bajo del modelo en position[1] (evita flotar o quedar enterrado).
  castShadows    el modelo proyecta sombras sobre la calle (cuesta rendimiento si es complejo).
  colliders      cajas de colisión simples en planta: { cx, cz, sx, sz, h, rotYDeg }.
                 La geometría del GLB NUNCA se usa como colisión. La manzana ya está cerrada por
                 una verja con colisión, así que normalmente no hacen falta.

Rendimiento: al cargar, la consola indica mallas, triángulos y tamaño en metros. Por encima de
~1,5 M de triángulos conviene simplificar el modelo o comprimirlo (Draco / meshopt).
