import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve to the real filesystem path via import.meta.url so Vite's root
// stays consistent with Node's file resolution even when the project is
// reached through a junction or symlink.
const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: dir,
  base: './',
  build: {
    outDir: path.join(dir, 'dist'),
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
