import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/plugin.ts'
import type { Config } from '../src/plugin.ts'

test('plugin tool runs two complete cycles with saved worlds and policy', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dream-rsi-test-'))
  const seedDir = join(temporary, 'seed')
  const stateDir = join(temporary, 'state')
  await cp(resolve('examples/toy/seed'), seedDir, { recursive: true })
  const config: Config = {
    seedDir, stateDir, taskPrompt: 'Move value toward 42.',
    evaluatorCommand: [process.execPath, resolve('examples/toy/evaluate.mjs')],
    provider: 'fake', model: 'fake', maxRounds: 2, replayRounds: 3,
    maxWidth: 2, revisions: 1, beta1: 0.1, beta2: 0.1, evaluationTimeoutMs: 10000,
  }
  let tool: { execute: (args: Record<string, never>) => Promise<string> } | undefined
  const ctx = {
    tools: { register(value: typeof tool) { tool = value } },
    agents: {
      async create({ meta }: { meta: { cwd: string } }) {
        let output = ''
        let work = Promise.resolve()
        return {
          agent: {
            followup({ content }: { content: { text: string }[] }) {
              work = (async () => {
                if (content[0].text.includes('fixed discovery agent')) {
                  const file = join(meta.cwd, 'candidate.json')
                  const candidate = JSON.parse(await readFile(file, 'utf8')) as { value: number }
                  await writeFile(file, JSON.stringify({ value: candidate.value + 10 }))
                  output = 'Raised the value by 10.'
                } else {
                  output = JSON.stringify({ rootWeight: 2, scoreWeight: 1, depthWeight: 0,
                    ageWeight: 0, batchSize: 2, stallLimit: 4 })
                }
              })()
            },
            async whenIdle() { await work },
            session: { deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: output }] }] },
          },
          async dispose() {},
        }
      },
    },
  }
  try {
    apply(ctx as unknown as Context, config)
    assert.ok(tool)
    const first = JSON.parse(await tool.execute({})) as { cycle: number; nodes: number; replayScore: number; incumbentReplayScore: number }
    const second = JSON.parse(await tool.execute({})) as { cycle: number; nodes: number }
    const saved = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8')) as { worlds: unknown[] }
    assert.equal(first.cycle, 1)
    assert.equal(first.nodes, 4)
    assert.ok(first.replayScore >= first.incumbentReplayScore)
    assert.equal(second.cycle, 2)
    assert.equal(saved.worlds.length, 2)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('installed plugin gives an actionable error until a task is configured', async () => {
  let tool: { execute: (args: Record<string, never>) => Promise<string> } | undefined
  const ctx = { tools: { register(value: typeof tool) { tool = value } } }
  const config: Config = {
    provider: 'deepseek', model: 'deepseek-chat', maxRounds: 5, replayRounds: 10,
    maxWidth: 2, revisions: 2, beta1: 0.01, beta2: 0.01, evaluationTimeoutMs: 120000,
  }
  apply(ctx as unknown as Context, config)
  assert.ok(tool)
  await assert.rejects(tool.execute({}), /configure seedDir, stateDir, taskPrompt, and evaluatorCommand/)
})
