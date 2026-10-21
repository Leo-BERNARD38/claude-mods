// Dessin du bandeau : une ligne par Row, en colonnes alignées.
// Deux rendus : le terminal (barres en caractères) et les surfaces graphiques (jauges SVG).
import type { Elements, RenderSurface } from 'claude-code'

import { meterBar } from './format'
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
  pink: '#ec4899',
  teal: '#14b8a6',
  orange: '#f97316',
}

/** Largeur des colonnes, en caractères. */
const COLUMNS = { label: 10, bar: 11, pct: 6, verdict: 30 }

/** Toute la largeur : tout le texte ; sinon (panneau latéral, fenêtre étroite) : les jauges seules. */
export type Layout = 'wide' | 'graphs'

/** En dessous de cette largeur (en colonnes du bandeau), on ne garde que les jauges. */
const GRAPHS_BELOW = 110

export function layoutFor(columns: number): Layout {
  return columns >= GRAPHS_BELOW ? 'wide' : 'graphs'
}

/** En version graphique, la jauge prend toute la place entre le libellé et le %. */
function barCells(columns: number): number {
  return Math.max(COLUMNS.bar, columns - COLUMNS.label - COLUMNS.pct - 1)
}

/** Largeur indicative d'une case, en pixels : la jauge s'étire ensuite sur la place réelle. */
const CELL_PX = 9

type Draw = (s: Seg, key: string) => JSX.Element

/** Les jauges seules : libellé, barre, %. */
function graphRows({ Box, Text }: Kit, rows: Row[], seg: Draw, bar: (row: Row, i: number) => JSX.Element | null) {
  return (
    <Box key="usage-pace" flexDirection="column">
      {rows.map((row, i) => (
        <Box key={`row-${i}`} flexDirection="row" alignItems="center">
          <Box width={COLUMNS.label} flexShrink={0}>
            <Text dimColor>{row.label}</Text>
          </Box>
          {bar(row, i)}
          <Box width={COLUMNS.pct} flexShrink={0}>
            {row.pct ? seg(row.pct, `pct-${i}`) : <Text> </Text>}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Une barre en caractères, d'un seul tenant : coupée au bout plutôt que repliée sur deux lignes
 * là où ses caractères sont plus larges que prévu (une police qui n'est pas celle du terminal).
 */
function barText(Text: Kit['Text'], bar: Seg[], seg: Draw, i: number) {
  return (
    <Text wrap="truncate-end" mono>
      {bar.map((s, j) => seg(s, `bar-${i}-${j}`))}
    </Text>
  )
}

export function waiting({ Box, Text }: Kit) {
  return (
    <Box key="usage-pace">
      <Text dimColor>Limites : en attente de la première réponse…</Text>
    </Box>
  )
}

export function band({ Box, Text }: Kit, rows: Row[], layout: Layout, columns: number) {
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

  if (layout === 'graphs') {
    const width = barCells(columns)
    return graphRows({ Box, Text }, rows, seg, (row, i) => (
      <Box width={width + 1} flexShrink={0} flexDirection="row">
        {barText(Text, row.meter ? meterBar(row.meter, width) : row.bar, seg, i)}
      </Box>
    ))
  }

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
              {barText(Text, row.bar, seg, i)}
            </Box>
          )}
          {row.bar.length > 0 && (
            <Box width={COLUMNS.pct}>{row.pct ? seg(row.pct, `pct-${i}`) : <Text> </Text>}</Box>
          )}
          {row.bar.length > 0 && (
            <Box width={COLUMNS.verdict}>
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

/** Le bandeau des surfaces graphiques (app desktop, VS Code) : mêmes lignes, jauges SVG à la place des caractères. */
export function bandApp({ Box, Text, Svg }: AppKit, rows: Row[], layout: Layout, columns: number) {
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

  if (layout === 'graphs') {
    const width = barCells(columns)
    return graphRows({ Box, Text }, rows, seg, row => {
      const svg = row.meter && meterSvg(row.meter, row.label.trim(), width * CELL_PX, true)
      // sans largeur, la jauge prend celle de sa boîte : toute la place entre libellé et %
      return svg ? (
        <Box width={width + 1} paddingRight={1} flexShrink={0}>
          <Svg source={svg.source} alt={svg.alt} height={METER.height} />
        </Box>
      ) : null
    })
  }

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
              <Box width={COLUMNS.verdict}>
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
