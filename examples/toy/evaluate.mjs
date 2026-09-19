import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const workspace = process.argv[2]
const candidate = JSON.parse(await readFile(resolve(workspace, 'candidate.json'), 'utf8'))
const score = -Math.abs(Number(candidate.value) - 42)
if (!Number.isFinite(score)) throw new Error('candidate.value must be numeric')
process.stdout.write(JSON.stringify({ score, feedback: `Distance to target: ${-score}` }))
