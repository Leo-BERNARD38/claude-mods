import { expect, test } from 'claude-code/testing'

import { config, current, guardStatus, reminder, report, resumePrompt, stopDenial } from '../hooks/guard'
import { DAY, H, MIN, NOW, at } from './fixtures'

const cfg = config({})
const limits = (session: number, week: number, sessionReset = 2 * H, weekReset = 3 * DAY) => [
  { kind: 'five_hour', percentUsed: session, resetsAt: at(sessionReset) },
  { kind: 'seven_day', percentUsed: week, resetsAt: at(weekReset) },
]

test('réglages par défaut : 80 / 90, reprise auto ; un arrêt sous le seuil est remonté au seuil', async () => {
  expect(cfg).toEqual({ warnAt: 80, stopAt: 90, resume: true })
  expect(config({ seuil: 70, seuil_arret: 60, reprise_auto: false })).toEqual({
    warnAt: 70,
    stopAt: 70,
    resume: false,
  })
})

test('sous le seuil : rien', async () => {
  expect(guardStatus(limits(40, 50), cfg, NOW).level).toBe('ok')
})

test('session à 82 % : rappel, reprise au reset de la session + 2 min', async () => {
  const s = guardStatus(limits(82, 50), cfg, NOW)
  expect(s.level).toBe('warn')
  expect(s.worst).toEqual({ label: 'Session', used: 82 })
  expect(s.resumeAt).toBe(NOW + 2 * H + 2 * MIN)
  expect(reminder(s, cfg, NOW)).toContain('Quota Session à 82 %')
})

test('semaine à 91 % : arrêt, et la reprise attend le reset de la semaine', async () => {
  const s = guardStatus(limits(85, 91), cfg, NOW)
  expect(s.level).toBe('stop')
  expect(s.resumeAt).toBe(NOW + 3 * DAY + 2 * MIN)
  expect(stopDenial('Bash', s, cfg, NOW)).toContain('Pause : quota Semaine à 91 %')
  expect(stopDenial('Write', s, cfg, NOW)).toBe(null)
  expect(stopDenial('mcp__usage-pace__quotas', s, cfg, NOW)).toBe(null)
})

test('une fenêtre dont le reset est passé compte pour 0 %', async () => {
  expect(current({ kind: 'five_hour', percentUsed: 95, resetsAt: at(-MIN) }, NOW)).toBe(0)
  expect(guardStatus(limits(95, 40, -MIN), cfg, NOW).level).toBe('ok')
  expect(resumePrompt(limits(95, 40, -MIN), NOW)).toContain('Session 0 %, Semaine 40 %')
})

test('le rapport de l’outil quotas donne le % et le conseil', async () => {
  const text = report(limits(82, 50), cfg, NOW)
  expect(text).toContain('- Session : 82 % utilisé')
  expect(text).toContain('Au-dessus du seuil')
  expect(report([], cfg, NOW)).toContain('Pas encore de mesure')
})
