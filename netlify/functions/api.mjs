// Función de Netlify: atiende /api/* y /files/*. Los datos y archivos se
// guardan en Netlify Blobs (no hace falta configurar nada).

import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/core.js';

let handler = null;

function getHandler() {
  if (handler) return handler;
  const store = getStore({ name: 'memis', consistency: 'strong' });
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
      async readLayouts() {
        return (await store.get('layouts', { type: 'json' })) || {};
      },
      // Escritura condicional: si dos personas mueven pistas a la vez, ninguna pisa a la otra.
      async updateLayouts(fn) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const current = await store.getWithMetadata('layouts', { type: 'json' });
          const next = fn((current && current.data) || {});
          const opts = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
          const { modified } = await store.setJSON('layouts', next, opts);
          if (modified) return next;
        }
        throw new Error('No se pudo guardar la posición');
      },
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
