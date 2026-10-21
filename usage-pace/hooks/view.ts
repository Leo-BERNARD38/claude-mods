// Assemble les lignes du bandeau, et leur version texte pour /rythme.
import type { SessionStats, UsageSnapshot } from '../types'
import type { Layout } from './band'
import { contextGraph, contextRows } from './context'
import type { Row } from './format'
import { limitRows } from './limits'
import { sessionRow } from './session'
import { timeRow } from './timing'

export const NO_DATA = 'Pas encore de mesure : envoie un premier message à Claude.'

export function rows(snap: UsageSnapshot, stats: SessionStats | null, now: number, layout: Layout): Row[] {
  if (layout === 'graphs') return graphs(snap, stats, now)
  return [
    ...limitRows(snap.limits, stats, now, false),
    ...contextRows(snap, false),
    sessionRow(snap, stats, now, false),
    timeRow(stats, false),
  ].filter((r): r is Row => r !== null)
}

/** Les quatre jauges : Session, Semaine, Contexte (rempli et découpé par composition), Temps. */
function graphs(snap: UsageSnapshot, stats: SessionStats | null, now: number): Row[] {
  return [...limitRows(snap.limits, stats, now, true), contextGraph(snap), timeRow(stats, true)].filter(
    (r): r is Row => r !== null && r.bar.length > 0,
  )
}

/** Le même contenu, une ligne de texte par ligne du bandeau. */
export function summary(snap: UsageSnapshot, stats: SessionStats | null, now: number): string {
  const list = rows(snap, stats, now, 'wide')
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
