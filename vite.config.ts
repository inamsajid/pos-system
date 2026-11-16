import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'

function pwaAssetManifestPlugin(): Plugin {
  return {
    name: 'pwa-asset-manifest',
    writeBundle(options, bundle) {
      const outDir = options.dir || 'dist'
      const assets = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map') && file !== 'sw.js')
        .map((file) => `/${file}`)
      const manifestPath = path.resolve(outDir, 'asset-manifest.json')
      fs.writeFileSync(manifestPath, JSON.stringify(assets, null, 2), 'utf-8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pwaAssetManifestPlugin()],
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
