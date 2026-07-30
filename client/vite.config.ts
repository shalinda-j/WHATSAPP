import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // Split heavy/rarely-changing libraries into their own chunks so the
    // browser can cache them independently and the per-page route chunks
    // stay small.
    rollupOptions: {
      // Two documents, two entries. index.html is the admin panel; kiosk.html is
      // the walk-up branch terminal, which needs its own manifest (a manifest
      // link is per-document) and pulls in only the kiosk page. Without listing
      // it here Vite would emit index.html alone and kiosk.html would 404.
      input: {
        main: resolve(__dirname, 'index.html'),
        kiosk: resolve(__dirname, 'kiosk.html'),
      },
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          socket: ['socket.io-client'],
          icons: ['lucide-react'],
          qr: ['qrcode.react'],
        },
      },
    },
    // Bumped because main vendor chunks are still naturally >500KB and the
    // warning is alarmist for a multi-app admin panel.
    chunkSizeWarningLimit: 800,
  },
});
