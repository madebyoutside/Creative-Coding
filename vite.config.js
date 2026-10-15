import { defineConfig } from 'vite'
import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = import.meta.dirname

// Every folder/<name>/index.html becomes its own page — no need to edit this file per sketch
const sketches = readdirSync(resolve(root, 'folder'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(resolve(root, 'folder', name, 'index.html')))
  .sort()

export default defineConfig({
  base: '/Creative-Coding/',
  define: {
    __SKETCHES__: JSON.stringify(sketches),
  },
  build: {
    chunkSizeWarningLimit: 1500, // p5 alone is ~1 MB
    rolldownOptions: {
      input: {
        main: resolve(root, 'index.html'),
        ...Object.fromEntries(
          sketches.map((name) => [name, resolve(root, 'folder', name, 'index.html')]),
        ),
      },
    },
  },
})
