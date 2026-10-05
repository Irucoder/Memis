# Memis · Tablero de detectives

Sitio para un juego de detectives: pantalla de ingreso con contraseña, cuenta regresiva hasta la apertura y un tablero de evidencias donde van apareciendo los documentos que cargues desde el panel de administración.

## Publicarlo en Netlify (gratis)

1. Entrá a https://app.netlify.com y creá una cuenta (podés usar tu cuenta de GitHub).
2. **Add new site → Import an existing project → GitHub** y elegí el repositorio **Memis**.
3. En **Branch to deploy** elegí la rama donde está este código. Netlify toma el resto de la configuración de `netlify.toml`: no hace falta completar *build command* ni *publish directory*.
4. Antes de publicar (o después, en **Site configuration → Environment variables**) agregá:
   - `ADMIN_PASSWORD` → tu contraseña de administración (si no la ponés, queda `ADMIN-MEMIS`).
   - `SESSION_SECRET` → cualquier texto largo y aleatorio (opcional, recomendado).
5. **Deploy**. Netlify te da una dirección tipo `https://nombre.netlify.app` (la podés cambiar en *Site configuration → Change site name*).

Si cambiás variables de entorno después, hacé **Deploys → Trigger deploy** para que se apliquen.

Los documentos y la configuración se guardan en **Netlify Blobs**, el almacenamiento propio de Netlify: no se borran al volver a publicar y no hay que configurar nada.

**Límite:** cada archivo puede pesar hasta unos **5,8 MB** (límite de Netlify). Las fotos más pesadas se achican solas al subirlas; los PDF grandes hay que comprimirlos antes (por ejemplo con ilovepdf.com).

## Cómo se ve

- **Portada** (`public/fondo.webp`): la carpeta del Club de Memis; la clave se escribe en la etiqueta blanca vacía y se confirma con Enter.
- **Tablero** (`public/marco.webp` + `public/corcho-centro.webp`): un corcho con marco bajo la lámpara, con las pistas clavadas con chinches. Ocupa todo el ancho y entra completo en la pantalla; el marco se arma con los bordes de la foto para que no se deforme al estirarse.
- **Hilo rojo**: a la derecha hay un carretel. Tocándolo, cada jugador puede unir dos pistas con hilo (tocar una y después la otra). Tocar un hilo permite cortarlo. Los hilos se guardan en el servidor, los ven todos los jugadores y no se borran al cargar nueva evidencia. Desde el panel admin se ve cuántos hay y se pueden borrar todos.

- **Acomodar**: cualquiera puede arrastrar las pistas reveladas a otro lugar del corcho; la posición se guarda para todos. El admin, con el botón *Acomodar*, además puede rotarlas y cambiarles el tamaño (rueda del mouse / Shift + rueda).
- **PDF**: se ve la primera página en el corcho; si tiene más páginas, al pasar el mouse asoman las hojas de abajo. Al abrirlo se muestran todas las páginas como hojas, sin la barra del visor del navegador (usa pdf.js, incluido en `public/vendor/pdfjs`).

- **Post-its**: debajo del carretel hay un bloc. Tocándolo aparece un post-it en el corcho para escribir una palabra o frase corta (hasta 80 caracteres). Se pueden mover, editar (click), despegar (×) y atar con hilo rojo. Se guardan para todos.
- **Límites**: ninguna pista ni post-it se puede ubicar fuera del corcho.

Para cambiar las imágenes, reemplazá esos archivos manteniendo el nombre (si cambia la proporción de la portada, hay que reajustar la posición de la casilla en `public/index.html`).

## Contraseñas

| Contraseña     | Qué hace                                                                  |
|----------------|---------------------------------------------------------------------------|
| `ANA`          | Jugador: ve la cuenta regresiva hasta la apertura y después el tablero.  |
| `POPIS`        | Vista previa: saltea la cuenta regresiva y ve el tablero como un jugador. |
| `ADMIN-MEMIS`  | Panel de administración (cambiala con `ADMIN_PASSWORD`).                  |

No distinguen mayúsculas/minúsculas. Se pueden cambiar con variables de entorno:
`PLAYER_PASSWORD`, `PREVIEW_PASSWORD`, `ADMIN_PASSWORD`.

## Panel de administración (`/admin`)

- **Apertura del sitio**: elegís fecha y hora; hasta entonces los jugadores ven la cuenta regresiva (horas : minutos : segundos) y el texto "Se podrá tener acceso a esta página el … a las … hs". Sin fecha, el sitio queda cerrado.
- **Documentos por venir**: interruptor general para mostrar u ocultar la silueta con `?` de los documentos programados. Cada documento puede sobrescribirlo.
- **Cargar documento**: imágenes, PDF o texto escrito. Se publican al instante o en una fecha/hora programada. Estilos: hoja de papel, polaroid, foto con chinche, recorte de diario o nota adhesiva.
- **Acomodar el tablero**: desde "Ver / acomodar tablero" → botón *Acomodar*: arrastrás los documentos, la rueda del mouse los rota y Shift + rueda cambia el tamaño. Se guarda solo.

Los archivos de documentos no publicados nunca se envían a los jugadores: el servidor solo manda la silueta (si corresponde) hasta la hora programada.

## Probarlo en tu computadora

Requiere Node.js 20 o superior.

```bash
npm install
npm start            # http://localhost:3000
```

En local los datos se guardan en la carpeta `data/`.

## Estructura

- `public/` — páginas, estilos y scripts del navegador.
- `lib/core.js` — reglas del juego (contraseñas, horarios, visibilidad de documentos).
- `netlify/functions/api.mjs` — función de Netlify que usa `lib/core.js` con Netlify Blobs.
- `server.js` — servidor local que usa `lib/core.js` con la carpeta `data/`.
