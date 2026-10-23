import { defineConfig } from 'vite';

const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: process.env.VITE_SOURCEMAP === '1',
  },
  worker: {
    format: 'es',
  },
});
