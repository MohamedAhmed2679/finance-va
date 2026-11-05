import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// The Electron main/preload build only runs for desktop builds (ELECTRON=true).
// Web (Vercel) and mobile (Capacitor) builds skip it.
const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    react(),
    ...(isElectron
      ? [electron({
          main: { entry: 'electron/main.ts' },
          preload: { input: 'electron/preload.ts' },
        })]
      : []),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // Two separate apps: the member app and the admin console.
      input: isElectron ? undefined : { main: 'index.html', admin: 'admin.html' },
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
