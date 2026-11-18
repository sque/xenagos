// Mermaid's standalone bundle, served at /visual-assets/ for visuals that use it (design decision 7). Copied from the
// installed package into the public folder (git-ignored), so the dev server, the tests and the build all have it.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function visualAssets() {
  return {
    name: 'xenagos-visual-assets',
    buildStart() {
      const require = createRequire(import.meta.url)
      const source = join(dirname(require.resolve('mermaid/package.json')), 'dist', 'mermaid.min.js')
      const target = new URL('../public/visual-assets/', import.meta.url)
      mkdirSync(target, { recursive: true })
      copyFileSync(source, new URL('mermaid.min.js', target))
    },
  }
}
