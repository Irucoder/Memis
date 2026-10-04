# Memis · Tablero de detectives

Sitio para un juego de detectives: pantalla de ingreso con contraseña, cuenta regresiva hasta la apertura y un tablero de evidencias donde van apareciendo los documentos que cargues desde el panel de administración.

## Cómo correrlo

Requiere Node.js 18 o superior. No tiene dependencias externas.

```bash
npm start            # http://localhost:3000
```

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

## Publicarlo

Necesita un hosting que corra Node y tenga disco persistente (Render, Railway, Fly.io, un VPS…). GitHub Pages no sirve porque hace falta el servidor. Los datos se guardan en `data/` (o en la carpeta de `DATA_DIR`): asegurate de que esa carpeta sea persistente.

Variables útiles: `PORT`, `DATA_DIR`, `MAX_UPLOAD_MB` (25 por defecto), `SESSION_SECRET`.
