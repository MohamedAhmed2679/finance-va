import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

/**
 * Builds /sw.js from src/sw-template.js: the files needed to start the member app (its entry and
 * everything it imports up front, plus CSS) are listed for offline start; the version changes
 * whenever any of them changes. Screens loaded later are cached on first use by the worker.
 */
function serviceWorker(): Plugin {
  return {
    name: 'zaylo-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const entry = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry && c.name === 'main')
      if (!entry || entry.type !== 'chunk') return
      const files = new Set<string>()
      const visit = (name: string) => {
        const c = bundle[name]
        if (!c || files.has(name)) return
        files.add(name)
        if (c.type === 'chunk') {
          c.imports.forEach(visit)
          const meta = (c as unknown as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }).viteMetadata
          meta?.importedCss?.forEach(f => files.add(f))
        }
      }
      visit(entry.fileName)
      // the fonts the app shows first (Latin + Arabic), so text looks right offline
      for (const f of Object.keys(bundle)) if (/(inter-latin-wght-normal|ibm-plex-sans-arabic-arabic-(400|600)-normal)-[\w-]+\.woff2$/.test(f)) files.add(f)
      const list = [...files].sort().map(f => `/${f}`)
      const version = createHash('sha256').update(list.join('|')).digest('hex').slice(0, 12)
      const source = readFileSync('src/sw-template.js', 'utf8')
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(list)};`)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// The Electron main/preload build only runs for desktop builds (ELECTRON=true).
// Web (Vercel) and mobile (Capacitor) builds skip it.
const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    react(),
    ...(isElectron ? [] : [serviceWorker()]),
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
