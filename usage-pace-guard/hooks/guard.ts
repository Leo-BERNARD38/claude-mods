// Le garde-fou : les calculs, sans effet de bord (testés seuls).
//
// Semaine : le quota permis suit le temps. Permis = % de temps écoulé + marge (14 points ≈ 1 jour),
//   plafonné à 100. Beaucoup de quota pour peu de jours : le permis est loin devant, Claude accélère.
//   Peu de quota pour beaucoup de jours : il bute sur le permis, et attend que le temps le rattrape.
// Session 5 h : les agents s'arrêtent à 80 %, pour te laisser 20 %.
// Le rappel « ralentis » arrive 5 points avant l'arrêt.
// Une session où c'est toi qui travailles n'est jamais bloquée : le rappel, au plus.
import type { UsageLimit } from '../types'

export type Config = {
  /** Semaine : avance permise sur le temps écoulé, en points */
  weekMargin: number
  /** Semaine : jamais au-delà */
  weekCap: number
  /** Session 5 h : arrêt des agents */
  sessionStop: number
  /** relancer la tâche toute seule quand le quota le permet de nouveau */
  resume: boolean
}

/** agent : rappel puis arrêt ; you : c'est toi qui travailles, rappel seulement. */
export type Mode = 'agent' | 'you'
export type Level = 'ok' | 'warn' | 'stop'

export type Window = {
  label: string
  used: number
  warnAt: number
  stopAt: number
  resetAt?: number
  /** % de temps écoulé dans la fenêtre */
  elapsed?: number
  /** quand la fenêtre repasse sous le rappel (ms epoch) */
  okAt?: number
}

export type Status = {
  level: Level
  /** la fenêtre la plus proche de son arrêt (ou la plus au-delà) */
  worst?: Window
  /** à l'arrêt : quand reprendre (ms epoch) */
  resumeAt?: number
  /** /usage-pace:debloquer : garde-fou suspendu jusqu'à (ms epoch) */
  suspended?: number
}

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

const WINDOWS: Record<string, { label: string; length: number }> = {
  five_hour: { label: 'Session', length: 5 * HOUR },
  seven_day: { label: 'Semaine', length: 7 * DAY },
}
/** Le rappel arrive ce nombre de points avant l'arrêt. */
export const WARN_BEFORE = 5
/** Le rappel revient tous les N appels d'outils. */
export const REMIND_EVERY = 15
/** Laisser au serveur le temps de rouvrir la fenêtre avant de relancer. */
const RESUME_MARGIN = 2 * MIN
/** Ce qui reste permis à l'arrêt : de quoi noter où on en est. */
const ALLOWED_WHEN_STOPPED = new Set([
  'Write',
  'Edit',
  'Read',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
])

export function config(options: Readonly<Record<string, unknown>>): Config {
  const num = (v: unknown, d: number, min: number) => (typeof v === 'number' && v >= min && v <= 100 ? v : d)
  return {
    weekMargin: num(options.semaine_marge, 14, 0),
    weekCap: num(options.semaine_plafond, 100, 1),
    sessionStop: num(options.session_arret, 80, 1),
    resume: options.reprise_auto !== false,
  }
}

/** Chaque fenêtre avec son % réel, son seuil de rappel et d'arrêt maintenant. */
export function windows(limits: UsageLimit[], cfg: Config, now: number): Window[] {
  return limits.flatMap(l => {
    const w = WINDOWS[l.kind]
    if (!w) return []
    const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    const resetAt = Number.isNaN(reset) ? undefined : reset
    // une fenêtre dont le reset est passé est repartie de zéro
    const used = resetAt !== undefined && resetAt <= now ? 0 : l.percentUsed
    const start = resetAt !== undefined ? resetAt - w.length : undefined
    const elapsed =
      start !== undefined ? Math.min(100, Math.max(0, ((now - start) / w.length) * 100)) : undefined

    let stopAt: number
    let okAt = resetAt !== undefined ? resetAt + RESUME_MARGIN : undefined
    if (l.kind === 'seven_day') {
      stopAt = Math.min(cfg.weekCap, (elapsed ?? 100) + cfg.weekMargin)
      // le permis monte avec le temps : on repasse sous le rappel quand temps + marge - 5 dépasse le %
      const need = used - cfg.weekMargin + WARN_BEFORE
      if (start !== undefined && used < cfg.weekCap - WARN_BEFORE) okAt = start + (need / 100) * w.length
    } else {
      stopAt = cfg.sessionStop
    }
    return [
      { label: w.label, used, warnAt: Math.max(0, stopAt - WARN_BEFORE), stopAt, resetAt, elapsed, okAt },
    ]
  })
}

export function status(
  limits: UsageLimit[],
  cfg: Config,
  now: number,
  mode: Mode,
  suspended?: number,
): Status {
  const list = windows(limits, cfg, now)
  const worst = list.reduce<Window | undefined>(
    (a, w) => (!a || w.used - w.stopAt > a.used - a.stopAt ? w : a),
    undefined,
  )
  if (suspended && suspended > now) return { level: 'ok', worst, suspended }
  const stopped = list.filter(w => w.used >= w.stopAt)
  if (stopped.length && mode === 'agent') {
    const resumeAt = Math.max(...stopped.map(w => w.okAt ?? now))
    return { level: 'stop', worst, resumeAt }
  }
  const level = list.some(w => w.used >= w.warnAt) ? 'warn' : 'ok'
  return { level, worst }
}

const pct = (n: number) => `${Math.round(n)} %`

/** 45s, 12min, 2h05, 3j4h */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MIN))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d) return `${d}j${h}h`
  if (h) return `${h}h${String(m).padStart(2, '0')}`
  return `${m}min`
}

/** « dim. 18:00 », à l'heure de Paris. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  })
}

const when = (at: number, now: number) => `${clock(at)} (dans ${duration(at - now)})`

/** Ce que Claude lit après un résultat d'outil, au-dessus du rappel. */
export function reminder(s: Status, mode: Mode): string {
  const w = s.worst!
  const head = `[usage-pace] Quota ${w.label} à ${pct(w.used)} (permis maintenant : ${pct(w.stopAt)}).`
  if (mode === 'you')
    return (
      `${head} Tu travailles avec la personne : rien n'est bloqué. Évite les lots de sous-agents ` +
      `et les étapes lourdes sans le lui dire.`
    )
  return (
    `${head} Ralentis : pas de nouveau lot de sous-agents ni d'étape lourde, tiens ton fichier ` +
    `d'avancement à jour. À ${pct(w.stopAt)}, les outils s'arrêtent.`
  )
}

/** Le refus d'un outil à l'arrêt, ou null s'il reste permis. */
export function denial(tool: string, s: Status, cfg: Config, now: number): string | null {
  if (s.level !== 'stop' || ALLOWED_WHEN_STOPPED.has(tool) || tool.endsWith('__quotas')) return null
  const w = s.worst!
  const resume = s.resumeAt
    ? cfg.resume
      ? ` Reprise automatique prévue ${when(s.resumeAt, now)}.`
      : ` Le quota le permet de nouveau ${when(s.resumeAt, now)}.`
    : ''
  return (
    `[usage-pace] Pause : quota ${w.label} à ${pct(w.used)}, permis maintenant ${pct(w.stopAt)}. ` +
    `Les outils sont suspendus pour garder de la marge. Note l'avancement dans un fichier (Write/Edit ` +
    `restent permis), puis termine ta réponse par un court point d'étape.${resume}`
  )
}

export const RESUME_PROMPT =
  `[usage-pace] Le quota le permet de nouveau. Reprends la tâche en cours là où tu t'étais arrêté : ` +
  `relis d'abord ton fichier d'avancement s'il existe, puis continue.`

/** La réponse de l'outil quotas : de quoi décider seul d'accélérer ou de ralentir. */
export function report(
  limits: UsageLimit[],
  cfg: Config,
  now: number,
  mode: Mode,
  extra: { paused?: number; suspended?: number } = {},
): string {
  const list = windows(limits, cfg, now)
  if (!list.length)
    return 'Pas encore de mesure des limites (pas d’abonnement Pro/Max, ou aucune réponse reçue).'
  const lines = list.map(w => {
    const reset = w.resetAt && w.resetAt > now ? `, reset ${when(w.resetAt, now)}` : ''
    const room = w.stopAt - w.used
    const advice =
      room > 2 * WARN_BEFORE
        ? 'de la marge, tu peux accélérer'
        : room > WARN_BEFORE
          ? 'dans le rythme'
          : 'ralentis'
    const perDay =
      w.label === 'Semaine' && w.resetAt && w.resetAt - now > DAY
        ? ` ; pour finir la semaine à ${pct(cfg.weekCap)} : ≈ ${pct((cfg.weekCap - w.used) / ((w.resetAt - now) / DAY))}/jour`
        : ''
    return `- ${w.label} : ${pct(w.used)} utilisé, permis maintenant ${pct(w.stopAt)}${reset} → ${advice}${perDay}`
  })
  const s = status(limits, cfg, now, mode, extra.suspended)
  const who =
    mode === 'you'
      ? 'Mode : session de la personne, jamais bloquée (rappel seulement).'
      : 'Mode : agent, arrêt au permis.'
  const rules =
    `Règles : Session, arrêt des agents à ${pct(cfg.sessionStop)} ; Semaine, permis = temps écoulé + ` +
    `${cfg.weekMargin} points (plafond ${pct(cfg.weekCap)}) ; rappel ${WARN_BEFORE} points avant.`
  return [
    ...lines,
    `${who} ${rules}`,
    ...(s.suspended
      ? [`Garde-fou suspendu jusqu'à ${clock(s.suspended)} (/usage-pace:debloquer off pour le réactiver).`]
      : []),
    ...(extra.paused ? [`En pause, relance prévue ${clock(extra.paused)}.`] : []),
  ].join('\n')
}

/** « 2h », « 30min », « 1h30 », « 45m », « 1j », « 2d » → ms ; null si illisible. */
export function parseDuration(text: string): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(?:(\d+)\s*[jd])?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|mn|m)?)?$/)
  if (!m || !text.trim()) return null
  const [, d = '0', h = '0', mn = '0'] = m
  const ms = +d * DAY + +h * HOUR + +mn * MIN
  return ms > 0 ? ms : null
}

/**
 * /usage-pace:debloquer : jusqu'à quand suspendre le garde-fou.
 * Sans argument : jusqu'au reset de la fenêtre qui bloque (ou qui rappelle, sinon la Session).
 */
export function unlockUntil(
  args: string,
  limits: UsageLimit[],
  cfg: Config,
  now: number,
): { until: number; why: string } | { off: true } | { error: string } {
  const arg = args.trim().toLowerCase()
  if (arg === 'off') return { off: true }
  if (arg) {
    const ms = parseDuration(arg)
    return ms
      ? { until: now + ms, why: `pour ${duration(ms)}` }
      : { error: `Durée illisible : « ${args.trim()} ». Exemples : 2h, 30min, 1h30, 1j, off.` }
  }
  const list = windows(limits, cfg, now).filter(w => w.resetAt && w.resetAt > now)
  const pick =
    [list.filter(w => w.used >= w.stopAt), list.filter(w => w.used >= w.warnAt)].find(g => g.length) ??
    list.filter(w => w.label === 'Session')
  const until = Math.max(...pick.map(w => w.resetAt!))
  if (!pick.length || !Number.isFinite(until))
    return { until: now + 5 * HOUR, why: 'pour 5h (pas de reset connu)' }
  return { until, why: `jusqu'au reset ${pick.map(w => w.label).join(' + ')}` }
}
