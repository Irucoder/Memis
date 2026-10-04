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
      writeSecret: (s) => store.set('secret', s),
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
