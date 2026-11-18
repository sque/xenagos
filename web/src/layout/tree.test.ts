import { expect, test } from 'vitest'
import type { ChangedEntry, RepositoryTree } from '../generated/types'
import { buildTree, type FolderNode, openByDefault, type TreeNode } from './tree'

const entry = (path: string, status: ChangedEntry['status'], extra: Partial<ChangedEntry> = {}): ChangedEntry => ({
  path,
  oldPath: null,
  status,
  binary: false,
  category: 'code',
  covered: 'all',
  ...extra,
})

// 400 files; the change touches 5, the walkthrough visits 1 more (spec scenario "Default view of a large repository").
const filler = Array.from({ length: 380 }, (_, i) => `lib/vendor/pkg${String(i % 7)}/mod_${String(i)}.py`)
const data: RepositoryTree = {
  files: [
    ...filler,
    'README.md',
    'scheduler/__init__.py',
    'scheduler/batch.py',
    'scheduler/errors.py',
    'scheduler/legacy_retry.py',
    'scheduler/metrics.py',
    'scheduler/queue.py',
    'scheduler/settings.py',
    'scheduler/worker.py',
    'server/src/xenagos/app.py',
    'tests/conftest.py',
    'tests/test_batch.py',
    'tests/test_queue.py',
    'tests/test_worker.py',
    'docs/a.md',
    'docs/b.md',
    'api/routes.py',
    'api/schemas.py',
    'pyproject.toml',
    'uv.lock',
  ].sort(),
  changed: [
    entry('scheduler/batch.py', 'modified'),
    entry('scheduler/errors.py', 'added'),
    entry('scheduler/legacy_retry.py', 'deleted', { covered: 'none' }),
    entry('tests/test_batch.py', 'modified'),
    entry('uv.lock', 'modified', { category: 'generated', covered: 'none' }),
  ],
  visited: ['scheduler/queue.py'],
}

const names = (folder: FolderNode) => folder.children.map((n: TreeNode) => (n.kind === 'folder' ? `${n.name}/` : n.name))
const child = (folder: FolderNode, name: string) => {
  const found = folder.children.find((n) => n.kind === 'folder' && n.name === name)
  if (found?.kind !== 'folder') throw new Error(`no folder ${name}`)
  return found
}

test('narrow view keeps changed and visited files under their folders and counts the rest', () => {
  expect(data.files).toHaveLength(400)
  const { root, hidden } = buildTree(data, 'narrow', null)
  expect(hidden).toBe(394)
  expect(names(root)).toEqual(['scheduler/', 'tests/', 'uv.lock'])
  const scheduler = child(root, 'scheduler')
  expect(names(scheduler)).toEqual(['batch.py', 'errors.py', 'legacy_retry.py', 'queue.py'])
  expect(scheduler.hidden).toBe(4)
  expect(child(root, 'tests').hidden).toBe(3)
  expect(root.hidden).toBe(394 - 4 - 3)
  expect(scheduler.changes).toBe(true)
  expect(root.children.some((n) => n.kind === 'folder' && n.name.startsWith('lib'))).toBe(false)
})

test('the file on screen is shown in the narrow view even when nothing marks it', () => {
  const { root, hidden } = buildTree(data, 'narrow', 'api/routes.py')
  expect(hidden).toBe(393)
  const api = child(root, 'api')
  expect(names(api)).toEqual(['routes.py'])
  expect(api.changes).toBe(false)
})

test('whole view shows every file, folders first, and draws single-folder chains as one row', () => {
  const { root, hidden } = buildTree(data, 'all', null)
  expect(hidden).toBe(0)
  expect(names(root)).toEqual(['api/', 'docs/', 'lib/vendor/', 'scheduler/', 'server/src/xenagos/', 'tests/', 'pyproject.toml', 'README.md', 'uv.lock'])
  const server = child(root, 'server/src/xenagos')
  expect(server.path).toBe('server/src/xenagos')
  expect(names(server)).toEqual(['app.py'])
  expect(child(root, 'docs').changes).toBe(false)
  expect(child(root, 'scheduler').children.find((n) => n.name === 'legacy_retry.py')).toMatchObject({
    change: { status: 'deleted' },
  })
})

test('a folder with hidden files of its own is not merged into its only shown subfolder', () => {
  const nested: RepositoryTree = { files: ['a/x.py', 'a/b/c.py'], changed: [entry('a/b/c.py', 'modified')], visited: [] }
  const { root } = buildTree(nested, 'narrow', null)
  const a = child(root, 'a')
  expect(a.hidden).toBe(1)
  expect(names(a)).toEqual(['b/'])
  expect(names(buildTree({ ...nested, files: ['a/b/c.py'] }, 'narrow', null).root)).toEqual(['a/b/'])
})

test('folders holding changed, visited or the current file open by default', () => {
  expect([...openByDefault(data, 'server/src/xenagos/app.py')].sort()).toEqual([
    'scheduler',
    'server',
    'server/src',
    'server/src/xenagos',
    'tests',
  ])
})
