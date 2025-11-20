import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Allow access from other devices on the network
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        // Proxy API requests to local API server (run: npm run dev:api)
        // Note: Vite proxy automatically handles redirects from the backend
        configure: (proxy, _options) => {
          proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
            // Handle ECONNREFUSED gracefully - API server might be starting
            if (err.code === 'ECONNREFUSED') {
              console.warn('[Vite Proxy] API server not ready, retrying...');
              // Don't crash - let the request fail gracefully
              if (res && !(res as any).headersSent) {
                (res as any).writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'API server unavailable' }));
              }
            }
          });
        },
      },
    },
  },
  build: {
    // Production build optimizations
    // Note: Console stripping can be done via esbuild or terser plugin if needed
  },
})

