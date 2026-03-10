import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.VITE_CLOUD_MODE': JSON.stringify(process.env.VITE_CLOUD_MODE || 'false'),
    'process.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || '/api'),
    'process.env.VITE_AUTH_URL': JSON.stringify(process.env.VITE_AUTH_URL || '/auth'),
  },
  server: {
    port: 8090,
    proxy: {
      '/api': {
        target: 'http://localhost:8091',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:8091',
        changeOrigin: true,
      },
    },
  },
});
