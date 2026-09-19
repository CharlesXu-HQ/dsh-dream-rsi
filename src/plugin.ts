import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { initialPolicy, makePolicy, parsePolicy, rankPolicies, runOnline } from './core.ts'
import type { Node, PolicySpec, World } from './core.ts'

export const name = 'dream-rsi'
export const inject = ['agents', 'tools']

export interface Config {
  seedDir?: string
  stateDir?: string
  taskPrompt?: string
  evaluatorCommand?: string[]
  provider: string
  model: string
  maxRounds: number
  replayRounds: number
  maxWidth: number
  revisions: number
  beta1: number
  beta2: number
  evaluationTimeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  seedDir: Schema.string(),
  stateDir: Schema.string(),
  taskPrompt: Schema.string(),
  evaluatorCommand: Schema.array(Schema.string()),
  provider: Schema.string().default('deepseek'),
  model: Schema.string().default('deepseek-chat'),
  maxRounds: Schema.number().min(1).default(5),
  replayRounds: Schema.number().min(1).default(10),
  maxWidth: Schema.number().min(1).default(2),
  revisions: Schema.number().min(0).default(2),
  beta1: Schema.number().min(0).default(0.01),
  beta2: Schema.number().min(0).default(0.01),
  evaluationTimeoutMs: Schema.number().min(1).default(120000),
})

type RunConfig = Config & {
  seedDir: string
  stateDir: string
  taskPrompt: string
  evaluatorCommand: string[]
}

interface State { worlds: World[]; policy: PolicySpec }

function requireConfig(config: Config): RunConfig {
  if (!config.seedDir || !config.stateDir || !config.taskPrompt || !config.evaluatorCommand?.length) {
    throw new Error('configure seedDir, stateDir, taskPrompt, and evaluatorCommand before running dream_rsi_cycle')
  }
  return config as RunConfig
}

function inside(path: string, directory: string): boolean {
  const rel = relative(directory, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function checkPaths(seedDir: string, stateDir: string) {
  if (inside(seedDir, stateDir) || inside(stateDir, seedDir)) {
    throw new Error('seedDir and stateDir must not contain one another')
  }
}

async function saveState(file: string, state: State) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(state, null, 2))
  await rename(temporary, file)
}

async function loadState(file: string): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as State
    if (!Array.isArray(parsed.worlds)) throw new Error('invalid saved worlds')
    return { worlds: parsed.worlds, policy: parsePolicy(parsed.policy) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { worlds: [], policy: initialPolicy }
    throw error
  }
}

function lastAssistantText(agent: Agent): string {
  const messages = agent.session.deriveMessages()
  const last = [...messages].reverse().find(message => message.role === 'assistant')
  return last?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
}

async function askAgent(ctx: Context, config: Config, cwd: string, prompt: string): Promise<string> {
  const sessionId = `dream-rsi-${randomUUID()}`
  const handle = await ctx.agents.create({ sessionId: sessionId as SessionId, meta: { cwd },
    agentOptions: { provider: config.provider, model: config.model } })
  try {
    handle.agent.followup({ id: randomUUID() as MessageId, role: 'user',
      content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: name } })
    await handle.agent.whenIdle()
    const output = lastAssistantText(handle.agent)
    if (!output) throw new Error('agent produced no final text')
    return output
  } finally {
    await handle.dispose()
  }
}

async function evaluate(config: RunConfig, workspace: string): Promise<{ score: number; feedback: string }> {
  const [command, ...args] = config.evaluatorCommand
  if (!command) throw new Error('evaluatorCommand must not be empty')
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args, workspace], {
      cwd: workspace, shell: false, signal: AbortSignal.timeout(config.evaluationTimeoutMs),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`evaluator exited ${code}: ${stderr.slice(-2000)}`))
      try {
        const result = JSON.parse(stdout) as { score: number; feedback?: string }
        if (typeof result.score !== 'number' || !Number.isFinite(result.score)) throw new Error('evaluator must return a finite score')
        resolveResult({ score: result.score, feedback: String(result.feedback ?? '') })
      } catch (error) { reject(error) }
    })
  })
}

async function runCycle(ctx: Context, config: RunConfig) {
  const seedDir = resolve(config.seedDir)
  const stateDir = resolve(config.stateDir)
  checkPaths(seedDir, stateDir)
  if (!(await stat(seedDir)).isDirectory()) throw new Error('seedDir must be a directory')
  await mkdir(stateDir, { recursive: true })
  const stateFile = resolve(stateDir, 'state.json')
  const state = await loadState(stateFile)
  const cycleDir = resolve(stateDir, `cycle-${state.worlds.length}-${randomUUID()}`)
  await mkdir(cycleDir)
  const rootWorkspace = resolve(cycleDir, 'root')
  await cp(seedDir, rootWorkspace, { recursive: true })
  const baseline = await evaluate(config, rootWorkspace)
  const root: Node = { id: 'root', parentId: null, round: 0, score: baseline.score,
    observation: baseline.feedback, workspace: rootWorkspace }

  const world = await runOnline(root, makePolicy(state.policy), config.maxRounds, config.maxWidth,
    async (parent, childId) => {
      const workspace = resolve(cycleDir, childId)
      await cp(parent.workspace, workspace, { recursive: true })
      const instruction = [
        'You are the fixed discovery agent in a Dream-RSI experiment.',
        `Task: ${config.taskPrompt}`,
        `Work only in ${workspace}. Improve the candidate inherited from its parent.`,
        `Parent score: ${parent.score}. Parent feedback: ${parent.observation}`,
        'Make one substantive attempt, edit the workspace, then summarize the change. Do not invoke dream_rsi_cycle.',
      ].join('\n\n')
      const summary = await askAgent(ctx, config, workspace, instruction)
      try {
        const result = await evaluate(config, workspace)
        return { score: result.score, observation: `${result.feedback}\nAgent: ${summary}`, workspace }
      } catch (error) {
        return { score: -1e9, observation: `Evaluation failed: ${String(error)}\nAgent: ${summary}`, workspace }
      }
    })

  state.worlds.push(world)
  await saveState(stateFile, state)
  const candidates = [state.policy]
  const revisionErrors: string[] = []
  for (let revision = 0; revision < config.revisions; revision++) {
    const scores = rankPolicies(state.worlds, candidates, config.replayRounds, config.maxWidth, config.beta1, config.beta2)
    const prompt = [
      'You are the policy-development agent. Improve the exploration policy; do not edit task solutions.',
      'Respond with ONLY one JSON object with numeric rootWeight, scoreWeight, depthWeight, ageWeight, batchSize, stallLimit.',
      'The policy ranks only visible root/leaf nodes by rootWeight for root plus scoreWeight*score plus depthWeight*depth plus ageWeight*age.',
      'It picks the top batchSize eligible nodes (capped by maxWidth) and stops after stallLimit rounds without a new best score.',
      `maxWidth=${config.maxWidth}. Current policy and replay feedback: ${JSON.stringify(scores)}`,
      `Frozen-world observations for offline analysis only: ${JSON.stringify(state.worlds.map(world => world.nodes.map(
        ({ id, parentId, score, observation }) => ({ id, parentId, score, observation }),
      )))}`,
      'Optimize mean replay score over all frozen worlds. Never use unrevealed node scores in online decisions.',
    ].join('\n\n')
    try {
      const answer = await askAgent(ctx, config, stateDir, prompt)
      const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)
      candidates.push(parsePolicy(JSON.parse(json)))
    } catch (error) { revisionErrors.push(String(error)) }
  }
  const ranking = rankPolicies(state.worlds, candidates, config.replayRounds, config.maxWidth, config.beta1, config.beta2)
  state.policy = ranking[0].spec
  await saveState(stateFile, state)
  return { cycle: state.worlds.length, onlineBest: Math.max(...world.nodes.map(node => node.score)),
    nodes: world.nodes.length, policy: state.policy, replayScore: ranking[0].score,
    incumbentReplayScore: ranking.find(entry => entry.index === 0)!.score, revisionErrors, stateFile }
}

export function apply(ctx: Context, config: Config) {
  let running = false
  ctx.tools.register({
    name: 'dream_rsi_cycle',
    description: 'Run one Dream-RSI cycle: online discovery, frozen-world replay, and policy revision.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute() {
      if (running) throw new Error('a Dream-RSI cycle is already running')
      running = true
      try { return JSON.stringify(await runCycle(ctx, requireConfig(config))) }
      finally { running = false }
    },
  } satisfies ToolDefinition)
}
