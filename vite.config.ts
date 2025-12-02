import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Set base path for production builds (when served under /radio/)
  // In development, use '/' so dev server works correctly
  base: mode === 'production' ? '/radio/' : '/',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        // ONNX Runtime WASM files (all variants for compatibility) - copy to ort-wasm folder
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm*.wasm',
          dest: 'ort-wasm',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm*.mjs',
          dest: 'ort-wasm',
        },
        // VAD worklet from web-vad
        {
          src: 'node_modules/web-vad/dist/worklet.js',
          dest: '.',
        },
        // VAD model (already in public, will be served from there)
        // Wake word model
        {
          src: 'public/models/*.onnx',
          dest: 'models',
        },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {},
      includeAssets: ['icon-192.png', 'icon-512.png', 'logo.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            urlPattern: /\/radio\/api\/logo.*|\/api\/logo.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'logo-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
          {
            urlPattern: /\/radio\/api\/artwork.*|\/api\/artwork.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'artwork-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 3, // 3 days
              },
            },
          },
        ],
        navigateFallback: 'index.html', // Relative to base path
        navigateFallbackDenylist: [/^\/api/, /^\/radio\/api/],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true, // Allow access from other devices on the network
    proxy: {
      // Proxy /radio/api to local API server (for production-like dev environment)
      '/radio/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true, // Enable WebSocket proxying
        rewrite: (path) => path.replace(/^\/radio\/api/, '/api'),
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
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('[Vite Proxy] WebSocket upgrade:', req.url);
          });
        },
      },
      // Proxy /api for backward compatibility in dev
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true, // Enable WebSocket proxying
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
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('[Vite Proxy] WebSocket upgrade:', req.url);
          });
        },
      },
      // Proxy /radio/ws for wake word WebSocket
      '/radio/ws': {
        target: 'ws://localhost:8000',
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/radio\/ws/, '/ws'),
      },
    },
  },
  build: {
    // Production build optimizations
    // Note: Console stripping can be done via esbuild or terser plugin if needed
    rollupOptions: {
      // Exclude ONNX Runtime WASM files from bundling (they're served as static assets)
      external: (id) => {
        // Don't bundle ONNX Runtime WASM files - they're loaded dynamically
        return id.includes('ort-wasm') && (id.endsWith('.wasm') || id.endsWith('.mjs'));
      },
    },
  },
  optimizeDeps: {
    // Exclude onnxruntime-web from pre-bundling (WASM issues)
    exclude: ['onnxruntime-web'],
    // Include VAD library - the transform plugin will fix the require() before optimization
    include: ['@ricky0123/vad-web'],
  },
  define: {
    // Provide Buffer polyfill if needed
    global: 'globalThis',
  },
  resolve: {
    // Alias to handle the dynamic require("onnxruntime-web/wasm") in VAD library
    // Point to the actual file that exists in the package
    alias: [
      {
        find: /^onnxruntime-web\/wasm$/,
        replacement: 'onnxruntime-web/dist/ort.wasm.bundle.min.mjs',
      },
    ],
  },
  // Configure public directory for static assets
  publicDir: 'public',
}))
