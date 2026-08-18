import fs from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(() => {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const envPath = path.join(projectRoot, '.env');
  const fileEnv = fs.existsSync(envPath) ? parse(fs.readFileSync(envPath)) : {};
  const backendUrl = `http://localhost:${process.env.PORT || fileEnv.PORT || '7000'}`;

  return {
    root: path.resolve(import.meta.dirname),
    plugins: [react()],
    base: '/admin/',
    build: { outDir: path.resolve(import.meta.dirname, '../dist/admin'), emptyOutDir: true },
    server: { port: 5173, proxy: { '/api': backendUrl, '/auth': backendUrl } },
  };
});
