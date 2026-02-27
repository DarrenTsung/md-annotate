import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { mdAnnotatePlugin } from './src/server/vite-plugin.js';

export default defineConfig({
  plugins: [react(), mdAnnotatePlugin()],
  root: 'src/client',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 3456,
  },
});
