// Assemble les lignes du bandeau, et leur version texte pour /rythme.
import type { SessionStats, UsageSnapshot } from '../types'
import { contextRows } from './context'
import type { Row } from './format'
import { limitRows } from './limits'
import { sessionRow } from './session'
import { timeRow } from './timing'

export const NO_DATA = 'Pas encore de mesure : envoie un premier message à Claude.'

export function rows(snap: UsageSnapshot, stats: SessionStats | null, now: number, compact: boolean): Row[] {
  return [
    ...limitRows(snap.limits, stats, now, compact),
    ...contextRows(snap, compact),
    sessionRow(snap, stats, now, compact),
    timeRow(stats, compact),
  ].filter((r): r is Row => r !== null)
}

/** Le même contenu, une ligne de texte par ligne du bandeau. */
export function summary(snap: UsageSnapshot, stats: SessionStats | null, now: number): string {
  const list = rows(snap, stats, now, false)
  if (!list.length) return NO_DATA
  return list
    .map(r => {
      const detail = r.detail.map(s => s.text).join('')
      return [`${r.label.trim()} :`, r.pct?.text, r.verdict && `— ${r.verdict.text}`, detail && `(${detail})`]
        .filter(Boolean)
        .join(' ')
    })
    .join('\n')
}
