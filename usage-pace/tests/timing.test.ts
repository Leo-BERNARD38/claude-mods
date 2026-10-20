import { expect, test } from 'claude-code/testing'

import { covered, splitTurn, timeRow, toolKey } from '../hooks/timing'
import { MIN, stats, text } from './fixtures'

test('nom court des outils', async () => {
  expect(toolKey('Bash', 'cd app && npm test -- --watch=false')).toBe('npm test')
  expect(toolKey('Bash', 'CI=1 pnpm vitest run')).toBe('pnpm vitest')
  expect(toolKey('Bash', '')).toBe('Bash')
  expect(toolKey('mcp__github__create_pr')).toBe('github create_pr')
  expect(toolKey('Read')).toBe('Read')
})

test('appels en parallèle comptés une fois', async () => {
  expect(
    covered([
      { start: 10, end: 40 },
      { start: 20, end: 50 },
      { start: 60, end: 80 },
    ]),
  ).toBe(60)
  expect(covered([])).toBe(0)
})

test('répartition d’un échange : Claude, outils, validations', async () => {
  // échange de 100 s : deux outils en parallèle de 10→40 s et 20→50 s, un outil validé de 60→80 s
  const time = splitTurn(100_000, [
    { start: 10_000, end: 40_000, asked: false },
    { start: 20_000, end: 50_000, asked: false },
    { start: 60_000, end: 80_000, asked: true },
  ])
  expect(time).toEqual({ claude: 40_000, tools: 40_000, you: 20_000 })
})

test('ligne Temps : le goulot et l’outil le plus lent', async () => {
  const row = timeRow(
    stats({
      time: { claude: 6 * MIN, tools: 12 * MIN, you: 2 * MIN },
      slow: { 'npm test': { ms: 9 * MIN, n: 3 }, Read: { ms: 20_000, n: 30 } },
    }),
    false,
  )!
  expect(row.verdict?.text).toBe('goulot : les outils')
  expect(row.pct?.text).toBe('60%')
  expect(text(row.detail)).toBe('Claude 6min · outils 12min · toi 2min · plus lent : npm test 9min (×3)')
  expect(text(row.bar)).toBe('███▓▓▓▓▓▓░')
  expect(timeRow(stats(), false)).toBeNull()
})
