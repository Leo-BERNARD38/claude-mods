// Dessin du bandeau : une ligne par Row, en colonnes alignées.
// Deux rendus : le terminal (barres en caractères) et l'app desktop (jauges SVG).
import type { Elements, RenderSurface } from 'claude-code'

import type { Row, Seg, Tone } from './format'
import { HEX, METER, meterSvg } from './svg'

type Kit = Pick<Elements[RenderSurface], 'Box' | 'Text'>
type AppKit = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg'>

const COLORS: Record<Tone, string | undefined> = {
  ok: 'green',
  warn: 'yellow',
  bad: 'red',
  dim: undefined,
  mark: undefined,
  claude: 'cyan',
  tools: 'magenta',
  you: 'yellow',
  blue: 'blue',
}

/** Largeur des colonnes, en caractères. */
const COLUMNS = { label: 10, bar: 11, pct: 6, verdict: 30, verdictCompact: 26 }

/**
 * Plus la place manque, moins on en dit :
 * - wide : tout sur une ligne ; compact : moins de détails ;
 * - narrow : chaque ligne sur deux, verdict et détails en dessous de la barre ;
 * - tiny : la barre, puis seulement le verdict (ou, à défaut, le détail).
 */
export type Layout = 'wide' | 'compact' | 'narrow' | 'tiny'

/** Paliers de largeur (en colonnes du bandeau) en dessous desquels on passe au mode suivant. */
const BELOW = { wide: 110, compact: 80, narrow: 50 }

export function layoutFor(columns: number): Layout {
  if (columns >= BELOW.wide) return 'wide'
  if (columns >= BELOW.compact) return 'compact'
  if (columns >= BELOW.narrow) return 'narrow'
  return 'tiny'
}

/** Ce qui va sous la barre en mode étroit : verdict et détails, ou seulement l'essentiel. */
function under(row: Row, layout: Layout): Seg[] {
  const verdict = row.verdict ? [row.verdict] : []
  if (layout === 'tiny') return verdict.length ? verdict : row.detail
  if (!verdict.length) return row.detail
  return row.detail.length ? [...verdict, { text: ' · ', tone: 'dim' }, ...row.detail] : verdict
}

type Draw = (s: Seg, key: string) => JSX.Element

/** Mode étroit : libellé + barre + % sur une ligne, le reste dessous, qui passe à la ligne au besoin. */
function stackedRows(
  { Box, Text }: Kit,
  rows: Row[],
  layout: Layout,
  seg: Draw,
  bar: (row: Row, i: number) => JSX.Element | null,
) {
  return (
    <Box key="usage-pace" flexDirection="column">
      {rows.map((row, i) => {
        const drawn = bar(row, i)
        const rest = under(row, layout)
        // une ligne sans barre (Ici) garde ses détails à côté du libellé
        if (!drawn) {
          return (
            <Box key={`row-${i}`} flexDirection="row">
              <Box width={COLUMNS.label} flexShrink={0}>
                <Text dimColor>{row.label}</Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" flexShrink={1}>
                {rest.map((s, j) => seg(s, `detail-${i}-${j}`))}
              </Box>
            </Box>
          )
        }
        return (
          <Box key={`row-${i}`} flexDirection="column">
            <Box flexDirection="row" alignItems="center">
              <Box width={COLUMNS.label} flexShrink={0}>
                <Text dimColor>{row.label}</Text>
              </Box>
              {drawn}
              <Box width={COLUMNS.pct} flexShrink={0}>
                {row.pct ? seg(row.pct, `pct-${i}`) : <Text> </Text>}
              </Box>
            </Box>
            {rest.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" paddingLeft={COLUMNS.label}>
                {rest.map((s, j) => seg(s, `under-${i}-${j}`))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export function waiting({ Box, Text }: Kit) {
  return (
    <Box key="usage-pace">
      <Text dimColor>Limites : en attente de la première réponse…</Text>
    </Box>
  )
}

export function band({ Box, Text }: Kit, rows: Row[], layout: Layout) {
  const seg = (s: Seg, key: string) => (
    <Text
      key={key}
      color={COLORS[s.tone]}
      dimColor={s.tone === 'dim'}
      bold={s.tone === 'mark'}
      wrap="truncate-end"
    >
      {s.text}
    </Text>
  )

  if (layout === 'narrow' || layout === 'tiny') {
    return stackedRows({ Box, Text }, rows, layout, seg, (row, i) =>
      row.bar.length > 0 ? (
        <Box width={COLUMNS.bar} flexShrink={0} flexDirection="row">
          {row.bar.map((s, j) => seg(s, `bar-${i}-${j}`))}
        </Box>
      ) : null,
    )
  }
  const compact = layout === 'compact'

  return (
    <Box key="usage-pace" flexDirection="column">
      {rows.map((row, i) => (
        <Box key={`row-${i}`} flexDirection="row">
          <Box width={COLUMNS.label}>
            <Text dimColor>{row.label}</Text>
          </Box>
          {/* pas de fragment <></> ici : le moteur l'empile en colonne au lieu de l'aplatir dans la ligne */}
          {row.bar.length > 0 && (
            <Box width={COLUMNS.bar} flexDirection="row">
              {row.bar.map((s, j) => seg(s, `bar-${i}-${j}`))}
            </Box>
          )}
          {row.bar.length > 0 && (
            <Box width={COLUMNS.pct}>{row.pct ? seg(row.pct, `pct-${i}`) : <Text> </Text>}</Box>
          )}
          {row.bar.length > 0 && (
            <Box width={compact ? COLUMNS.verdictCompact : COLUMNS.verdict}>
              {row.verdict ? seg(row.verdict, `verdict-${i}`) : <Text> </Text>}
            </Box>
          )}
          <Box flexDirection="row" flexShrink={1}>
            {row.detail.map((s, j) => seg(s, `detail-${i}-${j}`))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Dans l'app, les couleurs d'état suivent le thème ; les autres reprennent celles des jauges. */
const APP_COLORS: Record<Tone, string | undefined> = {
  ...HEX,
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  dim: undefined,
  mark: undefined,
}

/** Le bandeau de l'app desktop : mêmes lignes, jauges SVG à la place des caractères. */
export function bandApp({ Box, Text, Svg }: AppKit, rows: Row[], layout: Layout) {
  const seg = (s: Seg, key: string) => (
    <Text
      key={key}
      color={APP_COLORS[s.tone]}
      dimColor={s.tone === 'dim'}
      bold={s.tone === 'mark'}
      wrap="truncate-end"
    >
      {s.text}
    </Text>
  )

  if (layout === 'narrow' || layout === 'tiny') {
    return stackedRows({ Box, Text }, rows, layout, seg, row => {
      const svg = row.meter && meterSvg(row.meter, row.label.trim())
      return svg ? (
        <Box paddingRight={1} flexShrink={0}>
          <Svg source={svg.source} alt={svg.alt} width={METER.width} height={METER.height} />
        </Box>
      ) : null
    })
  }
  const compact = layout === 'compact'

  return (
    <Box key="usage-pace" flexDirection="column" rowGap={0}>
      {rows.map((row, i) => {
        const svg = row.meter && meterSvg(row.meter, row.label.trim())
        return (
          <Box key={`row-${i}`} flexDirection="row" alignItems="center">
            <Box width={COLUMNS.label}>
              <Text dimColor>{row.label}</Text>
            </Box>
            {svg && (
              <Box paddingRight={1}>
                <Svg source={svg.source} alt={svg.alt} width={METER.width} height={METER.height} />
              </Box>
            )}
            {svg && <Box width={COLUMNS.pct}>{row.pct ? seg(row.pct, `pct-${i}`) : <Text> </Text>}</Box>}
            {svg && (
              <Box width={compact ? COLUMNS.verdictCompact : COLUMNS.verdict}>
                {row.verdict ? seg(row.verdict, `verdict-${i}`) : <Text> </Text>}
              </Box>
            )}
            <Box flexDirection="row" flexShrink={1}>
              {row.detail.map((s, j) => seg(s, `detail-${i}-${j}`))}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
