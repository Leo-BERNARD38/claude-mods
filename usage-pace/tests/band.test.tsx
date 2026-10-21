// De bout en bout : le mod chargé par le moteur, ses hooks branchés sur de faux évènements.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DAY, H, MIN, NOW, at } from './fixtures'

const BAND = {
  plugin: 'usage-pace',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 150,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

type Node = { type: string; props: Record<string, unknown>; children?: unknown[] }

/** Les colonnes (enfants directs) de chaque ligne du bandeau. */
function columns(tree: unknown): Node[][] {
  const root = tree as Node
  return (root.children as Node[]).map(row => row.children as Node[])
}

const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 12, resetsAt: at(2 * H + 43 * MIN) },
  { kind: 'seven_day', percentUsed: 66, resetsAt: at(2 * DAY + 9 * H) },
]
const CONTEXT = { window: 200_000, tokens: 22_000, percent: 11 }

/** Ce que Claude Code répondrait : mesures, composition du contexte (comme /context). */
function engine(on: On, session = { startedAt: NOW }) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__usage-pace__quotas' } }) as never)
  on('session.start', () => ({ cwd: '/projet' }))
  on(
    'session.usage',
    () =>
      ({
        value: {
          startedAt: session.startedAt,
          rateLimits: RATE_LIMITS,
          context: {
            ...CONTEXT,
            breakdown: {
              categories: [
                { name: 'Messages', tokens: 12_000, kind: 'used' },
                { name: 'MCP tools', tokens: 6_000, kind: 'used' },
                { name: 'System prompt', tokens: 4_000, kind: 'used' },
              ],
              mcpTools: [{ name: 'search', serverName: 'github', tokens: 6_000, isLoaded: true }],
              isAutoCompactEnabled: true,
              autoCompactThreshold: 167_000,
            },
          },
        },
      }) as never,
  )
  return clock
}

test('le bandeau s’affiche sur terminal et desktop', async ($, on) => {
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: RATE_LIMITS, changed: ['context', 'rateLimits'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /dans le rythme/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /22k \/ 200k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MCP 6k \(dont github 6k\)/ })).toBeDefined()
    // chaque ligne aligne ses colonnes côte à côte : libellé, barre, %, verdict, détails
    const rows = columns(await ui.drawn())
    // terminal : barre en caractères sur 11 colonnes ; desktop : jauge SVG à largeur fixe en pixels
    const bar = surface === 'terminal' ? 11 : undefined
    expect(rows[0]?.map(c => c.props.width)).toEqual([10, bar, 6, 30, undefined])
    for (const row of rows) for (const col of row) expect(col.type).toBe('Box')
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'desktop') {
      // Session, Semaine, Contexte, composition : une jauge chacune
      expect(svgs.length).toBe(4)
      expect(svgs[0]?.props.alt).toBe('Session : 12 %, temps écoulé 46 %')
      expect(String(svgs[0]?.props.source)).toMatch(/^<svg [^>]*width="112"/)
      expect(svgs[3]?.props.alt).toBe('dont : conversation 55 %, MCP 27 %, système 18 %')
      expect(await ui.find({ type: 'Text', text: '━' })).toBeUndefined()
    } else {
      expect(svgs.length).toBe(0)
    }
    await ui.unmount()
  }
})

test('panneau étroit : les jauges seules, le contexte en une jauge découpée', async ($, on) => {
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: RATE_LIMITS, changed: ['context', 'rateLimits'] })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: 60 } })
    const rows = columns(await ui.drawn())
    // Session, Semaine, Contexte : libellé, jauge, %, temps restant (pas encore de Temps : aucun échange)
    expect(rows.length).toBe(3)
    for (const row of rows) expect(row.length).toBe(4)
    expect(await ui.find({ type: 'Text', text: /dans le rythme/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /tokens/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '11%' })).toBeDefined()
    // à droite : le temps avant le reset, et les tokens du contexte
    expect(await ui.find({ type: 'Text', text: '2h43' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2j9h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '22k' })).toBeDefined()
    // la jauge prend toute la place entre le libellé (10) et le % (6) suivi du temps restant (6)
    expect(rows[0]?.[1]?.props.width).toBe(38)
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'terminal') {
      expect(svgs.length).toBe(0)
    } else {
      // VS Code dessine les jauges comme l'app, sans largeur fixe : elles s'étirent
      expect(svgs.length).toBe(3)
      expect(svgs[0]?.props.width).toBeUndefined()
      expect(svgs[2]?.props.alt).toBe('Contexte : 11 %, dont conversation 55 %, MCP 27 %, système 18 %')
    }
    await ui.unmount()
  }
})

test('au démarrage, le dernier relevé s’affiche avant la première réponse', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__usage-pace__quotas' } }) as never)
  on('session.start', () => ({ cwd: '/projet' }))
  on('env.get', () => ({ value: '/home/toi' }) as never)
  on('fs.write', () => ({ value: undefined }) as never)
  on(
    'fs.read',
    () =>
      ({
        value: JSON.stringify({
          updatedAt: at(-12 * MIN),
          // la fenêtre déjà repassée n'est pas reprise
          limits: [...RATE_LIMITS, { kind: 'five_hour', percentUsed: 90, resetsAt: at(-MIN) }],
        }),
      }) as never,
  )
  on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: [], context: CONTEXT } }) as never)
  await $.session.start({ cwd: '/projet', surface: 'vscode', isInteractive: true } as never)

  const narrow = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, bodyColumns: 60 } })
  // « ~ » : un relevé d'avant cette session
  expect(await narrow.find({ type: 'Text', text: '~12%' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '~66%' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /90/ })).toBeUndefined()
  const wide = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /relevé il y a 12min/ })).toBeDefined()
})

test('un volet qui se rouvre : les images des jauges sont relancées, leur dessin ne change pas', async ($, on) => {
  const clock = engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: RATE_LIMITS, changed: ['context', 'rateLimits'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const svg = async () => (await ui.findAll({ type: 'Svg' }))[0]?.props as { source: string; alt: string }
  const before = await svg()

  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  const now = await svg()
  expect(now.source).not.toBe(before.source)
  expect(now.source.replace(/id="v\d+"/, '')).toBe(before.source.replace(/id="v\d+"/, ''))
  expect(now.alt).toBe(before.alt)

  // puis une nouvelle tentative peu après
  await clock.advance(1500)
  expect((await svg()).source).not.toBe(now.source)
  await ui.unmount()
})

test('/rythme répond en texte', async ($, on) => {
  engine(on)
  const r = await $.command.run({
    command: 'rythme',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(r.text).toMatch(/^Session : 12% — ✓ tu peux accélérer/)
  expect(r.text).toMatch(
    /Semaine : 66% — = dans le rythme \(temps écoulé 66% · reste 34% pour 2j9h ≈ 14%\/jour\)/,
  )
  expect(r.text).toMatch(/Contexte : 11% \(22k \/ 200k tokens\)/)
  // le diagnostic d'affichage : sur quelle surface le bandeau a été dessiné
  expect(r.text).toMatch(/Affichage \(usage-pace [0-9.?]+\) : bandeau .* ; reconnexions : 0/)
})

test('temps : un npm test de 40 s dans un échange de 1 min → 20 s pour Claude, 40 s pour les outils', async ($, on) => {
  const clock = engine(on)
  on('tool.call', async () => {
    await clock.sleep(40_000)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true } as never)

  const call = $.tool.call({ tool: 'Bash', command: 'cd app && npm test' } as never)
  await clock.advance(40_000)
  await call
  await $.turn.complete({
    answer: 'fini',
    durationMs: 60_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Claude 20s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'outils 40s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 échange/ })).toBeDefined()
  await ui.unmount()
})

test('/clear : les compteurs repartent de zéro et reviennent, sans nouveau session.start', async ($, on) => {
  // un /clear vide l'état du mod et ne relance pas session.start : on démarre donc sans lui
  const session = { startedAt: NOW }
  const clock = engine(on, session)
  on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const turn = (id: string) =>
    $.turn.complete({
      answer: '',
      durationMs: 10_000,
      isAborted: false,
      turnId: id,
      reason: 'answer',
    } as never)

  const measure = () =>
    $.session.measure({ context: CONTEXT, rateLimits: RATE_LIMITS, changed: ['context', 'rateLimits'] })
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
  await turn('t1')
  await turn('t2')
  await measure()
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /2 échanges/ })).toBeDefined()
  await ui.unmount()

  // /clear : nouvelle session, qui commence maintenant
  await clock.advance(60_000)
  session.startedAt = NOW + 60_000
  await turn('t3')
  await measure()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 échange/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0 outil/ })).toBeDefined()
  await ui.unmount()
})

test('garde-fou : à 92 % de session, Bash est refusé, Write passe, et l’outil quotas répond', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {} }))
  const high = [
    { kind: 'five_hour', percentUsed: 92, resetsAt: at(1 * H) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: at(3 * DAY) },
  ]
  await $.session.measure({ context: CONTEXT, rateLimits: high, changed: ['rateLimits'] })

  const bash = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(String(bash.deny)).toContain('Pause : quota Session à 92 %')

  const write = await $.tool.call({
    tool: 'Write',
    input: { file_path: 'PROGRESS.md', content: 'x' },
  } as never)
  expect(write.deny).toBeUndefined()

  const quotas = await $.tool.call({ tool: 'mcp__usage-pace__quotas' } as never)
  expect(String(quotas.result)).toContain('- Session : 92 % utilisé')
})

test('garde-fou : Claude s’arrête, et la tâche est relancée toute seule après le reset', async ($, on) => {
  const clock = engine(on)
  const submitted: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }))
  await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true } as never)
  const high = [
    { kind: 'five_hour', percentUsed: 92, resetsAt: at(1 * H) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: at(3 * DAY) },
  ]
  await $.session.measure({ context: CONTEXT, rateLimits: high, changed: ['rateLimits'] })

  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.turn.complete({
    answer: 'pause',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as never)
  expect(submitted).toEqual([])

  await clock.advance(1 * H + 3 * MIN)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Reprends la tâche en cours')
})

test('garde-fou : à 82 %, l’outil tourne et Claude reçoit le rappel une fois, pas à chaque appel', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {} }))
  const warm = [
    { kind: 'five_hour', percentUsed: 82, resetsAt: at(1 * H) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: at(3 * DAY) },
  ]
  await $.session.measure({ context: CONTEXT, rateLimits: warm, changed: ['rateLimits'] })
  const first = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(first.deny).toBeUndefined()
  expect(String(first.context?.[0])).toContain('Quota Session à 82 %')
  const second = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(second.context ?? []).toEqual([])
})
