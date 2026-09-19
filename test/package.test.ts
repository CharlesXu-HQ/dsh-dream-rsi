import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('package declares an installable Harness bundle', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    name: string; main: string; license: string; dsh: { bundle: { patch: string } }
  }
  const patch = await readFile('cordis.patch.yml', 'utf8')
  const license = await readFile('LICENSE', 'utf8')
  assert.equal(manifest.name, 'dsh-dream-rsi')
  assert.equal(manifest.main, './lib/plugin.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.license, 'MIT')
  assert.match(license, /^MIT License/)
  assert.match(patch, /name: dsh-dream-rsi/)
})
