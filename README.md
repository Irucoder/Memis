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
