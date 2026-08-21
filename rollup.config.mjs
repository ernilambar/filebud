import { nodeResolve } from '@rollup/plugin-node-resolve'

/**
 * ES output with code splitting, not a single IIFE: `@codemirror/language-data`
 * loads each language mode through a dynamic `import()`, and Rollup cannot
 * code-split into an IIFE. Chunks keep the initial payload small and fetch
 * language modes only when a matching file is opened.
 */
export default {
  input: 'src/editor/main.mjs',
  output: {
    dir: 'public/editor',
    format: 'es',
    entryFileNames: 'main.js',
    chunkFileNames: 'chunks/[name]-[hash].js'
  },
  plugins: [nodeResolve()]
}
