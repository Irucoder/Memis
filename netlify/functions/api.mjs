// Función de Netlify: atiende /api/* y /files/*. Los datos y archivos se
// guardan en Netlify Blobs (no hace falta configurar nada).

import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/core.js';

let handler = null;

function getHandler() {
  if (handler) return handler;
  const store = getStore({ name: 'memis', consistency: 'strong' });

  // Escritura condicional: si dos personas cambian a la vez (mover pistas,
  // escribir post-its), se reintenta sobre lo último guardado y nadie pisa a nadie.
  async function updateJSON(key, fn) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await store.getWithMetadata(key, { type: 'json' });
      const next = fn((current && current.data) || {});
      const opts = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
      const { modified } = await store.setJSON(key, next, opts);
      if (modified) return next;
    }
    throw new Error('No se pudo guardar el cambio');
  }
  handler = createHandler(
    {
      readDb: () => store.get('db', { type: 'json' }),
      writeDb: (db) => store.setJSON('db', db),
      readSecret: () => store.get('secret', { type: 'text' }),
      writeSecret: (s) => store.set('secret', s, { onlyIfNew: true }), // la primera gana
      putFile: (name, bytes, mime) => store.set('files/' + name, bytes, { metadata: { mime } }),
      async getFile(name) {
        const r = await store.getWithMetadata('files/' + name, { type: 'stream' });
        return r && { body: r.data, mime: r.metadata && r.metadata.mime };
      },
      deleteFile: (name) => store.delete('files/' + name),
      async readThreads() {
        const { blobs } = await store.list({ prefix: 'threads/' });
        return blobs.map((b) => {
          const id = b.key.slice('threads/'.length);
          const [from, to] = id.split('_');
          return { id, from, to };
        });
      },
      addThread: (id) => store.set('threads/' + id, '1'),
      deleteThread: (id) => store.delete('threads/' + id),
      readLayouts: async () => (await store.get('layouts', { type: 'json' })) || {},
      updateLayouts: (fn) => updateJSON('layouts', fn),
      readNotes: async () => (await store.get('notes', { type: 'json' })) || {},
      updateNotes: (fn) => updateJSON('notes', fn),
      async clearThreads() {
        const { blobs } = await store.list({ prefix: 'threads/' });
        await Promise.all(blobs.map((b) => store.delete(b.key)));
      },
    },
    {
      passwords: {
        player: process.env.PLAYER_PASSWORD,
        preview: process.env.PREVIEW_PASSWORD,
        admin: process.env.ADMIN_PASSWORD,
      },
      secret: process.env.SESSION_SECRET,
      // Netlify limita cada pedido a 6 MB
      maxUploadBytes: 5.8 * 1024 * 1024,
    }
  );
  return handler;
}

export default (request) => getHandler()(request);

export const config = {
  path: ['/api/*', '/files/*'],
};
