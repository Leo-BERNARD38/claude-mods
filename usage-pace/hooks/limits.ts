// Limites Session (5 h) et Semaine (7 j).
// Le principe : comparer ce qu'il reste de quota à ce qu'il reste de temps.
//   reste 34 % du quota pour 34 % du temps → dans le rythme
//   reste 80 % du quota pour 40 % du temps → tu peux accélérer
import type { SessionStats, UsageLimit } from '../types'
import { DAY, HOUR, decimal, duration, gauge } from './format'
import type { Row, Seg, Tone } from './format'

export const WINDOWS: Record<string, { label: string; length: number }> = {
  five_hour: { label: 'Session', length: 5 * HOUR },
  seven_day: { label: 'Semaine', length: 7 * DAY },
}

/** Quota restant ÷ temps restant, seuils de chaque verdict. */
const RATIO = { roomy: 1.25, onPace: 0.9, tight: 0.8 }
/** Sous ce % de temps écoulé (et de quota consommé), il est trop tôt pour parler de rythme. */
const EARLY = { elapsed: 5, used: 20 }
/** Il faut avoir consommé au moins ce % de session pour estimer ce qu'elle coûte en semaine. */
const MIN_SESSION_SAMPLE = 3

export type Pace = {
  kind: string
  label: string
  /** % du quota consommé */
  used: number
  /** % du temps de la fenêtre écoulé */
  elapsed: number
  leftMs: number
  /** quota restant ÷ temps restant : 1 = dans le rythme, au-dessus = de la marge */
  ratio: number
  /** au rythme moyen depuis le début de la fenêtre : délai avant 100 %, s'il tombe avant le reset */
  emptyInMs?: number
}

export function pace(limit: UsageLimit, now: number): Pace | null {
  const window = WINDOWS[limit.kind]
  const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (!window || Number.isNaN(resetAt)) return null

  const leftMs = Math.min(window.length, Math.max(0, resetAt - now))
  const elapsedMs = window.length - leftMs
  const used = limit.percentUsed
  const timeLeft = (leftMs / window.length) * 100
  const result: Pace = {
    kind: limit.kind,
    label: window.label,
    used,
    elapsed: (elapsedMs / window.length) * 100,
    leftMs,
    ratio: timeLeft > 0 ? (100 - used) / timeLeft : Infinity,
  }
  if (used > 0 && used < 100 && elapsedMs > 0) {
    const emptyIn = ((100 - used) / used) * elapsedMs
    if (emptyIn < leftMs) result.emptyInMs = emptyIn
  }
  return result
}

/** level : 0 = de la marge, 1 = dans le rythme, 2 = un peu vite, 3 = va couper ou coupé */
export type Verdict = { text: string; tone: Tone; level: 0 | 1 | 2 | 3 }

export function verdict(p: Pace): Verdict {
  if (p.used >= 100) return { text: '⛔ limite atteinte', tone: 'bad', level: 3 }
  if (p.elapsed < EARLY.elapsed && p.used < EARLY.used)
    return { text: '✓ début de fenêtre', tone: 'ok', level: 0 }
  if (p.ratio >= RATIO.roomy) return { text: '✓ tu peux accélérer', tone: 'ok', level: 0 }
  if (p.ratio >= RATIO.onPace) return { text: '= dans le rythme', tone: 'ok', level: 1 }
  if (p.ratio >= RATIO.tight) return { text: '↓ ralentis un peu', tone: 'warn', level: 2 }
  return { text: '⚠ ralentis, ça va couper', tone: 'bad', level: 3 }
}

/** Ce que la session Claude Code a pris sur une limite depuis son début (null si la fenêtre a changé). */
export function spentHere(limit: UsageLimit, stats: SessionStats | null): number | null {
  const base = stats?.base[limit.kind]
  if (!base || base.resetsAt !== limit.resetsAt) return null
  return limit.percentUsed - base.p
}

/** Combien de % de semaine coûte 1 % de session, d'après ce que cette session a consommé. */
export function weekPerSession(limits: UsageLimit[], stats: SessionStats | null): number | null {
  const find = (kind: string) => limits.find(l => l.kind === kind)
  const session = find('five_hour')
  const week = find('seven_day')
  const ds = session && spentHere(session, stats)
  const dw = week && spentHere(week, stats)
  if (ds == null || dw == null || ds < MIN_SESSION_SAMPLE) return null
  return Math.max(0, dw) / ds
}

export function limitRows(
  limits: UsageLimit[],
  stats: SessionStats | null,
  now: number,
  compact: boolean,
  /** les limites viennent d'un relevé d'avant cette session (ms epoch) : leur % peut avoir monté */
  readAt?: number,
): Row[] {
  const paces = limits.map(l => pace(l, now)).filter((p): p is Pace => p !== null)
  const week = paces.find(p => p.kind === 'seven_day')
  const weekIsTight = !!week && verdict(week).level >= 2
  const costRatio = weekPerSession(limits, stats)

  return paces.map(p => {
    let v = verdict(p)
    // accélérer sur la session n'a pas de sens si la semaine est juste
    if (p.kind === 'five_hour' && v.level <= 1 && weekIsTight) {
      v = { text: '✓ ok, mais la semaine est juste', tone: 'warn', level: 2 }
    }

    const left = 100 - p.used
    const detail: Seg[] = []
    if (readAt !== undefined && !compact) {
      detail.push({ text: `relevé il y a ${duration(now - readAt)} · `, tone: 'dim' })
    }
    if (!compact) detail.push({ text: `temps écoulé ${Math.round(p.elapsed)}% · `, tone: 'dim' })
    let rest = `reste ${Math.round(left)}% pour ${duration(p.leftMs)}`
    if (p.kind === 'seven_day' && p.leftMs > DAY) rest += ` ≈ ${decimal(left / (p.leftMs / DAY))}%/jour`
    detail.push({ text: rest, tone: 'dim' })
    if (p.emptyInMs !== undefined && v.level >= 2) {
      detail.push({ text: ` · vide dans ${duration(p.emptyInMs)}`, tone: v.tone })
    }
    // pour savoir si on peut rusher : vider la session coûterait combien de semaine ?
    if (!compact && p.kind === 'five_hour' && costRatio !== null && week) {
      const cost = costRatio * left
      detail.push({
        text: ` · vider ≈ ${Math.round(cost)}% de semaine`,
        tone: cost > 100 - week.used ? 'bad' : 'dim',
      })
    }

    return {
      label: p.label,
      bar: gauge(p.used, v.tone, p.elapsed),
      // arrondis : la jauge ne se redessine qu'à chaque point de %
      meter: { kind: 'gauge', pct: Math.round(p.used), tone: v.tone, marker: Math.round(p.elapsed) },
      // « ~ » : un relevé d'avant cette session, en attente de la première réponse
      pct: { text: `${readAt !== undefined ? '~' : ''}${Math.round(p.used)}%`, tone: v.tone },
      verdict: { text: v.text, tone: v.tone },
      detail,
      tail: { text: duration(p.leftMs), tone: 'dim' },
    }
  })
}

/** Une alerte par fenêtre quand le rythme mène à la coupure (clé = fenêtre + date de reset). */
export function alerts(limits: UsageLimit[], now: number): { key: string; text: string }[] {
  return limits.flatMap(limit => {
    const p = pace(limit, now)
    if (!p || p.used >= 100 || verdict(p).level < 3) return []
    const when = p.emptyInMs !== undefined ? `vide dans ${duration(p.emptyInMs)}` : 'ça va couper'
    return [
      {
        key: `${limit.kind}@${limit.resetsAt}`,
        text: `${p.label} : au rythme actuel, ${when} (reset dans ${duration(p.leftMs)})`,
      },
    ]
  })
}
