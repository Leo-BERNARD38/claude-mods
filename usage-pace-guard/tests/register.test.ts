// De bout en bout : le mod chargé par le moteur, ses hooks branchés sur de faux évènements.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DAY, HOUR, MIN } from '../hooks/guard'

const NOW = Date.parse('2026-11-01T13:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const HIGH = [
  { kind: 'five_hour', percentUsed: 85, resetsAt: at(1 * HOUR) },
  { kind: 'seven_day', percentUsed: 40, resetsAt: at(3 * DAY) },
]
const SUSPENSION = '/home/toi/.usage-pace/garde-fou.json'

/** Ce que Claude Code répondrait, avec un disque en mémoire. */
function engine(on: On, env: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const files: Record<string, string> = {}
  const submitted: string[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/toi' : env[e.name] }) as never)
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] } as never
  })
  on('fs.write', (_$, e) => ((files[e.path] = e.text), { value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__usage-pace-guard__quotas' } }) as never)
  on('session.start', () => ({ cwd: '/projet' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: HIGH, context: {} } }) as never)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }))
  return { clock, files, submitted }
}

const turn = (id: string) =>
  ({ answer: 'pause', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' }) as never
const prompt = (kind: string) => ({ text: 'go', wait: false, origin: { kind } }) as never
const debloquer = (args: string) =>
  ({
    command: 'usage-pace:debloquer',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  }) as never

test('ta session, Session à 85 % : rien n’est refusé, un rappel ; ton sous-agent, lui, s’arrête', async ($, on) => {
  const state = engine(on)
  await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.submit(prompt('composer'))
  const bash = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(bash.deny).toBeUndefined()
  expect(String(bash.context?.[0])).toContain("rien n'est bloqué")
  const sub = await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as never)
  expect(String(sub.deny)).toContain('Pause : quota Session à 85 %')
  // et ta session ne se met pas en pause pour autant : aucune relance automatique
  const { submitted } = state
  await $.turn.complete(turn('t1'))
  await state.clock.advance(2 * HOUR)
  expect(submitted.length).toBe(1)
})

test('agent lancé par une tâche planifiée : arrêt, pause, relance après le reset', async ($, on) => {
  const { clock, submitted } = engine(on)
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: false } as never)
  await $.prompt.submit(prompt('scheduled-trigger'))
  const bash = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(String(bash.deny)).toContain('Pause : quota Session à 85 %')
  const quotas = await $.tool.call({ tool: 'mcp__usage-pace-guard__quotas' } as never)
  expect(String(quotas.result)).toContain('Mode : agent')
  await $.turn.complete(turn('t1'))
  expect(submitted.length).toBe(1)
  await clock.advance(1 * HOUR + 3 * MIN)
  expect(submitted.length).toBe(2)
  expect(submitted[1]).toContain('Reprends la tâche en cours')
})

test('USAGE_PACE_AGENT=1 : agent même quand le message vient du SDK', async ($, on) => {
  engine(on, { USAGE_PACE_AGENT: '1' })
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: false } as never)
  await $.prompt.submit(prompt('sdk'))
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeDefined()
})

test('/debloquer : lève l’arrêt tout de suite, relance la tâche en pause ; off le réactive', async ($, on) => {
  const { clock, files, submitted } = engine(on, { USAGE_PACE_AGENT: '1' })
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: false } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.turn.complete(turn('t1'))

  const r = await $.command.run(debloquer(''))
  expect(r.text).toContain('Garde-fou suspendu jusqu')
  expect(r.text).toContain('reset Session')
  expect(JSON.parse(files[SUSPENSION]!).until).toBe(NOW + HOUR)
  await clock.advance(1100)
  expect(submitted.at(-1)).toContain('Reprends la tâche en cours')
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
  const quotas = await $.tool.call({ tool: 'mcp__usage-pace-guard__quotas' } as never)
  expect(String(quotas.result)).toContain('Garde-fou suspendu jusqu')

  expect((await $.command.run(debloquer('off'))).text).toBe('Garde-fou réactivé.')
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeDefined()
})

test('/debloquer lancé dans une autre session : l’agent en pause reprend sans attendre le reset', async ($, on) => {
  const { clock, files, submitted } = engine(on, { USAGE_PACE_AGENT: '1' })
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: false } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.turn.complete(turn('t1'))
  const before = submitted.length

  files[SUSPENSION] = JSON.stringify({ until: NOW + 2 * HOUR })
  await clock.advance(31_000)
  expect(submitted.length).toBe(before + 1)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
})
