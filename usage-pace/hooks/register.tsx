// Le câblage : quels évènements de Claude Code alimentent quelles données.
// Les calculs sont dans limits / context / session / timing, le dessin dans band.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer, ToolCallInput } from 'claude-code'

import type { SessionStats, UsageSnapshot } from '../types'
import { band, bandApp, layoutFor, waiting } from './band'
import { groupParts, nextSeries, topMcp } from './context'
import { REMIND_EVERY, TOOL, config, guardStatus, reminder, report, resumePrompt, stopDenial } from './guard'
import type { GuardConfig } from './guard'
import { alerts } from './limits'
import { clockTime } from './format'
import { emptyStats, withBase, withTool, withTurn } from './session'
import { splitTurn, toolKey } from './timing'
import { NO_DATA, rows, summary } from './view'

const usage = atom({ plugin: 'usage-pace', key: 'usage' } as const, null)
const stats = atom({ plugin: 'usage-pace', key: 'stats' } as const, null)
const pending = atom({ plugin: 'usage-pace', key: 'pending' } as const, { spans: [], asked: [] })
const tick = atom({ plugin: 'usage-pace', key: 'tick' } as const, 0)
const guard = atom({ plugin: 'usage-pace', key: 'guard' } as const, { calls: 0, intervened: false })

/**
 * Redessin périodique, pour que les comptes à rebours avancent même sans activité.
 * Court, parce qu'il relance aussi les SVG : un volet rouvert sans reconnexion ne reste pas longtemps sans jauges.
 */
const REFRESH_MS = 5000
const ALERT_MS = 8000
const ALERTS_KEPT = 20

/** Après une reconnexion d'une surface, ses images sont relancées à ces délais (ms). */
const RETRY_IMAGES_MS = [1500]

/** Le dernier dessin du bandeau, pour le diagnostic de /rythme : sur quelle surface, à quelle largeur. */
let lastDraw: { surface: string; columns: number } | undefined
/** Les surfaces qui se sont (re)connectées depuis le chargement du mod, pour le même diagnostic. */
let attaches = 0
/** La version du mod, lue dans son manifeste au démarrage. */
let version = '?'

/** Un sous-agent, c'est Claude qui réfléchit : son temps reste du côté de Claude. */
const AGENT_TOOLS = new Set(['Agent', 'Task'])

function editedFile(e: ToolCallInput): string | undefined {
  if (e.tool === 'Edit' || e.tool === 'Write') return e.file_path
  if (e.tool === 'NotebookEdit') return e.notebook_path
  return undefined
}

/** Enregistre une mesure : limites, contexte et sa composition, puis alerte si ça va couper. */
async function measure($: EngineInterface, now: Pick<SessionUsage, 'rateLimits' | 'context' | 'cost'>) {
  const prev = await read($, usage)
  const fresh = now.rateLimits.length > 0
  // pas encore de limites (avant la première réponse) : on garde celles qu'on a, même anciennes
  const limits = fresh
    ? now.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    : (prev?.limits ?? [])
  const snap: UsageSnapshot = {
    ...prev,
    limits,
    limitsAt: fresh ? undefined : prev?.limitsAt,
    ctx: now.context.percent,
    ctxTokens: now.context.tokens,
    ctxWindow: now.context.window,
    usd: now.cost?.usd,
  }
  if (now.context.tokens !== undefined) {
    snap.ctxSeries = nextSeries(prev?.ctxSeries, now.context.tokens)
    // la composition, comme /context, estimée localement : aucune requête, aucun quota
    const breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (breakdown) {
      snap.ctxParts = groupParts(breakdown.categories)
      snap.mcpTop = topMcp(breakdown.mcpTools)
      snap.compactAt = breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined
    }
  }
  await update($, usage, () => snap)
  if (!fresh) return
  await share($, snap)
  await ensureStats($)
  // le point de départ de la session ne se prend que sur une vraie mesure
  await update($, stats, s => (s ? withBase(s, limits) : s))
  await alertOnce($, limits)
}

const sharedPath = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.usage-pace/quotas.json` : undefined
}

/**
 * Au démarrage, avant la première réponse, Claude Code ne connaît pas encore les limites :
 * on reprend le dernier relevé (celui d'une session précédente), sans les fenêtres déjà repassées.
 */
async function loadShared($: EngineInterface) {
  if ((await read($, usage))?.limits.length) return
  try {
    const path = await sharedPath($)
    if (!path) return
    const body = JSON.parse(await $.fs.read(path)) as { updatedAt?: string; limits?: UsageSnapshot['limits'] }
    const at = Date.parse(body.updatedAt ?? '')
    const now = await $.clock.now()
    const limits = (body.limits ?? []).filter(l => l.resetsAt && Date.parse(l.resetsAt) > now)
    if (Number.isNaN(at) || !limits.length) return
    await update($, usage, prev => ({ ...prev, limits, limitsAt: at }))
  } catch {
    // pas de relevé, ou illisible : on attendra la première réponse
  }
}

/**
 * Dépose les limites dans ~/.usage-pace/quotas.json, pour les Claude qui ne chargent pas le mod
 * (une session du mode projet reliée à ce PC, un script). `updatedAt` dit si c'est frais.
 */
async function readVersion($: EngineInterface): Promise<string> {
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    return typeof manifest.version === 'string' ? manifest.version : '?'
  } catch {
    return '?'
  }
}

async function share($: EngineInterface, snap: UsageSnapshot) {
  try {
    const path = await sharedPath($)
    if (!path) return
    const g = await read($, guard)
    const body = {
      updatedAt: new Date(await $.clock.now()).toISOString(),
      limits: snap.limits,
      pausedUntil: g.paused,
    }
    await $.fs.write(path, JSON.stringify(body, null, 2))
  } catch {
    // best effort : le fichier partagé ne doit jamais casser le bandeau
  }
}

/** Une notification par fenêtre quand le rythme mène à la coupure. */
async function alertOnce($: EngineInterface, limits: UsageSnapshot['limits']) {
  const seen = (await $.store.get('alerted')) as string[] | undefined
  const fresh = alerts(limits, await $.clock.now()).filter(a => !seen?.includes(a.key))
  if (!fresh.length) return
  for (const a of fresh) $.ui.toast(`⚠ ${a.text}`, { timeoutMs: ALERT_MS })
  await $.store.set('alerted', [...(seen ?? []), ...fresh.map(a => a.key)].slice(-ALERTS_KEPT))
}

/** Les compteurs d'une session en cours survivent à un rechargement du mod, pas à une nouvelle session. */
function isCurrent(s: SessionStats | null, startedAt: number): s is SessionStats {
  return !!s && s.startedAt === startedAt && !!s.time && !!s.slow
}

/**
 * Garantit des compteurs pour la session en cours, et les remet à zéro quand elle a changé.
 * Indispensable après un /clear : Claude Code vide alors l'état du mod et démarre une nouvelle
 * session sans relancer `session.start`. Chaque évènement qui compte vérifie donc lui-même.
 */
async function ensureStats($: EngineInterface, startedAt?: number) {
  const current = startedAt ?? (await $.session.usage()).startedAt
  await update($, stats, s => (isCurrent(s, current) ? s : emptyStats(current)))
}

/** Le minuteur de reprise : une variable du module, réarmée depuis l'état après un rechargement. */
let resumeTimer: Timer | undefined

const limitsNow = async ($: EngineInterface) => (await read($, usage))?.limits ?? []

function clearPause($: EngineInterface) {
  resumeTimer?.cancel()
  resumeTimer = undefined
  $.ui.status(undefined)
  return update($, guard, g => ({ ...g, paused: undefined }))
}

/** Arme la relance pour `at` ; à l'échéance, vérifie que la fenêtre est vraiment repartie. */
function armResume($: EngineInterface, cfg: GuardConfig, at: number, now: number) {
  resumeTimer?.cancel()
  $.ui.status(`⏸ quotas : reprise auto vers ${clockTime(at)}`)
  resumeTimer = $.clock.after(Math.max(1000, at - now), () => void resume($, cfg))
}

async function resume($: EngineInterface, cfg: GuardConfig) {
  resumeTimer = undefined
  const fresh = (await $.session.usage()).rateLimits
  const limits = fresh.length ? fresh : await limitsNow($)
  const now = await $.clock.now()
  const s = guardStatus(limits, cfg, now)
  if (s.level !== 'ok' && s.resumeAt && s.resumeAt > now) {
    await update($, guard, g => ({ ...g, paused: s.resumeAt }))
    return armResume($, cfg, s.resumeAt, now)
  }
  await clearPause($)
  await update($, guard, g => ({ ...g, calls: 0 }))
  await $.prompt.submit({ text: resumePrompt(limits, now) })
}

/** Fin d'un échange où le garde-fou est intervenu : Claude s'est arrêté, on programme la relance. */
async function pauseIfStopped($: EngineInterface, cfg: GuardConfig) {
  const g = await read($, guard)
  await update($, guard, x => ({ ...x, intervened: false }))
  if (!g.intervened || !cfg.resume) return
  const now = await $.clock.now()
  const s = guardStatus(await limitsNow($), cfg, now)
  if (s.level === 'ok' || !s.resumeAt) return
  await update($, guard, x => ({ ...x, paused: s.resumeAt }))
  armResume($, cfg, s.resumeAt, now)
  $.ui.toast(
    `⏸ Pause quotas : ${s.worst?.label} à ${Math.round(s.worst?.used ?? 0)} %. Reprise automatique au reset.`,
  )
}

export const register: Register = (on, options) => {
  const cfg = config(options)

  // tu reprends la main : la relance automatique n'a plus lieu d'être
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin' && (await read($, guard)).paused) await clearPause($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    version = await readVersion($)
    await $.command.register({
      name: 'rythme',
      description: 'Résumé de tes limites Claude, du contexte et de la session en cours',
    })
    // un hôte qui ne prend pas les outils de plugin ne doit pas priver le bandeau de sa mesure
    await $.tool
      .register({
        name: TOOL,
        description:
          'Lit tes limites d’abonnement Claude (Session 5 h, Semaine 7 j) : % utilisé, heure du reset, rythme, ' +
          'et l’état du garde-fou (seuil, arrêt, reprise auto). Appelle-le avant une étape longue ou un lot de ' +
          'sous-agents, et régulièrement pendant une tâche longue, pour décider seul de ralentir ou de faire une pause.',
        inputSchema: { type: 'object', properties: {} },
        isDeferred: false,
      })
      .catch(() => undefined)
    const paused = (await read($, guard)).paused
    if (paused && cfg.resume) armResume($, cfg, paused, await $.clock.now())
    const now = await $.session.usage()
    await ensureStats($, now.startedAt)
    if (!now.rateLimits.length) await loadShared($)
    await measure($, now)
    $.clock.every(REFRESH_MS, () => void update($, tick, n => n + 1))
    return result
  })

  // un volet qui se rouvre : ses images peuvent rester en texte de remplacement, on les relance
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    attaches += 1
    const redraw = () => void update($, tick, n => n + 1)
    redraw()
    for (const ms of RETRY_IMAGES_MS) $.clock.after(ms, redraw)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)
    return next(e)
  })

  // repère les appels qui vont attendre ton accord, pour ranger leur durée dans "toi"
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    const id = e.tool_use_id
    if (result.decision === 'ask' && id) await update($, pending, p => ({ ...p, asked: [...p.asked, id] }))
    return result
  })

  // un seul hook d'outil : l'outil quotas, le garde-fou (refus à l'arrêt, rappels au seuil), puis le chrono
  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    const limits = await limitsNow($)
    if (e.tool === `mcp__usage-pace__${TOOL}`) {
      return { result: report(limits, cfg, start, (await read($, guard)).paused) }
    }
    const level = guardStatus(limits, cfg, start)
    const deny = stopDenial(e.tool, level, cfg, start)
    if (deny) {
      await update($, guard, g => ({ ...g, intervened: true }))
      return { deny }
    }
    const result = await next(e)
    const end = await $.clock.now()

    const id = e.tool_use_id
    const { asked: waiting } = await read($, pending)
    const asked = !!id && waiting.includes(id)
    const isAgent = AGENT_TOOLS.has(e.tool)
    await update($, pending, p => ({
      spans: isAgent ? p.spans : [...p.spans, { start, end, asked }],
      asked: p.asked.filter(x => x !== id),
    }))

    await ensureStats($)
    const file = result.deny ? undefined : editedFile(e)
    const key = toolKey(e.tool, e.tool === 'Bash' ? e.command : undefined)
    await update($, stats, s =>
      s ? withTool(s, { key, ms: end - start, file, timed: !asked && !isAgent }) : s,
    )

    if (level.level === 'ok' || result.deny !== undefined || result.isError) return result
    const g = await read($, guard)
    const due = g.calls === 0 || g.calls >= REMIND_EVERY
    await update($, guard, x => ({ ...x, calls: due ? 1 : x.calls + 1, intervened: x.intervened || due }))
    return due ? { ...result, context: [...(result.context ?? []), reminder(level, cfg, start)] } : result
  })

  on('turn.complete', async ($, e, next) => {
    // un sous-agent termine aussi des "échanges" : seul celui de la conversation principale compte
    if (!e.agentId) {
      const { spans } = await read($, pending)
      const time = splitTurn(e.durationMs, spans)
      await update($, pending, () => ({ spans: [], asked: [] }))
      await ensureStats($)
      await update($, stats, s => (s ? withTurn(s, time, e.usage) : s))
      await pauseIfStopped($, cfg)
    }
    return next(e)
  })

  // /rythme : le même résumé en texte, utile dans l'extension VS Code où le bandeau ne s'affiche pas
  on('command.run', { command: 'rythme' }, async $ => {
    if (!(await read($, usage))) await measure($, await $.session.usage())
    const snap = await read($, usage)
    if (!snap) return { text: NO_DATA }
    const now = await $.clock.now()
    const garde = report(snap.limits, cfg, now, (await read($, guard)).paused)
      .split('\n')
      .filter(l => !l.startsWith('- '))
    const surfaces = (await $.session.surfaces().catch(() => [])).join(', ') || 'aucune'
    const drawn = lastDraw
      ? `dessiné pour ${lastDraw.surface} sur ${lastDraw.columns} colonnes`
      : 'pas encore dessiné'
    const affichage =
      `Affichage (usage-pace ${version}) : bandeau ${drawn} ; surfaces de la session : ${surfaces} ; ` +
      `reconnexions : ${attaches}`
    return { text: [summary(snap, await read($, stats), now), ...garde, affichage].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, usage)
    const current = await read($, stats)
    // s'abonner au redessin périodique ; il sert aussi de version aux SVG, pour relancer leurs images
    const n = await read($, tick)
    const kit = $.ui.resolve(e)

    if (!snap || (!snap.limits.length && snap.ctx === undefined)) return waiting(kit)
    lastDraw = { surface: e.surface, columns: e.props.bodyColumns }
    // en pleine largeur tout le texte ; dans un panneau étroit, les jauges seules
    const layout = layoutFor(e.props.bodyColumns)
    const lines = rows(snap, current, await $.clock.now(), layout)
    // là où l'on peut dessiner (app desktop, VS Code) : de vraies jauges ; au terminal, des caractères
    // résolue après le test : la surface restreinte, sa table a `Svg`
    if (e.surface !== 'terminal') return bandApp($.ui.resolve(e), lines, layout, e.props.bodyColumns, n)
    return band(kit, lines, layout, e.props.bodyColumns)
  })
}
