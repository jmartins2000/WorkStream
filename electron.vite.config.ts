import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Keep `electron` (a devDependency) external so the runtime built-in is
        // used, and keep the Agent SDK external so its bundled CLI binary and
        // manifest assets remain resolvable at runtime. The adblocker must be
        // external too: bundling it breaks its runtime require.resolve of
        // '@ghostery/adblocker-electron-preload' (a NESTED dependency only
        // visible from the package's own node_modules) — see the packaged-app
        // "Cannot find module" crash. Externalized, it resolves correctly.
        external: [
          'electron',
          '@anthropic-ai/claude-agent-sdk',
          '@ghostery/adblocker-electron'
        ],
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
