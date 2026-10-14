# Guion de vídeo — «Hice un juego de Barcelona con Claude» (Sergio Pani)

Duración estimada: 9–11 minutos hablando tranquilo (~1 600 palabras).
Texto normal = lo que dices. **[PANTALLA]** = lo que enseñas. **⚠** = dato que debes confirmar tú antes de grabar.

Títulos posibles:
- «Creé un shooter online de la Sagrada Família con IA (y puedes jugarlo)»
- «Le pedí a Claude un juego de Barcelona… y esto salió»

---

## 0. GANCHO (0:00 – 0:30)

**[PANTALLA]** Montaje rápido: disparo con la mira, salto alto, el ranking, el helicóptero pasando sobre la Sagrada Família.

> ¿Y si te digo que existe un juego online, ambientado en la Sagrada Família, donde cada vez que matas a alguien… saltas un poquito más alto?
>
> Pues sí, existe. Lo he hecho con Claude, la inteligencia artificial de Anthropic. Y en este vídeo te enseño el juego… y cómo se hizo por dentro.
>
> Soy Sergio Pani. Vamos.

---

## PARTE 1 · PRESENTO EL JUEGO (0:30 – 3:30)

### 1.1 Qué es (0:30 – 1:10)

**[PANTALLA]** Pantalla del menú con los cuatro personajes.

> Es un shooter en primera persona que se juega directamente en el navegador. No instalas nada: abres la página, eliges personaje y ya estás dentro.
>
> Es **online**: lo tengo subido a un servidor, así que puedes jugar con otra gente de verdad.

### 1.2 Una sala, todos juntos (1:10 – 1:40)

**[PANTALLA]** Varias pestañas/jugadores moviéndose por el mapa.

> Aquí no hay salas ni listas de partidas. Hay **una sola sala grande**, para todos. Entras y ya estás con el resto, hasta 32 jugadores a la vez.
>
> Puedes entrar como invitado, con un nombre, o iniciar sesión con Google. Si entras con Google, el juego te recuerda.

### 1.3 Los personajes (1:40 – 2:10)

**[PANTALLA]** Selector de personajes, uno a uno.

> Y puedes elegir entre cuatro personajes: **Segarro**, **la Charo**, **Perro Flauta** y **el Facha**. Es una parodia, así que cada uno tiene su estilo, su ropa y su rollo.

### 1.4 El ranking y el salto (2:10 – 3:00)

**[PANTALLA]** Ranking global; luego un salto antes y otro con muchas kills.

> Hay un **ranking global de kills**. El que más muertes hace, arriba. Se guarda, así que si te logueas con Google tu nombre se queda ahí.
>
> Y la mecánica rara, mi favorita: **cada vez que haces una kill, aumenta tu salto**. Un 0,01 % por baja. Sí, es poquísimo… pero se acumula. Cuantas más kills, más alto saltas. Con mil kills, un 10 % más. Hay que ser muy pro.

### 1.5 El mapa (3:00 – 3:30)

**[PANTALLA]** Recorrido por las calles, palmeras, coches, helicóptero, parque con estanque.

> El mapa es la manzana de la Sagrada Família, en el Eixample: calles con coches y palmeras, buzones de Correos, edificios con la fachada de la Casa Batlló, un helicóptero de policía dando vueltas… y un parque con estanque al lado. Y al fondo, la ciudad de Barcelona de verdad.

---

## PARTE 2 · CÓMO LO HICE (3:30 – 10:00)

### 2.1 La idea (3:30 – 4:10)

**[PANTALLA]** Tú a cámara, o la primera conversación con Claude.

> Todo empezó con una idea muy simple: **hacer un juego de Barcelona con Claude** y ver qué tal me salía.
>
> No sabía si iba a funcionar. Le fui pidiendo cosas poco a poco: primero el mapa, luego el disparo, luego el multijugador… y él iba escribiendo el código.

*(⚠ Ajusta esto a cuánto código escribiste tú de verdad.)*

### 2.2 Buscar los modelos (4:10 – 6:00)

**[PANTALLA]** Capturas de los modelos en bruto: Sagrada Família, Casa Batlló, palmera, coche, fusil, helicóptero.

> Un juego sin modelos 3D es un cuadrado gris. Así que me puse a buscar.
>
> Lo primero, la **Sagrada Família**. Probé varias: una fotogrametría del ICGC, el instituto cartográfico de Cataluña; una maqueta para impresión 3D; hasta intenté hacer una a mano con las medidas reales. Al final me quedé con un modelo que encontré, bastante detallado.
>
> Problema: pesaba una barbaridad, casi un millón de triángulos. Lo tuvimos que **optimizar**: de unos 108 megas entre todos los modelos a unos 21.
>
> Luego la **Casa Batlló**. Era un modelo muy pesado, así que lo convertimos en una fachada que se repite en cuatro casas del mapa. Y para el resto: una palmera, coches, el fusil, un helicóptero de policía, y un **buzón de Correos** que es un escaneo de uno real.
>
> Para el cielo usé una **foto de dron** de Barcelona, y para la luz y el asfalto, texturas gratuitas de Poly Haven. Hasta pasé por el modelo de toda la ciudad para ponerla de fondo.

*(⚠ Los créditos y licencias, en la descripción. Varios modelos son de internet y no sé su licencia: revisa antes de monetizar.)*

### 2.3 Las tecnologías (6:00 – 8:00)

**[PANTALLA]** Logos: TypeScript, Babylon.js, Vite, Node.js. Código en pantalla.

> Ahora la parte técnica, rápido y sin liarla:
>
> - **TypeScript**, que es JavaScript con tipos. Todo el juego está escrito así.
> - **Babylon.js**, un motor 3D para navegador. Se encarga de los gráficos, la luz, las sombras y los materiales.
> - **Vite**, que prepara el proyecto para que cargue rápido.
> - Y **Node.js**, que es el servidor.
>
> El multijugador va por **WebSockets**. Y aquí hay un detalle importante: el servidor **manda**. Si disparas, tu navegador no decide si has dado; lo decide el servidor, para que nadie pueda hacer trampas. Manda unas 20 actualizaciones por segundo y compensa el lag, para que disparar se sienta justo.
>
> El login con Google y el ranking los guarda el propio servidor.
>
> Y como el código lo escribe una IA, hicimos **pruebas automáticas**: decenas de comprobaciones del servidor, de movimiento y de combate, para asegurarnos de que no se rompe nada cada vez que cambiamos algo.

### 2.4 Anécdotas / lo que salió mal (8:00 – 9:00)

**[PANTALLA]** Error de «Reintentar», el visor con el mosaico.

> No todo salió a la primera.
>
> Un día le daba a **Jugar** y solo me salía el botón de **Reintentar**. Resulta que una de las pruebas automáticas, al terminar… **mataba también mi servidor de desarrollo**. Es decir, el test se cargaba el juego.
>
> Otra vez le pasé un modelo de toda Barcelona y al procesarlo se veía como un **mosaico** raro. Pensé que el modelo estaba roto, y resulta que fallaba **mi herramienta para verlo**.
>
> Y una cosa que quiero decir claro: los gráficos **no son hiperrealistas**. Los modelos de ciudad que salen de fotogrametría aérea, de cerca, se ven borrosos. Por eso la ciudad real sirve de fondo, y la manzana jugable es la que está hecha con más cariño.

*(⚠ Cambia o quita anécdotas según lo que quieras contar.)*

### 2.5 El servidor (9:00 – 9:40)

**[PANTALLA]** Panel del servidor / terminal con el despliegue.

> Para que todo el mundo pueda jugar, el juego tiene que estar en un servidor. Es **un solo programa** que sirve la página y también el multijugador, todo junto.
>
> Lo tengo en **[⚠ AWS / Hostinger KVM2 — pon el que sea]**, una máquina pequeña de 2 núcleos y 2 gigas de memoria. Con eso aguanta bien porque el servidor es ligero.
>
> De momento funciona por **HTTP**, sin dominio propio. Lo siguiente sería ponerle un dominio y HTTPS.

*(⚠ En mis notas consta AWS EC2 en Estocolmo, con el puerto 80. Si al final lo montaste en Hostinger, cámbialo. Y si no está subido, di «pronto lo subo».)*

### 2.6 Lo siguiente (9:40 – 10:00)

> Lo que quiero añadir: **personajes animados**, más mapa —como el otro parque junto a la Sagrada Família—, más armas, y un dominio con HTTPS.

---

## CIERRE (10:00 – 10:30)

**[PANTALLA]** Tú a cámara, y el enlace en pantalla.

> Si quieres probarlo, el enlace está **en la descripción** *(⚠ pon la URL)*. Entra, elige a tu personaje y a ver quién llega al primer puesto del ranking.
>
> Dime en los comentarios **qué personaje elegirías** y qué te gustaría que añadiera. Si te ha gustado, suscríbete al canal, que esto es solo el principio.
>
> Soy Sergio Pani. Nos vemos en el próximo.

---

## Extras (por si te sobra tiempo)

- **Prueba en directo:** entra con un amigo y grabad una persecución; sirve de B-roll para toda la parte 1.
- **Contador de salto:** una gráfica del salto subiendo con las kills (corte rápido de humor).
- **Comparativa de gráficos:** capturas del primer prototipo (cajas grises) frente al mapa final; el contraste vende solo.
- **Descripción del vídeo:** enlace al juego, créditos de modelos (ICGC, Poly Haven, Sketchfab) y las tecnologías.
- **Miniatura:** la Sagrada Família con el fusil en primer plano y texto «JUEGO ONLINE» o «+ KILLS = + SALTO».
