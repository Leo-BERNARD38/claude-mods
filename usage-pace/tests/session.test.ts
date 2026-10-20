import { expect, test } from 'claude-code/testing'

import { emptyStats, sessionRow, withBase, withTool, withTurn } from '../hooks/session'
import { DAY, H, NOW, at, stats, text } from './fixtures'

const LIMITS = [
  { kind: 'five_hour', percentUsed: 12, resetsAt: at(3 * H) },
  { kind: 'seven_day', percentUsed: 66, resetsAt: at(2 * DAY) },
]

test('ligne « Ici » : ce que la session a fait et pris', async () => {
  const row = sessionRow({ limits: LIMITS, usd: 3.2 }, stats(), NOW, false)!
  expect(text(row.detail)).toBe(
    '1h12 · 23 échanges · 41 outils · 2 fichiers modifiés · cache 92% · a pris +7% session, +2% semaine · ≈ 3,20 $ au prix API',
  )
})

test('point de départ : gardé, sauf quand la fenêtre repart', async () => {
  const s = withBase(emptyStats(NOW), LIMITS)
  expect(s.base.five_hour).toEqual({ p: 12, resetsAt: at(3 * H) })
  const later = withBase(s, [{ kind: 'five_hour', percentUsed: 20, resetsAt: at(3 * H) }])
  expect(later.base.five_hour?.p).toBe(12)
  const reset = withBase(s, [{ kind: 'five_hour', percentUsed: 1, resetsAt: at(8 * H) }])
  expect(reset.base.five_hour?.p).toBe(1)
})

test('outils : temps cumulé par nom, fichiers sans doublon, validations non chronométrées', async () => {
  let s = emptyStats(NOW)
  s = withTool(s, { key: 'npm test', ms: 3000, timed: true })
  s = withTool(s, { key: 'npm test', ms: 5000, timed: true })
  s = withTool(s, { key: 'Edit', ms: 10, file: 'a.ts', timed: true })
  s = withTool(s, { key: 'Edit', ms: 10, file: 'a.ts', timed: true })
  s = withTool(s, { key: 'rm', ms: 60_000, timed: false })
  expect(s.tools).toBe(5)
  expect(s.slow['npm test']).toEqual({ ms: 8000, n: 2 })
  expect(s.slow.rm).toBeUndefined()
  expect(s.files).toEqual(['a.ts'])
})

test('échanges : temps et cache cumulés', async () => {
  const usage = { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }
  const s = withTurn(withTurn(emptyStats(NOW), { claude: 1, tools: 2, you: 3 }, usage), {
    claude: 1,
    tools: 2,
    you: 3,
  })
  expect(s.turns).toBe(2)
  expect(s.time).toEqual({ claude: 2, tools: 4, you: 6 })
  expect(s.cacheRead / s.inputTotal).toBe(0.9)
})
