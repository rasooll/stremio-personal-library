import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  base: '/admin/',
  build: { outDir: path.resolve(import.meta.dirname, '../dist/admin'), emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:7000', '/auth': 'http://localhost:7000' } },
});
