import { expect, test } from 'claude-code/testing'

import { alerts, limitRows, pace, verdict, weekPerSession } from '../hooks/limits'
import { DAY, H, MIN, NOW, at, round2, stats, text } from './fixtures'

test('ta capture : semaine à 66 % avec 66 % du temps écoulé → dans le rythme', async () => {
  const p = pace({ kind: 'seven_day', percentUsed: 66, resetsAt: at(2 * DAY + 9 * H) }, NOW)!
  expect(Math.round(p.elapsed)).toBe(66)
  expect(round2(p.ratio)).toBe(1)
  expect(verdict(p).text).toBe('= dans le rythme')
})

test('session à 12 % avec 46 % du temps écoulé → tu peux accélérer', async () => {
  const p = pace({ kind: 'five_hour', percentUsed: 12, resetsAt: at(2 * H + 43 * MIN) }, NOW)!
  expect(verdict(p).text).toBe('✓ tu peux accélérer')
})

test('trop vite : 62 % à mi-fenêtre → ça va couper, vide dans 1h32', async () => {
  const limit = { kind: 'five_hour', percentUsed: 62, resetsAt: at(2.5 * H) }
  const p = pace(limit, NOW)!
  expect(verdict(p).level).toBe(3)
  expect(Math.round((p.emptyInMs ?? 0) / MIN)).toBe(92)
  expect(alerts([limit], NOW)[0]?.text).toBe('Session : au rythme actuel, vide dans 1h32 (reset dans 2h30)')
})

test('début de fenêtre : pas de verdict hâtif', async () => {
  const p = pace({ kind: 'five_hour', percentUsed: 3, resetsAt: at(4.9 * H) }, NOW)!
  expect(verdict(p).text).toBe('✓ début de fenêtre')
})

test('limite atteinte, et fenêtre inconnue ignorée', async () => {
  expect(verdict(pace({ kind: 'five_hour', percentUsed: 100, resetsAt: at(H) }, NOW)!).text).toBe(
    '⛔ limite atteinte',
  )
  expect(pace({ kind: 'spend_limit', percentUsed: 10, resetsAt: at(H) }, NOW)).toBeNull()
})

test('lignes : temps écoulé, quota restant, %/jour', async () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: at(2 * H + 43 * MIN) },
    { kind: 'seven_day', percentUsed: 66, resetsAt: at(2 * DAY + 9 * H) },
  ]
  const rows = limitRows(limits, null, NOW, false)
  expect(rows.map(r => r.label)).toEqual(['Session', 'Semaine'])
  expect(text(rows[0]?.detail)).toBe('temps écoulé 46% · reste 88% pour 2h43')
  expect(text(rows[1]?.detail)).toBe('temps écoulé 66% · reste 34% pour 2j9h ≈ 14%/jour')
  expect(text(limitRows(limits, null, NOW, true)[0]?.detail)).toBe('reste 88% pour 2h43')
})

test('session : pas d’« accélère » quand la semaine est juste', async () => {
  const rows = limitRows(
    [
      { kind: 'five_hour', percentUsed: 5, resetsAt: at(4 * H) },
      { kind: 'seven_day', percentUsed: 85, resetsAt: at(3 * DAY) },
    ],
    null,
    NOW,
    false,
  )
  expect(rows[1]?.verdict?.tone).toBe('bad')
  expect(rows[0]?.verdict?.text).toBe('✓ ok, mais la semaine est juste')
})

test('rush : vider la session coûterait ≈ 25 % de semaine', async () => {
  // la session a pris 7 % de session et 2 % de semaine → 0,29 % de semaine par % de session
  const limits = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: at(3 * H) },
    { kind: 'seven_day', percentUsed: 66, resetsAt: at(2 * DAY) },
  ]
  expect(round2(weekPerSession(limits, stats()))).toBe(0.29)
  expect(text(limitRows(limits, stats(), NOW, false)[0]?.detail)).toMatch(/ · vider ≈ 25% de semaine$/)
  // pas d'estimation tant que la session n'a pas assez consommé
  expect(weekPerSession(limits, stats({ base: { five_hour: { p: 11, resetsAt: at(3 * H) } } }))).toBeNull()
})
