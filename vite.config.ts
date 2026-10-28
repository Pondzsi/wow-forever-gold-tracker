import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths, so the build works on GitHub Pages under /wow-forever-gold-tracker/.
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true },
});
