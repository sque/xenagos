// Generate src/generated/types.ts from src/generated/schema.json, which the server exports (`make types`).
// With --check, fail instead of writing when types.ts is not what the schema gives.
import { readFile, writeFile } from 'node:fs/promises'
import { compile } from 'json-schema-to-typescript'

const schemaFile = new URL('../src/generated/schema.json', import.meta.url)
const typesFile = new URL('../src/generated/types.ts', import.meta.url)
const banner =
  '// Generated from the server models (server/src/xenagos/plan.py, api.py) by `make types`. Do not edit.'

// The schema has no root type, only definitions under $defs; the compiler emits unreferenced definitions only from
// `definitions`, so move them there and emit each as its own type.
const text = (await readFile(schemaFile, 'utf8')).replaceAll('"#/$defs/', '"#/definitions/')
const { $defs: definitions } = JSON.parse(text)
const root = { title: 'Root', type: 'object', properties: {}, additionalProperties: false, definitions }
const generated = await compile(root, 'Root', {
  bannerComment: banner,
  unreachableDefinitions: true,
  additionalProperties: false,
})
const types = generated.replace(/^export interface Root \{\}\n/m, '')

if (process.argv.includes('--check')) {
  const current = await readFile(typesFile, 'utf8').catch(() => '')
  if (current !== types) {
    console.error('src/generated/types.ts is stale: run `make types` and commit the result.')
    process.exit(1)
  }
} else {
  await writeFile(typesFile, types)
}
