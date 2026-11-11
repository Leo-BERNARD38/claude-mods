// Les calculs du garde-fou, seuls.
import { expect, test } from 'claude-code/testing'

import {
  DAY,
  HOUR,
  MIN,
  config,
  denial,
  parseDuration,
  report,
  reminder,
  status,
  unlockUntil,
} from '../hooks/guard'

const NOW = Date.parse('2026-11-01T13:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const cfg = config({})
/** Session et Semaine, avec le temps restant avant chaque reset. */
const limits = (session: number, week: number, weekLeft = 3 * DAY, sessionLeft = 2 * HOUR) => [
  { kind: 'five_hour', percentUsed: session, resetsAt: at(sessionLeft) },
  { kind: 'seven_day', percentUsed: week, resetsAt: at(weekLeft) },
]

test('réglages par défaut : marge 14 points, plafond 100, arrêt Session 80, reprise auto', async () => {
  expect(cfg).toEqual({ weekMargin: 14, weekCap: 100, sessionStop: 80, resume: true })
  // les anciens réglages (seuil / seuil_arret) ne comptent plus
  expect(config({ seuil: 80, seuil_arret: 90 })).toEqual(cfg)
  expect(config({ semaine_marge: 0, session_arret: 70, reprise_auto: false }).sessionStop).toBe(70)
})

test('dimanche, Semaine à 97 % à 5 h du reset : un agent continue jusqu’à 100 %', async () => {
  const s = status(limits(10, 97, 5 * HOUR), cfg, NOW, 'agent')
  expect(s.worst?.stopAt).toBe(100)
  expect(s.level).toBe('warn')
  expect(denial('Bash', s, cfg, NOW)).toBe(null)
  expect(status(limits(10, 100, 5 * HOUR), cfg, NOW, 'agent').level).toBe('stop')
})

test('lundi, Semaine à 30 % après 1 jour : un agent s’arrête, et repart quand le temps a rattrapé', async () => {
  // 1 jour écoulé ≈ 14 % → permis 28 %
  const s = status(limits(10, 30, 6 * DAY), cfg, NOW, 'agent')
  expect(Math.round(s.worst!.stopAt)).toBe(28)
  expect(s.level).toBe('stop')
  expect(denial('Bash', s, cfg, NOW)).toContain('Pause : quota Semaine à 30 %')
  // reprise quand temps écoulé + 14 - 5 dépasse 30 % : à 21 % de la semaine, soit 1,47 jour
  expect(Math.round((s.resumeAt! - (NOW - DAY)) / HOUR)).toBe(Math.round(0.21 * 7 * 24))
})

test('beaucoup de quota pour peu de jours : de la marge, l’outil quotas dit d’accélérer', async () => {
  const text = report(limits(10, 40, 2 * DAY), cfg, NOW, 'agent')
  expect(text).toContain('- Semaine : 40 % utilisé, permis maintenant 85 %')
  expect(text).toContain('tu peux accélérer')
  expect(text).toContain('≈ 30 %/jour')
})

test('Session 5 h : rappel à 75 %, arrêt des agents à 80 %', async () => {
  expect(status(limits(70, 10), cfg, NOW, 'agent').level).toBe('ok')
  expect(status(limits(76, 10), cfg, NOW, 'agent').level).toBe('warn')
  const s = status(limits(82, 10), cfg, NOW, 'agent')
  expect(s.level).toBe('stop')
  expect(s.resumeAt).toBe(NOW + 2 * HOUR + 2 * MIN)
  expect(denial('Write', s, cfg, NOW)).toBe(null)
  expect(denial('mcp__usage-pace-guard__quotas', s, cfg, NOW)).toBe(null)
})

test('ta session n’est jamais bloquée : rappel seulement', async () => {
  const s = status(limits(95, 99, 5 * DAY), cfg, NOW, 'you')
  expect(s.level).toBe('warn')
  expect(denial('Bash', s, cfg, NOW)).toBe(null)
  expect(reminder(s, 'you')).toContain("rien n'est bloqué")
})

test('suspendu par /usage-pace:debloquer : rien ne bloque jusqu’à l’échéance', async () => {
  const s = status(limits(95, 10), cfg, NOW, 'agent', NOW + HOUR)
  expect(s.level).toBe('ok')
  expect(report(limits(95, 10), cfg, NOW, 'agent', { suspended: NOW + HOUR })).toContain(
    'Garde-fou suspendu jusqu',
  )
  // une suspension échue ne compte plus
  expect(status(limits(95, 10), cfg, NOW, 'agent', NOW - MIN).level).toBe('stop')
})

test('/usage-pace:debloquer : jusqu’au reset de la fenêtre qui bloque, une durée, ou off', async () => {
  expect(unlockUntil('', limits(85, 10), cfg, NOW)).toEqual({
    until: NOW + 2 * HOUR,
    why: "jusqu'au reset Session",
  })
  expect(unlockUntil('', limits(10, 60, 6 * DAY), cfg, NOW)).toEqual({
    until: NOW + 6 * DAY,
    why: "jusqu'au reset Semaine",
  })
  expect(unlockUntil('2h', [], cfg, NOW)).toEqual({ until: NOW + 2 * HOUR, why: 'pour 2h00' })
  expect(unlockUntil('off', [], cfg, NOW)).toEqual({ off: true })
  expect('error' in unlockUntil('demain', [], cfg, NOW)).toBe(true)
})

test('durées lisibles', async () => {
  expect(parseDuration('2h')).toBe(2 * HOUR)
  expect(parseDuration('1h30')).toBe(90 * MIN)
  expect(parseDuration('45min')).toBe(45 * MIN)
  expect(parseDuration('30')).toBe(30 * MIN)
  expect(parseDuration('1j')).toBe(DAY)
  expect(parseDuration('n’importe')).toBe(null)
})
