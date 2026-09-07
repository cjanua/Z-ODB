import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    // TanStack Router must come before React plugin
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // DuckDB-WASM ships its own workers; exclude from Vite pre-bundling
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },

  // Required for DuckDB-WASM threading (SharedArrayBuffer)
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Target esnext for top-level await (used by DuckDB-WASM)
  build: {
    target: 'esnext',
    rollupOptions: {
      // Prevent DuckDB worker files from being inlined
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  // VITE_APP_BASE lets CI set /Z-ODB/ for GitHub Pages; Tauri keeps ./
  base: process.env['VITE_APP_BASE'] ?? (command === 'build' ? './' : '/'),
}))
