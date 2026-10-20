// Où passe le temps : Claude qui réfléchit, outils qui tournent, attente de ton accord.
import type { SessionStats, ToolSpan } from '../types'
import { duration, joined, stacked } from './format'
import type { Row, Seg, Tone } from './format'

/** Un outil qui a cumulé moins que ça n'est pas cité comme "le plus lent". */
const SLOW_ENOUGH = 5000
/** En dessous, il n'y a pas encore assez de temps mesuré pour afficher la ligne. */
const MIN_TOTAL = 1000

const BUCKETS = [
  { key: 'claude', name: 'Claude', short: 'Claude', glyph: '█', tone: 'claude' },
  { key: 'tools', name: 'les outils', short: 'outils', glyph: '▓', tone: 'tools' },
  { key: 'you', name: 'tes validations', short: 'toi', glyph: '░', tone: 'you' },
] as const satisfies readonly {
  key: keyof SessionStats['time']
  name: string
  short: string
  glyph: string
  tone: Tone
}[]

/** Nom court d'un appel d'outil : "npm test" pour Bash, "github create_pr" pour un MCP, sinon son nom. */
export function toolKey(tool: string, command?: string): string {
  if (tool === 'Bash') {
    const lastStep =
      (command ?? '')
        .split(/&&|\|\||;/)
        .map(s => s.trim())
        .filter(Boolean)
        .pop() ?? ''
    const words = lastStep.split(/\s+/).filter(w => w && !/^[A-Z_]+=/.test(w))
    return words.slice(0, 2).join(' ') || 'Bash'
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${mcp[1]} ${mcp[2]}` : tool
}

/** Durée couverte par des intervalles : des appels en parallèle ne comptent qu'une fois. */
export function covered(spans: { start: number; end: number }[]): number {
  let total = 0
  let reached = -Infinity
  for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
    if (end <= reached) continue
    total += end - Math.max(start, reached)
    reached = end
  }
  return total
}

/** Répartit la durée d'un échange entre Claude, les outils et l'attente de ton accord. */
export function splitTurn(durationMs: number, spans: ToolSpan[]): SessionStats['time'] {
  const all = covered(spans)
  const you = covered(spans.filter(s => s.asked))
  return { claude: Math.max(0, durationMs - all), tools: Math.max(0, all - you), you }
}

/** Ligne "Temps" : qui fait attendre, et l'outil le plus lent. */
export function timeRow(stats: SessionStats | null, compact: boolean): Row | null {
  if (!stats) return null
  const total = stats.time.claude + stats.time.tools + stats.time.you
  if (total < MIN_TOTAL) return null

  const top = [...BUCKETS].sort((a, b) => stats.time[b.key] - stats.time[a.key])[0]!
  const detail: Seg[] = BUCKETS.filter(b => b.key !== 'you' || stats.time.you > 0).map(b => ({
    text: `${b.short} ${duration(stats.time[b.key])}`,
    tone: b.tone,
  }))
  const slowest = Object.entries(stats.slow).sort((a, b) => b[1].ms - a[1].ms)[0]
  if (!compact && slowest && slowest[1].ms >= SLOW_ENOUGH) {
    const [name, { ms, n }] = slowest
    detail.push({ text: `plus lent : ${name} ${duration(ms)}${n > 1 ? ` (×${n})` : ''}`, tone: 'dim' })
  }

  return {
    label: 'Temps',
    bar: stacked(BUCKETS.map(b => ({ value: stats.time[b.key], glyph: b.glyph, tone: b.tone }))),
    meter: {
      kind: 'stack',
      parts: BUCKETS.map(b => ({ name: b.short, value: stats.time[b.key], tone: b.tone })),
    },
    pct: { text: `${Math.round((stats.time[top.key] / total) * 100)}%`, tone: top.tone },
    verdict: { text: `goulot : ${top.name}`, tone: top.tone },
    detail: joined(detail),
  }
}
