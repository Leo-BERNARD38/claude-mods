// Le câblage du garde-fou : mesures, outil quotas, rappels, refus, pause, reprise, /usage-pace:debloquer.
// Les calculs sont dans guard.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, Timer } from 'claude-code'

import {
  REMIND_EVERY,
  RESUME_PROMPT,
  clock,
  config,
  denial,
  reminder,
  report,
  status,
  unlockUntil,
} from './guard'
import type { Config, Mode } from './guard'

const limits = atom({ plugin: 'usage-pace-guard', key: 'limits' } as const, [])
const mode = atom({ plugin: 'usage-pace-guard', key: 'mode' } as const, 'you')
const guard = atom({ plugin: 'usage-pace-guard', key: 'guard' } as const, { calls: 0, stopped: false })

/** Le message qui lance un tour vient d'un automatisme : la session est menée par un agent. */
const AGENT_ORIGINS = new Set<PromptOrigin['kind']>([
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'plugin',
])
/** Ni toi ni un agent : on garde le mode en cours. */
const NEUTRAL_ORIGINS = new Set<PromptOrigin['kind']>(['task-notification', 'unclassified'])

/** Pendant une pause, on regarde à ce rythme si /usage-pace:debloquer a été lancé ailleurs. */
const POLL_MS = 30_000
/** La suspension est relue au plus à ce rythme (elle est lue à chaque appel d'outil). */
const SUSPENSION_TTL_MS = 5_000

/** USAGE_PACE_AGENT=1 : toujours agent ; =0 : jamais bloqué. Lu au démarrage. */
let forced: Mode | undefined
let resumeTimer: Timer | undefined
let cache: { until?: number; at: number } | undefined

const suspensionFile = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.usage-pace/garde-fou.json` : undefined
}

/** /usage-pace:debloquer, posé depuis n'importe quelle session : un fichier, pour que tous les agents le voient. */
async function suspension($: EngineInterface, fresh = false): Promise<number | undefined> {
  const now = await $.clock.now()
  if (!fresh && cache && now - cache.at < SUSPENSION_TTL_MS) return cache.until
  let until: number | undefined
  try {
    const path = await suspensionFile($)
    const body = path ? (JSON.parse(await $.fs.read(path)) as { until?: unknown }) : {}
    if (typeof body.until === 'number' && body.until > now) until = body.until
  } catch {
    // pas de fichier : pas de suspension
  }
  cache = { until, at: now }
  return until
}

async function modeOf($: EngineInterface, agentId?: string): Promise<Mode> {
  if (forced) return forced
  // un sous-agent est un agent, même dans ta session
  return agentId ? 'agent' : read($, mode)
}

function clearPause($: EngineInterface) {
  resumeTimer?.cancel()
  resumeTimer = undefined
  $.ui.status(undefined)
  return update($, guard, g => ({ ...g, paused: undefined }))
}

function armResume($: EngineInterface, cfg: Config, at: number, now: number) {
  resumeTimer?.cancel()
  $.ui.status(`⏸ quotas : reprise auto vers ${clock(at)}`)
  resumeTimer = $.clock.after(Math.max(1000, at - now), () => void resume($, cfg))
}

/** À l'échéance (ou après /usage-pace:debloquer) : relance si le quota le permet, sinon réarme. */
async function resume($: EngineInterface, cfg: Config) {
  const fresh = (await $.session.usage()).rateLimits
  if (fresh.length) await update($, limits, () => fresh.map(l => ({ ...l })))
  const now = await $.clock.now()
  const s = status(await read($, limits), cfg, now, 'agent', await suspension($, true))
  if (s.level === 'stop' && s.resumeAt && s.resumeAt > now) {
    await update($, guard, g => ({ ...g, paused: s.resumeAt }))
    return armResume($, cfg, s.resumeAt, now)
  }
  await clearPause($)
  await update($, guard, g => ({ ...g, calls: 0 }))
  await $.prompt.submit({ text: RESUME_PROMPT })
}

/** Nom de la commande, préfixé comme le plugin pour être facile à retrouver : /usage-pace:debloquer. */
const CMD = 'usage-pace:debloquer'

export const register: Register = (on, options) => {
  const cfg = config(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const env = await $.env.get('USAGE_PACE_AGENT')
    forced = env === '1' ? 'agent' : env === '0' ? 'you' : undefined
    await $.command.register({
      name: CMD,
      description: `Lève l’arrêt des agents (quotas) : jusqu’au reset, ou /${CMD} 2h, ou /${CMD} off`,
    })
    await $.tool
      .register({
        name: 'quotas',
        description:
          'Lit tes limites d’abonnement Claude (Session 5 h, Semaine 7 j) : % utilisé, quota permis maintenant, ' +
          'reset, conseil (accélérer, ralentir). Appelle-le avant une étape longue ou un lot de sous-agents, ' +
          'et régulièrement pendant une tâche longue.',
        inputSchema: { type: 'object', properties: {} },
        isDeferred: false,
      })
      .catch(() => undefined)
    const usage = await $.session.usage()
    if (usage.rateLimits.length) await update($, limits, () => usage.rateLimits.map(l => ({ ...l })))
    const paused = (await read($, guard)).paused
    if (paused && cfg.resume) armResume($, cfg, paused, await $.clock.now())
    // une pause levée par /usage-pace:debloquer dans une autre session
    $.clock.every(POLL_MS, async () => {
      if ((await read($, guard)).paused && (await suspension($, true))) await resume($, cfg)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) await update($, limits, () => e.rateLimits.map(l => ({ ...l })))
    return next(e)
  })

  // qui mène la conversation : toi (message tapé) ou un agent (tâche planifiée, autre session…)
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (!NEUTRAL_ORIGINS.has(kind)) {
      const human = !AGENT_ORIGINS.has(kind)
      // un message d'agent glissé dans ton tour ne te transforme pas en agent
      if (human || !e.turnId) await update($, mode, () => (human ? 'you' : 'agent'))
      // tu reprends la main : la relance automatique n'a plus lieu d'être (sauf /usage-pace:debloquer, qui relance)
      if (human && e.command?.name !== CMD && (await read($, guard)).paused) await clearPause($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    const who = await modeOf($, e.agentId)
    const list = await read($, limits)
    const suspended = await suspension($)
    if (e.tool.startsWith('mcp__usage-pace-guard__')) {
      return { result: report(list, cfg, now, who, { paused: (await read($, guard)).paused, suspended }) }
    }
    const s = status(list, cfg, now, who, suspended)
    const deny = denial(e.tool, s, cfg, now)
    if (deny) {
      await update($, guard, g => ({ ...g, stopped: true }))
      return { deny }
    }
    const result = await next(e)
    if (s.level === 'ok' || result.deny !== undefined || result.isError) return result
    const g = await read($, guard)
    const due = g.calls === 0 || g.calls >= REMIND_EVERY
    await update($, guard, x => ({ ...x, calls: due ? 1 : x.calls + 1 }))
    return due ? { ...result, context: [...(result.context ?? []), reminder(s, who)] } : result
  })

  // fin d'un échange où des outils ont été refusés : pause, relance quand le quota le permet
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const g = await read($, guard)
      await update($, guard, x => ({ ...x, stopped: false }))
      const now = await $.clock.now()
      const s = status(await read($, limits), cfg, now, 'agent', await suspension($, true))
      // ta session ne se met jamais en pause, même si un de tes sous-agents s'est arrêté
      const agent = (await modeOf($)) === 'agent'
      if (agent && g.stopped && cfg.resume && s.level === 'stop' && s.resumeAt) {
        await update($, guard, x => ({ ...x, paused: s.resumeAt }))
        armResume($, cfg, s.resumeAt, now)
        $.ui.toast(
          `⏸ Pause quotas : ${s.worst?.label} à ${Math.round(s.worst?.used ?? 0)} %. Reprise ${clock(s.resumeAt)}.`,
        )
      }
    }
    return next(e)
  })

  on('command.run', { command: CMD }, async ($, e) => {
    const now = await $.clock.now()
    const r = unlockUntil(e.args, await read($, limits), cfg, now)
    if ('error' in r) return { text: r.error }
    const path = await suspensionFile($)
    if (!path) return { text: 'Pas de dossier personnel (HOME) où noter la suspension.' }
    if ('off' in r) {
      await $.fs.write(path, JSON.stringify({ setAt: now }, null, 2))
      cache = { at: now }
      return { text: 'Garde-fou réactivé.' }
    }
    const until = r.until
    await $.fs.write(path, JSON.stringify({ until, setAt: now }, null, 2))
    cache = { until, at: now }
    const wasPaused = (await read($, guard)).paused
    if (wasPaused) {
      await clearPause($)
      // pas depuis la commande elle-même (elle tient le tour) : juste après
      $.clock.after(1000, () => void $.prompt.submit({ text: RESUME_PROMPT }))
    }
    return {
      text:
        `Garde-fou suspendu jusqu'à ${clock(until)} (${r.why}), pour tous les agents de cette machine. ` +
        `${wasPaused ? 'La tâche en pause reprend. ' : ''}/${CMD} off pour le réactiver.`,
    }
  })
}
