import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), versionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
