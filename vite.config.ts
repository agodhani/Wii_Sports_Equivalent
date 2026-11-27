import { defineConfig } from 'vite';
import { attachSignaling } from './server/signaling.mjs';

export default defineConfig({
  plugins: [{
    name: 'tennis-signaling',
    configureServer(server) {
      if (server.httpServer) attachSignaling(server.httpServer);
    },
    configurePreviewServer(server) {
      attachSignaling(server.httpServer);
    },
  }],
});
