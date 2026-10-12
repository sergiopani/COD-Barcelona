# Inicio de sesión con Google, usuarios guardados y bonus de salto

## Cómo funciona
- **Solo multijugador**, una única sala global (hasta `MAX_PLAYERS`, 32 por defecto).
- Al abrir el juego hay dos formas de entrar:
  1. **Iniciar sesión con Google** → usuario **guardado**: entra con su nombre de Google, sus bajas cuentan en el **ranking global** y gana **salto**.
  2. **Invitado con nickname** → no se guarda nada, no puntúa y no tiene bonus.
- **Qué se guarda de un usuario de Google** (`DATA_DIR/leaderboard.json`, escritura atómica): `sub` (identificador de la cuenta), nombre, correo, URL de la foto de perfil, fechas de primer/último acceso, nº de accesos y sus bajas, muertes y cabezas. **El correo y la foto nunca salen del servidor** (el ranking público `/api/leaderboard` solo muestra nombre y cifras). El token de Google no se guarda.
- **Ranking global de bajas**: lista a los usuarios guardados con al menos una baja. Matar a tu propia cuenta (dos pestañas) no cuenta.
- **Bonus de salto**: cada baja de un usuario guardado suma `JUMP_BONUS_PER_KILL = 0,0001` (**0,01 %**) a su **altura de salto** (`shared/protocol.ts`). Se calcula a partir de las bajas guardadas por el servidor (se envían en `welcome` y `board`) y se aplica en `PlayerController.jumpMultiplier`; el HUD muestra «Global: N bajas · puesto #P · salto +x,xx %».
  Con 0,01 % por baja, 100 bajas son +1 % de altura (≈ +0,8 cm sobre el salto de 0,77 m): **es prácticamente imperceptible**; si quieres que se note, sube la constante (p. ej. `0.005` = 0,5 % por baja).
  Limitación: el movimiento lo calcula el cliente (el servidor solo valida velocidad, límites y sólidos), así que un cliente modificado podría saltar más; el servidor limita la altura máxima a 5 m.

## Verificación de seguridad en el servidor
El cliente manda el **ID token** de Google en el mensaje `join`. `server/src/GoogleAuth.ts` lo verifica sin confiar en el cliente: firma RS256 con las claves públicas de Google (JWKS en caché, rotación), emisor, `aud` = tu ID de cliente, caducidad y `sub`. Un token falso, de otra aplicación o caducado se rechaza ("Sesión de Google no válida"). Las pruebas (`npm run test:server`) lo comprueban con un servidor JWKS local y claves propias.

## Configuración (lo que tienes que hacer tú)
1. En <https://console.cloud.google.com/> crea un proyecto → **APIs y servicios → Pantalla de consentimiento de OAuth** (tipo externo, rellena nombre y correo de soporte) → **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
2. **Orígenes de JavaScript autorizados**: `http://localhost:5173` y `http://localhost:8080` para desarrollo, y `https://tu-dominio` en producción. **Google no admite orígenes `http://` públicos (solo localhost): en producción necesitas un dominio con HTTPS** (ver `docs/DESPLIEGUE.md`).
3. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`; no es secreto) y arranca el servidor con él:
   ```bash
   GOOGLE_CLIENT_ID=123456-abc.apps.googleusercontent.com npm run server
   ```
   El cliente lo recibe de `GET /api/config`, así que no hay que recompilar. Sin `GOOGLE_CLIENT_ID` el botón no aparece y solo se puede entrar como invitado.

## Privacidad (RGPD)
Guardas datos personales (nombre, correo, foto) de usuarios, probablemente de la UE: el menú ya avisa de qué se guarda, pero necesitas además una política de privacidad, una base legal (consentimiento al iniciar sesión) y una forma de borrar los datos si alguien lo pide (hoy: editar `leaderboard.json` en el servidor; no hay botón de «borrar mi cuenta»). Esto no es asesoramiento legal.

## Pruebas realizadas
- Servidor: 50 pruebas de integración (incluye token con otra clave, otra `aud`, caducado, emisor falso y basura; invitados no guardados; usuario guardado con correo en el archivo y sin token; persistencia tras reiniciar).
- Navegador: menú sin selector de modo, botón de Google renderizado, invitado (sin nickname no entra), usuario de Google de prueba (sesión verificada por el servidor), una baja → puesto #1, bonus de salto 1,0001 y línea del HUD.
- **No probado**: el inicio de sesión con una cuenta de Google REAL (necesita tu ID de cliente y orígenes autorizados).
