import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eligibleIds, makePolicy, rankPolicies, replay, runOnline } from '../src/core.ts'
import type { Node, World } from '../src/core.ts'

const root: Node = { id: 'root', parentId: null, round: 0, score: 0, observation: '', workspace: '/root' }

test('online exploration creates branches from only root and leaves', async () => {
  const parents: string[] = []
  const world = await runOnline(root, ({ eligible, maxWidth }) => [...eligible].slice(0, maxWidth), 3, 2, async (parent, childId) => {
    parents.push(parent.id)
    return { score: Number(childId.slice(1)), observation: childId, workspace: `/${childId}` }
  })
  assert.deepEqual(parents, ['root', 'root', 'n1', 'root', 'n2'])
  assert.deepEqual(eligibleIds(world.nodes), ['root', 'n3', 'n4', 'n5'])
})

test('replay reveals only prefix and follows recorded root order', () => {
  const world: World = { nodes: [root,
    { id: 'a', parentId: 'root', round: 1, score: 1, observation: '', workspace: '/a' },
    { id: 'b', parentId: 'root', round: 2, score: 9, observation: '', workspace: '/b' },
    { id: 'c', parentId: 'a', round: 3, score: 3, observation: '', workspace: '/c' },
  ] }
  const seen: string[][] = []
  const result = replay(world, ({ nodes, eligible }) => {
    seen.push(nodes.map(node => node.id))
    return seen.length === 1 ? ['root'] : seen.length === 2 ? ['root', 'a'] : []
  }, 5, 2, 0.1, 0.2)
  assert.deepEqual(seen, [['root'], ['root', 'a']])
  assert.deepEqual(result.revealed, ['root', 'a', 'b', 'c'])
  assert.equal(result.rounds, 2)
  assert.equal(result.score, 9 - 0.1 * 3 + 0.2 * 3 / 2)
  assert.deepEqual(result.trajectory.map(step => step.opened), [['a'], ['b', 'c']])
})

test('invalid policy batches are rejected', () => {
  const child: Node = { id: 'a', parentId: 'root', round: 1, score: 1, observation: '', workspace: '/a' }
  assert.throws(() => replay({ nodes: [root, child] }, () => ['not-visible'], 1, 1, 0, 0), /invalid batch/)
})

test('nonempty replay decisions count as rounds even when a branch has no recorded continuation', () => {
  const world: World = { nodes: [root,
    { id: 'a', parentId: 'root', round: 1, score: 1, observation: '', workspace: '/a' },
    { id: 'b', parentId: 'a', round: 2, score: 2, observation: '', workspace: '/b' },
  ] }
  const result = replay(world, ({ nodes }) => nodes.length === 1 ? ['root'] : ['root'], 4, 1, 0, 1)
  assert.equal(result.rounds, 4)
  assert.deepEqual(result.revealed, ['root', 'a'])
  assert.equal(result.score, 1 + 1 / 4)
})

test('ranking keeps incumbent on ties and policy only sees visible nodes', () => {
  const world = { nodes: [root, { id: 'a', parentId: 'root', round: 1, score: 2, observation: '', workspace: '/a' }] }
  const spec = { rootWeight: 1, scoreWeight: 1, depthWeight: 0, ageWeight: 0, batchSize: 1, stallLimit: 3 }
  const ranked = rankPolicies([world], [spec, spec], 2, 1, 0, 0)
  assert.deepEqual(ranked.map(entry => entry.index), [0, 1])
  assert.deepEqual(makePolicy(spec)({ nodes: [root], eligible: ['root'], round: 0, maxWidth: 1 }), ['root'])
})
