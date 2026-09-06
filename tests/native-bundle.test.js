import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('package declares a native dsh bundle patch', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'plugin/package.json'), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.type, 'module')
})

test('plugin uses Harness configuration and typed tool registration', async () => {
  const source = await readFile(path.join(root, 'plugin/src/index.js'), 'utf8')
  assert.match(source, /Schema\.object/)
  assert.match(source, /defineTool/)
  assert.match(source, /ctx\.tools\.register/)
})

test('bundle defaults remain offline and write-disabled', async () => {
  const patch = await readFile(path.join(root, 'plugin/cordis.patch.yml'), 'utf8')
  assert.match(patch, /mode: dry-run/)
  assert.match(patch, /networkEnabled: false/)
  assert.match(patch, /externalWritesEnabled: false/)
})
