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
