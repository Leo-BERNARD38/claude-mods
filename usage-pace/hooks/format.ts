// Briques d'affichage communes : unités, nombres, barres.

export type Tone = 'ok' | 'warn' | 'bad' | 'dim' | 'mark' | 'claude' | 'tools' | 'you' | 'blue'

/** Un morceau de texte et sa couleur. */
export type Seg = { text: string; tone: Tone }

/**
 * La même barre en chiffres, pour les surfaces qui dessinent de vraies jauges (l'app desktop) :
 * une jauge remplie avec le repère du temps écoulé, ou une barre empilée.
 */
export type Meter =
  | { kind: 'gauge'; pct: number; tone: Tone; marker?: number }
  | { kind: 'stack'; parts: { name: string; value: number; tone: Tone }[] }

/** Une ligne du bandeau : libellé, barre, pourcentage, verdict, détails. */
export type Row = {
  label: string
  bar: Seg[]
  meter?: Meter
  pct?: Seg
  verdict?: Seg
  detail: Seg[]
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const BAR_WIDTH = 10

/** 45s, 12min, 2h05, 3j4h */
export function duration(ms: number): string {
  if (ms > 0 && ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))}s`
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const mins = minutes % 60
  if (days) return `${days}j${hours}h`
  if (hours) return `${hours}h${String(mins).padStart(2, '0')}`
  return `${mins}min`
}

/** Nombre à la française : un chiffre après la virgule sous 10, entier au-dessus. */
export function decimal(x: number): string {
  if (x >= 10) return Math.round(x).toString()
  return x.toFixed(1).replace(/\.0$/, '').replace('.', ',')
}

/** 22k, 1,2M */
export function tokens(n: number): string {
  return n >= 1_000_000 ? `${decimal(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`
}

/** "1 échange", "3 échanges" */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

/** Intercale " · " entre des morceaux. */
export function joined(parts: Seg[]): Seg[] {
  return parts.flatMap((p, i) => (i ? [{ text: ' · ', tone: 'dim' as const }, p] : [p]))
}

/** Jauge remplie à `pct` %, avec un repère vertical à `marker` % (le temps écoulé). */
export function gauge(pct: number, tone: Tone, marker?: number, width = BAR_WIDTH): Seg[] {
  const filled = Math.round((clamp(pct, 0, 100) / 100) * width)
  const markAt = marker === undefined ? -1 : Math.min(width - 1, Math.floor((marker / 100) * width))
  const cells: Seg[] = Array.from({ length: width }, (_, i) =>
    i === markAt
      ? { text: '│', tone: 'mark' }
      : i < filled
        ? { text: '━', tone }
        : { text: '─', tone: 'dim' },
  )
  return merge(cells)
}

/** Barre empilée : chaque part prend une largeur proportionnelle à sa valeur. */
export function stacked(parts: { value: number; glyph: string; tone: Tone }[], width = BAR_WIDTH): Seg[] {
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  if (!total) return []
  let used = 0
  const cells: Seg[] = []
  parts.forEach((p, i) => {
    const isLast = i === parts.length - 1
    const n = isLast ? width - used : Math.min(width - used, Math.round((p.value / total) * width))
    used += n
    if (n > 0) cells.push({ text: p.glyph.repeat(n), tone: p.tone })
  })
  return merge(cells)
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

/** Fusionne les cases voisines de même couleur (moins d'éléments à dessiner). */
function merge(cells: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.tone === cell.tone && cell.tone !== 'mark') last.text += cell.text
    else out.push({ ...cell })
  }
  return out
}
