export interface Node {
  id: string
  parentId: string | null
  round: number
  score: number
  observation: string
  workspace: string
}

export interface World {
  nodes: Node[]
}

export interface PolicySpec {
  rootWeight: number
  scoreWeight: number
  depthWeight: number
  ageWeight: number
  batchSize: number
  stallLimit: number
}

export interface PolicyView {
  nodes: readonly Readonly<Node>[]
  eligible: readonly string[]
  round: number
  maxWidth: number
}

export type Policy = (view: PolicyView) => string[]

export const initialPolicy: PolicySpec = {
  rootWeight: 1,
  scoreWeight: 1,
  depthWeight: 0,
  ageWeight: 0,
  batchSize: 2,
  stallLimit: 4,
}

export function parsePolicy(value: unknown): PolicySpec {
  if (typeof value !== 'object' || value === null) throw new Error('policy must be an object')
  const input = value as Record<string, unknown>
  const keys = ['rootWeight', 'scoreWeight', 'depthWeight', 'ageWeight', 'batchSize', 'stallLimit'] as const
  for (const key of keys) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) throw new Error(`invalid policy field: ${key}`)
  }
  if (!Number.isInteger(input.batchSize) || (input.batchSize as number) < 1) throw new Error('batchSize must be a positive integer')
  if (!Number.isInteger(input.stallLimit) || (input.stallLimit as number) < 1) throw new Error('stallLimit must be a positive integer')
  return Object.fromEntries(keys.map(key => [key, input[key]])) as unknown as PolicySpec
}

export function eligibleIds(nodes: readonly Node[]): string[] {
  const parents = new Set(nodes.slice(1).map(node => node.parentId))
  return nodes.filter(node => node.parentId === null || !parents.has(node.id)).map(node => node.id)
}

function depthOf(node: Node, byId: Map<string, Node>): number {
  let depth = 0
  let parentId = node.parentId
  while (parentId !== null) {
    depth += 1
    parentId = byId.get(parentId)?.parentId ?? null
  }
  return depth
}

export function makePolicy(spec: PolicySpec): Policy {
  return ({ nodes, eligible, round, maxWidth }) => {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const best = Math.max(...nodes.map(node => node.score))
    const lastGain = Math.min(...nodes.filter(node => node.score === best).map(node => node.round))
    if (round > 0 && round - lastGain >= spec.stallLimit) return []
    return [...eligible]
      .sort((left, right) => {
        const rank = (id: string) => {
          const node = byId.get(id)!
          return (node.parentId === null ? spec.rootWeight : 0)
            + spec.scoreWeight * node.score
            + spec.depthWeight * depthOf(node, byId)
            + spec.ageWeight * (round - node.round)
        }
        return rank(right) - rank(left) || left.localeCompare(right)
      })
      .slice(0, Math.min(maxWidth, spec.batchSize))
  }
}

function decide(policy: Policy, nodes: Node[], round: number, maxWidth: number): string[] {
  const eligible = eligibleIds(nodes)
  const visible = nodes.map(node => Object.freeze({ ...node }))
  const selected = policy(Object.freeze({ nodes: Object.freeze(visible), eligible: Object.freeze(eligible), round, maxWidth }))
  if (!Array.isArray(selected) || selected.length > maxWidth || new Set(selected).size !== selected.length
    || selected.some(id => !eligible.includes(id))) throw new Error('policy selected an invalid batch')
  return selected
}

export async function runOnline(
  root: Node,
  policy: Policy,
  maxRounds: number,
  maxWidth: number,
  expand: (parent: Readonly<Node>, childId: string, round: number) => Promise<Pick<Node, 'score' | 'observation' | 'workspace'>>,
): Promise<World> {
  const nodes = [{ ...root }]
  for (let round = 0; round < maxRounds; round++) {
    const selected = decide(policy, nodes, round, maxWidth)
    if (selected.length === 0) break
    const children = await Promise.all(selected.map(async (id, index) => {
      const parent = nodes.find(node => node.id === id)!
      const childId = `n${nodes.length + index}`
      const result = await expand(Object.freeze({ ...parent }), childId, round + 1)
      if (!Number.isFinite(result.score)) throw new Error('evaluator returned a non-finite score')
      return { id: childId, parentId: id, round: round + 1, ...result }
    }))
    nodes.push(...children)
  }
  return { nodes }
}

export interface ReplayResult {
  score: number
  bestScore: number
  revealed: string[]
  rounds: number
  trajectory: { selected: string[]; opened: string[] }[]
}

export function replay(world: World, policy: Policy, maxRounds: number, maxWidth: number, beta1: number, beta2: number): ReplayResult {
  const root = world.nodes[0]
  if (!root || root.parentId !== null) throw new Error('world needs a root')
  const visible = [root]
  const seen = new Set([root.id])
  const trajectory: ReplayResult['trajectory'] = []
  for (let round = 0; round < maxRounds && seen.size < world.nodes.length; round++) {
    const selected = decide(policy, visible, round, maxWidth)
    if (selected.length === 0) break
    const opened = selected.flatMap(id => {
      const child = world.nodes.find(node => node.parentId === id && !seen.has(node.id))
      return child ? [child] : []
    })
    trajectory.push({ selected, opened: opened.map(node => node.id) })
    for (const node of opened) {
      seen.add(node.id)
      visible.push(node)
    }
  }
  const count = visible.length - 1
  const rounds = trajectory.length
  const bestScore = Math.max(...visible.map(node => node.score))
  return { score: bestScore - beta1 * count + beta2 * count / Math.max(1, rounds), bestScore,
    revealed: visible.map(node => node.id), rounds, trajectory }
}

export function rankPolicies(worlds: readonly World[], specs: readonly PolicySpec[], maxRounds: number, maxWidth: number, beta1: number, beta2: number) {
  if (worlds.length === 0 || specs.length === 0) throw new Error('worlds and policies are required')
  return specs.map((spec, index) => {
    const results = worlds.map(world => replay(world, makePolicy(spec), maxRounds, maxWidth, beta1, beta2))
    return { index, spec, score: results.reduce((sum, result) => sum + result.score, 0) / results.length, results }
  }).sort((left, right) => right.score - left.score || left.index - right.index)
}
