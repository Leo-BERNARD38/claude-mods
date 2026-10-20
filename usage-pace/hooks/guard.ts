// Le garde-fou : Claude lit lui-même ses limites, ralentit au seuil, s'arrête avant la coupure,
// et reprend tout seul quand la fenêtre est repartie.
//   seuil (80 %)        → rappel dans les résultats d'outils : finis l'étape, note l'avancement, arrête-toi
//   seuil d'arrêt (90 %) → les outils sont refusés, sauf de quoi noter l'avancement
//   reset passé          → la tâche est relancée par un prompt automatique
import type { UsageLimit } from '../types'
import { duration } from './format'
import { WINDOWS, pace, verdict } from './limits'

export type GuardConfig = { warnAt: number; stopAt: number; resume: boolean }
export type GuardLevel = 'ok' | 'warn' | 'stop'

export type GuardStatus = {
  level: GuardLevel
  /** la limite la plus entamée */
  worst?: { label: string; used: number }
  /** quand toutes les limites au-dessus du seuil seront reparties (ms epoch) */
  resumeAt?: number
}

/** Le nom court de l'outil que Claude appelle (mcp__usage-pace__quotas). */
export const TOOL = 'quotas'
/** Ce qui reste permis à l'arrêt : de quoi noter où on en est, et relire les quotas. */
const ALLOWED_WHEN_STOPPED = new Set([
  'Write',
  'Edit',
  'Read',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
])
/** Laisser au serveur le temps de rouvrir la fenêtre avant de relancer. */
const RESUME_MARGIN_MS = 2 * 60_000
/** Le rappel revient tous les N appels d'outils tant qu'on est au-dessus du seuil. */
export const REMIND_EVERY = 15

/** Le % réellement en cours : une fenêtre dont le reset est passé est repartie de zéro. */
export function current(limit: UsageLimit, now: number): number {
  const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  return !Number.isNaN(reset) && reset <= now ? 0 : limit.percentUsed
}

export function config(options: Readonly<Record<string, unknown>>): GuardConfig {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 && v <= 100 ? v : d)
  const warnAt = num(options.seuil, 80)
  const stopAt = Math.max(warnAt, num(options.seuil_arret, 90))
  return { warnAt, stopAt, resume: options.reprise_auto !== false }
}

export function guardStatus(limits: UsageLimit[], cfg: GuardConfig, now: number): GuardStatus {
  let level: GuardLevel = 'ok'
  let worst: GuardStatus['worst']
  let resumeAt: number | undefined
  for (const l of limits) {
    const w = WINDOWS[l.kind]
    if (!w) continue
    const used = current(l, now)
    if (!worst || used > worst.used) worst = { label: w.label, used }
    if (used < cfg.warnAt) continue
    if (used >= cfg.stopAt) level = 'stop'
    else if (level === 'ok') level = 'warn'
    const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    if (!Number.isNaN(reset)) resumeAt = Math.max(resumeAt ?? 0, reset + RESUME_MARGIN_MS)
  }
  return { level, worst, resumeAt }
}

const pct = (n: number) => `${Math.round(n)} %`
const clock = (ms: number) =>
  new Date(ms).toLocaleString('fr-FR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  })

function resumeLine(s: GuardStatus, cfg: GuardConfig, now: number): string {
  if (!s.resumeAt) return ''
  const when = `${clock(s.resumeAt)} (dans ${duration(Math.max(0, s.resumeAt - now))})`
  return cfg.resume ? ` Reprise automatique prévue ${when}.` : ` La fenêtre repart ${when}.`
}

/** Ce que Claude lit après un résultat d'outil, au-dessus du seuil. */
export function reminder(s: GuardStatus, cfg: GuardConfig, now: number): string {
  const w = s.worst!
  return (
    `[usage-pace] Quota ${w.label} à ${pct(w.used)} (seuil ${pct(cfg.warnAt)}, arrêt à ${pct(cfg.stopAt)}). ` +
    `Ne lance pas de nouvelle étape lourde ni de sous-agent. Termine l'étape en cours, note l'avancement ` +
    `(ce qui est fait, ce qui reste, la prochaine action) dans un fichier, puis arrête-toi.` +
    resumeLine(s, cfg, now)
  )
}

/** Le refus d'un outil à l'arrêt, ou null s'il reste permis. */
export function stopDenial(tool: string, s: GuardStatus, cfg: GuardConfig, now: number): string | null {
  if (s.level !== 'stop' || ALLOWED_WHEN_STOPPED.has(tool) || tool.endsWith(`__${TOOL}`)) return null
  const w = s.worst!
  return (
    `[usage-pace] Pause : quota ${w.label} à ${pct(w.used)}, au-dessus du seuil d'arrêt (${pct(cfg.stopAt)}). ` +
    `Les outils sont suspendus pour garder de la marge. Note l'avancement dans un fichier (Write/Edit restent ` +
    `permis), puis termine ta réponse par un court point d'étape.` +
    resumeLine(s, cfg, now)
  )
}

/** Le prompt qui relance la tâche une fois les fenêtres reparties. */
export function resumePrompt(limits: UsageLimit[], now: number): string {
  const state = limits
    .filter(l => WINDOWS[l.kind])
    .map(l => `${WINDOWS[l.kind]!.label} ${pct(current(l, now))}`)
    .join(', ')
  return (
    `[usage-pace] Les quotas sont repassés sous le seuil (${state}). Reprends la tâche en cours là où tu ` +
    `t'étais arrêté : relis d'abord ton fichier d'avancement s'il existe, puis continue.`
  )
}

/** La réponse de l'outil quotas : de quoi décider seul s'il faut ralentir. */
export function report(limits: UsageLimit[], cfg: GuardConfig, now: number, paused?: number): string {
  const lines = limits.flatMap(l => {
    const p = pace({ ...l, percentUsed: current(l, now) }, now)
    if (!p) return []
    const reset =
      l.resetsAt && Date.parse(l.resetsAt) > now
        ? `, reset ${clock(Date.parse(l.resetsAt))} (dans ${duration(p.leftMs)})`
        : ''
    return [
      `- ${p.label} : ${pct(p.used)} utilisé, temps écoulé ${pct(p.elapsed)}${reset} → ${verdict(p).text}`,
    ]
  })
  if (!lines.length)
    return 'Pas encore de mesure des limites (pas d’abonnement Pro/Max, ou aucune réponse reçue).'
  const s = guardStatus(limits, cfg, now)
  const advice = {
    ok: 'Sous le seuil : tu peux continuer.',
    warn: 'Au-dessus du seuil : finis l’étape en cours, note l’avancement, puis arrête-toi.',
    stop: 'Au-dessus du seuil d’arrêt : les outils sont suspendus, sauf Write/Edit pour noter l’avancement.',
  }[s.level]
  return [
    ...lines,
    `Garde-fou : seuil ${pct(cfg.warnAt)}, arrêt ${pct(cfg.stopAt)}, reprise auto ${cfg.resume ? 'oui' : 'non'}. ${advice}${resumeLine(s, cfg, now)}`,
    ...(paused ? [`En pause, relance prévue ${clock(paused)}.`] : []),
  ].join('\n')
}
