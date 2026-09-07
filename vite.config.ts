import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787', '/audio': 'http://127.0.0.1:8787' },
  },
  build: {
    outDir: 'dist/client',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: { manualChunks: (id: string) => (id.includes('phaser') ? 'phaser' : undefined) },
    },
  },
});
