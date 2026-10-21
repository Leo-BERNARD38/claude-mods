// Le contexte : remplissage, composition, et prochaine compaction automatique.
import type { CtxPart, UsageSnapshot } from '../types'
import { filledStack, gauge, joined, plural, stacked, tokens } from './format'
import type { Row, Seg, Tone } from './format'

// des couleurs à part : la ligne Temps a déjà le cyan, le violet et le jaune
const PARTS: Record<CtxPart, { tone: Tone; glyph: string }> = {
  conversation: { tone: 'blue', glyph: '█' },
  MCP: { tone: 'pink', glyph: '▓' },
  instructions: { tone: 'teal', glyph: '▒' },
  skills: { tone: 'orange', glyph: '▒' },
  système: { tone: 'dim', glyph: '░' },
}

/** Seuils de couleur du remplissage, en %. */
const FILL = { warn: 60, bad: 80 }
/** Le serveur MCP le plus lourd n'est cité qu'au-delà de ce poids. */
const MCP_NOTABLE = 3000
/** En dessous de cette croissance par échange, on ne prédit pas de compaction. */
const MIN_GROWTH = 500
/** Une baisse de plus de 30 % d'un coup, c'est une compaction : on repart de zéro. */
const COMPACTION_DROP = 0.7
const SERIES_LENGTH = 8
/** La compaction n'est annoncée que lorsqu'elle est à au plus ce nombre d'échanges. */
const SOON = 5

/** Range une ligne de /context dans une famille parlante. */
export function partOf(name: string): CtxPart {
  const n = name.toLowerCase()
  if (n.includes('message')) return 'conversation'
  if (n.includes('mcp')) return 'MCP'
  if (n.includes('memory') || n.includes('claude.md')) return 'instructions'
  if (n.includes('skill') || n.includes('agent') || n.includes('command')) return 'skills'
  return 'système'
}

/** Totalise les lignes occupées de /context par famille, de la plus grosse à la plus petite. */
export function groupParts(categories: { name: string; tokens: number; kind: string }[]) {
  const totals = new Map<CtxPart, number>()
  for (const c of categories) {
    if (c.kind !== 'used' || c.tokens <= 0) continue
    const part = partOf(c.name)
    totals.set(part, (totals.get(part) ?? 0) + c.tokens)
  }
  return [...totals].map(([key, tokens]) => ({ key, tokens })).sort((a, b) => b.tokens - a.tokens)
}

/** Le serveur MCP dont les outils chargés pèsent le plus. */
export function topMcp(tools: { serverName: string; tokens: number; isLoaded: boolean }[]) {
  const totals = new Map<string, number>()
  for (const t of tools) if (t.isLoaded) totals.set(t.serverName, (totals.get(t.serverName) ?? 0) + t.tokens)
  const [name, weight] = [...totals].sort((a, b) => b[1] - a[1])[0] ?? []
  return name && weight ? { name, tokens: weight } : undefined
}

/** Ajoute une taille de contexte à la série ; repart de zéro après une compaction. */
export function nextSeries(series: number[] = [], current: number): number[] {
  const last = series[series.length - 1]
  if (last === current) return series
  if (last !== undefined && current < last * COMPACTION_DROP) return [current]
  return [...series, current].slice(-SERIES_LENGTH)
}

/** Échanges restants avant la compaction automatique, d'après la croissance récente. */
export function turnsToCompact(series: number[] | undefined, compactAt: number | undefined): number | null {
  if (!series || series.length < 3 || !compactAt) return null
  const first = series[0]!
  const last = series[series.length - 1]!
  const growth = (last - first) / (series.length - 1)
  if (growth <= MIN_GROWTH) return null
  return Math.max(0, Math.floor((compactAt - last) / growth))
}

export function contextRows(snap: UsageSnapshot, compact: boolean): Row[] {
  if (snap.ctx === undefined) return []
  const tone: Tone = snap.ctx >= FILL.bad ? 'bad' : snap.ctx >= FILL.warn ? 'warn' : 'ok'
  const fill: Row = {
    label: 'Contexte',
    bar: gauge(snap.ctx, tone),
    meter: { kind: 'gauge', pct: snap.ctx, tone },
    pct: { text: `${Math.round(snap.ctx)}%`, tone },
    detail:
      snap.ctxTokens !== undefined && snap.ctxWindow
        ? [
            {
              text: `${tokens(snap.ctxTokens)} / ${tokens(snap.ctxWindow)} tokens`,
              tone: tone === 'ok' ? 'dim' : tone,
            },
          ]
        : [],
  }
  const parts = compositionRow(snap, compact)
  return parts ? [fill, parts] : [fill]
}

/** En version graphique : une seule jauge, remplie à hauteur du contexte et découpée par composition. */
export function contextGraph(snap: UsageSnapshot): Row | null {
  const [fill] = contextRows(snap, true)
  const parts = snap.ctxParts
  if (fill && snap.ctxTokens !== undefined) fill.tail = { text: tokens(snap.ctxTokens), tone: 'dim' }
  if (!fill || snap.ctx === undefined || !parts?.length) return fill ?? null
  return {
    ...fill,
    bar: filledStack(
      parts.map(p => ({ value: p.tokens, tone: PARTS[p.key].tone })),
      snap.ctx,
    ),
    meter: {
      kind: 'stack',
      fill: snap.ctx,
      parts: parts.map(p => ({ name: p.key, value: p.tokens, tone: PARTS[p.key].tone })),
    },
  }
}

/** Ligne "dont" : de quoi est fait le contexte, et quand la compaction arrivera. */
function compositionRow(snap: UsageSnapshot, compact: boolean): Row | null {
  const parts = snap.ctxParts
  const top = parts?.[0]
  if (!parts || !top) return null
  const total = parts.reduce((sum, p) => sum + p.tokens, 0)

  const detail: Seg[] = parts.slice(0, compact ? 3 : 5).map(p => {
    let text = `${p.key} ${tokens(p.tokens)}`
    const mcp = snap.mcpTop
    if (p.key === 'MCP' && mcp && mcp.tokens >= MCP_NOTABLE && !compact)
      text += ` (dont ${mcp.name} ${tokens(mcp.tokens)})`
    return { text, tone: PARTS[p.key].tone }
  })

  const left = turnsToCompact(snap.ctxSeries, snap.compactAt)
  const verdict: Seg =
    left === null || left > SOON
      ? { text: `surtout : ${top.key}`, tone: PARTS[top.key].tone }
      : {
          text: left === 0 ? 'compaction imminente' : `compaction dans ≈ ${plural(left, 'échange')}`,
          tone: 'warn',
        }

  return {
    label: '  dont',
    bar: stacked(parts.map(p => ({ value: p.tokens, ...PARTS[p.key] }))),
    meter: {
      kind: 'stack',
      parts: parts.map(p => ({ name: p.key, value: p.tokens, tone: PARTS[p.key].tone })),
    },
    pct: { text: `${Math.round((top.tokens / total) * 100)}%`, tone: PARTS[top.key].tone },
    verdict,
    detail: joined(detail),
  }
}
