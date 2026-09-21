import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const BUILD_ID = String(Date.now())

// Emits /version.json so the running app can detect a newer deployment.
const versionFile = {
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ id: BUILD_ID }),
    })
  },
}

const IS_POS = process.env.VITE_APP_MODE === 'pos'

// POS build: its own page title and installed-app name (the events Till keeps "Gingerbread Till").
const posBranding = {
  name: 'pos-branding',
  transformIndexHtml(html) {
    return IS_POS ? html.replace('<title>Gingerbread Till</title>', '<title>Gingerbread POS</title>') : html
  },
  closeBundle() {
    if (!IS_POS) return
    const file = path.resolve('dist', 'manifest.json')
    if (!fs.existsSync(file)) return
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.name = 'Gingerbread POS'
    manifest.short_name = 'POS'
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2))
  },
}

export default defineConfig({
  plugins: [react(), versionFile, posBranding],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
