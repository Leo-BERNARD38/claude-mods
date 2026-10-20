// La session Claude Code en cours : compteurs, et ce qu'elle a pris sur tes limites.
import type { SessionStats, UsageLimit, UsageSnapshot } from '../types'
import { decimal, duration, joined, plural } from './format'
import type { Row, Seg } from './format'
import { WINDOWS, spentHere } from './limits'

/** Sous ce taux de cache, chaque message coûte nettement plus cher : on le signale. */
const CACHE_WARN = 60

export function emptyStats(startedAt: number): SessionStats {
  return {
    startedAt,
    turns: 0,
    tools: 0,
    files: [],
    cacheRead: 0,
    inputTotal: 0,
    time: { claude: 0, tools: 0, you: 0 },
    slow: {},
    base: {},
  }
}

/** Retient le premier relevé de chaque fenêtre (ou d'une fenêtre qui vient de repartir). */
export function withBase(stats: SessionStats, limits: UsageLimit[]): SessionStats {
  const base = { ...stats.base }
  for (const l of limits) {
    if (base[l.kind]?.resetsAt !== l.resetsAt) base[l.kind] = { p: l.percentUsed, resetsAt: l.resetsAt }
  }
  return { ...stats, base }
}

/** Compte un appel d'outil : son temps (s'il n'a pas attendu ton accord) et le fichier modifié. */
export function withTool(
  stats: SessionStats,
  call: { key: string; ms: number; file?: string; timed: boolean },
) {
  const slow = call.timed
    ? {
        ...stats.slow,
        [call.key]: { ms: (stats.slow[call.key]?.ms ?? 0) + call.ms, n: (stats.slow[call.key]?.n ?? 0) + 1 },
      }
    : stats.slow
  const files = call.file && !stats.files.includes(call.file) ? [...stats.files, call.file] : stats.files
  return { ...stats, tools: stats.tools + 1, slow, files }
}

/** Compte un échange : sa répartition de temps et ses tokens d'entrée (pour le taux de cache). */
export function withTurn(
  stats: SessionStats,
  time: SessionStats['time'],
  usage?: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): SessionStats {
  return {
    ...stats,
    turns: stats.turns + 1,
    time: {
      claude: stats.time.claude + time.claude,
      tools: stats.time.tools + time.tools,
      you: stats.time.you + time.you,
    },
    cacheRead: stats.cacheRead + (usage?.cache_read_input_tokens ?? 0),
    inputTotal:
      stats.inputTotal +
      (usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0),
  }
}

/** Ligne "Ici" : durée, échanges, outils, fichiers, cache, ce que la session a pris, coût. */
export function sessionRow(
  snap: UsageSnapshot,
  stats: SessionStats | null,
  now: number,
  compact: boolean,
): Row | null {
  if (!stats) return null
  const parts: Seg[] = [
    { text: duration(now - stats.startedAt), tone: 'dim' },
    { text: plural(stats.turns, 'échange'), tone: 'dim' },
  ]
  if (!compact) parts.push({ text: plural(stats.tools, 'outil'), tone: 'dim' })
  if (stats.files.length) {
    const n = stats.files.length
    parts.push({ text: `${plural(n, 'fichier')} modifié${n > 1 ? 's' : ''}`, tone: 'dim' })
  }
  if (!compact && stats.inputTotal > 0) {
    const hit = (stats.cacheRead / stats.inputTotal) * 100
    parts.push({ text: `cache ${Math.round(hit)}%`, tone: hit < CACHE_WARN ? 'warn' : 'dim' })
  }
  const spent = snap.limits.flatMap(l => {
    const d = spentHere(l, stats)
    const window = WINDOWS[l.kind]
    return d && d > 0 && window ? [`+${decimal(d)}% ${window.label.toLowerCase()}`] : []
  })
  if (spent.length) parts.push({ text: `a pris ${spent.join(', ')}`, tone: 'dim' })
  if (!compact && snap.usd)
    parts.push({ text: `≈ ${snap.usd.toFixed(2).replace('.', ',')} $ au prix API`, tone: 'dim' })

  return { label: 'Ici', bar: [], detail: joined(parts) }
}
