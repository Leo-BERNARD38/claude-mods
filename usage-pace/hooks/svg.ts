// Jauges en SVG pour l'app desktop : la même donnée que les barres en caractères du terminal.
// Les couleurs sont choisies pour rester lisibles en thème clair comme en thème sombre.
import type { Meter, Tone } from './format'

export const HEX: Record<Tone, string> = {
  ok: '#30a46c',
  warn: '#d99a0b',
  bad: '#e5484d',
  dim: '#8b8d98',
  mark: '#8b8d98',
  claude: '#0ea5c6',
  tools: '#a855f7',
  you: '#f59e0b',
  blue: '#3b82f6',
  pink: '#ec4899',
  teal: '#14b8a6',
  orange: '#f97316',
}

/** Taille d'une jauge, en pixels CSS. */
export const METER = { width: 112, height: 14, bar: 6 }

const TRACK = `fill="${HEX.dim}" fill-opacity="0.25"`

function clamp(x: number): number {
  return Math.min(100, Math.max(0, x))
}

/** Au pixel près : une jauge qui n'a pas bougé d'un pixel garde le même SVG. */
function round(x: number): number {
  return Math.round(x)
}

export type SvgOptions = {
  /** largeur en pixels (indicative quand la jauge s'étire) */
  width?: number
  /** la jauge s'étire sur la place qu'on lui donne */
  stretch?: boolean
  /** change la source sans changer le dessin, pour relancer une image que la surface n'a pas chargée */
  version?: number
}

/** Le SVG d'une jauge, et sa description pour qui ne la voit pas. */
export function meterSvg(
  meter: Meter,
  label: string,
  { width: w = METER.width, stretch = false, version = 0 }: SvgOptions = {},
): { source: string; alt: string } {
  const { height: h, bar } = METER
  const y = (h - bar) / 2
  const r = bar / 2
  const fit = stretch ? ' preserveAspectRatio="none"' : ''
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" id="v${version}" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}"${fit}>`
  const clip = `<clipPath id="c"><rect x="0" y="${y}" width="${w}" height="${bar}" rx="${r}"/></clipPath>`

  if (meter.kind === 'gauge') {
    const fill = round((clamp(meter.pct) / 100) * w)
    const parts = [
      open,
      clip,
      `<g clip-path="url(#c)"><rect x="0" y="${y}" width="${w}" height="${bar}" ${TRACK}/>`,
      `<rect x="0" y="${y}" width="${fill}" height="${bar}" fill="${HEX[meter.tone]}"/></g>`,
    ]
    let alt = `${label} : ${Math.round(meter.pct)} %`
    if (meter.marker !== undefined) {
      // le repère du temps écoulé dépasse de la barre, pour se lire même sur la partie remplie
      const x = round(Math.min(w - 2, Math.max(0, (clamp(meter.marker) / 100) * w - 1)))
      parts.push(`<rect x="${x}" y="0" width="2" height="${h}" rx="1" fill="${HEX.mark}"/>`)
      alt += `, temps écoulé ${Math.round(meter.marker)} %`
    }
    return { source: parts.join('') + '</svg>', alt }
  }

  const total = meter.parts.reduce((sum, p) => sum + p.value, 0)
  // le contexte : seule la partie remplie est découpée, le reste est la piste
  const span = meter.fill === undefined ? w : (clamp(meter.fill) / 100) * w
  const parts = [
    open,
    clip,
    `<g clip-path="url(#c)"><rect x="0" y="${y}" width="${w}" height="${bar}" ${TRACK}/>`,
  ]
  let x = 0
  for (const p of meter.parts) {
    if (!total || p.value <= 0) continue
    const pw = (p.value / total) * span
    // 1 px d'écart entre deux parts, pour les distinguer quand les couleurs sont proches
    parts.push(
      `<rect x="${round(x)}" y="${y}" width="${round(Math.max(0, pw - 1))}" height="${bar}" fill="${HEX[p.tone]}"/>`,
    )
    x += pw
  }
  parts.push('</g></svg>')
  const alt =
    `${label} : ` +
    (meter.fill === undefined ? '' : `${Math.round(meter.fill)} %, dont `) +
    meter.parts
      .filter(p => p.value > 0)
      .map(p => `${p.name} ${total ? Math.round((p.value / total) * 100) : 0} %`)
      .join(', ')
  return { source: parts.join(''), alt }
}
