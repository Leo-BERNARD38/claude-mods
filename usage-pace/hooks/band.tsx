// Dessin du bandeau : une ligne par Row, en colonnes alignées.
// Une seule mise en page ; seule la barre change : en caractères au terminal, en SVG ailleurs.
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

/** Dans l'app, les couleurs d'état suivent le thème ; les autres reprennent celles des jauges. */
const APP_COLORS: Record<Tone, string | undefined> = {
  ...HEX,
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  dim: undefined,
  mark: undefined,
}

/** Largeur des colonnes, en caractères. */
const COLUMNS = { label: 10, bar: 11, pct: 6, verdict: 30, tail: 6 }

/** Toute la largeur : tout le texte ; sinon (panneau latéral, fenêtre étroite) : les jauges seules. */
export type Layout = 'wide' | 'graphs'

/** En dessous de cette largeur (en colonnes du bandeau), on ne garde que les jauges. */
const GRAPHS_BELOW = 110

export function layoutFor(columns: number): Layout {
  return columns >= GRAPHS_BELOW ? 'wide' : 'graphs'
}

/** En version graphique, la jauge prend toute la place entre le libellé et le %, puis le temps restant. */
function barCells(columns: number): number {
  return Math.max(COLUMNS.bar, columns - COLUMNS.label - COLUMNS.pct - COLUMNS.tail - 1)
}

/** Largeur indicative d'une case, en pixels : la jauge s'étire ensuite sur la place réelle. */
const CELL_PX = 9
/**
 * La barre de remplacement d'une jauge étirée prend cette part de ses cases : hors du terminal,
 * ses caractères sont souvent plus larges qu'une case, et elle doit tenir sur une ligne.
 */
const ALT_FILL = 0.75

type Draw = (s: Seg, key: string) => JSX.Element
/** La barre d'une ligne : à sa largeur fixe en pleine largeur, sur `cells` cases en version graphique. */
type DrawBar = (row: Row, i: number, cells?: number) => JSX.Element

function segment(Text: Kit['Text'], colors: Record<Tone, string | undefined>): Draw {
  return (s, key) => (
    <Text
      key={key}
      color={colors[s.tone]}
      dimColor={s.tone === 'dim'}
      bold={s.tone === 'mark'}
      wrap="truncate-end"
    >
      {s.text}
    </Text>
  )
}

/** Une colonne de largeur fixe, vide si la ligne n'a rien à y mettre. */
function cell({ Box, Text }: Kit, width: number, content: JSX.Element | undefined) {
  return (
    <Box width={width} flexShrink={0}>
      {content ?? <Text> </Text>}
    </Box>
  )
}

function layoutRows(kit: Kit, rows: Row[], layout: Layout, columns: number, seg: Draw, bar: DrawBar) {
  const { Box, Text } = kit
  const cells = layout === 'graphs' ? barCells(columns) : undefined
  return (
    <Box key="usage-pace" flexDirection="column" rowGap={0}>
      {rows.map((row, i) => {
        const pct = row.pct && seg(row.pct, `pct-${i}`)
        const hasBar = row.bar.length > 0
        return (
          <Box key={`row-${i}`} flexDirection="row" alignItems="center">
            <Box width={COLUMNS.label} flexShrink={0}>
              <Text dimColor>{row.label}</Text>
            </Box>
            {/* pas de fragment <></> ici : le moteur l'empile en colonne au lieu de l'aplatir dans la ligne */}
            {hasBar && bar(row, i, cells)}
            {hasBar && cell(kit, COLUMNS.pct, pct)}
            {layout === 'graphs' && cell(kit, COLUMNS.tail, row.tail && seg(row.tail, `tail-${i}`))}
            {layout === 'wide' &&
              hasBar &&
              cell(kit, COLUMNS.verdict, row.verdict && seg(row.verdict, `verdict-${i}`))}
            {layout === 'wide' && (
              <Box flexDirection="row" flexShrink={1}>
                {row.detail.map((s, j) => seg(s, `detail-${i}-${j}`))}
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

/** Le bandeau du terminal : des barres en caractères. */
export function band(kit: Kit, rows: Row[], layout: Layout, columns: number) {
  const { Box, Text } = kit
  const seg = segment(Text, COLORS)
  // d'un seul tenant : coupée au bout plutôt que repliée sur deux lignes
  // là où ses caractères sont plus larges que prévu (une police qui n'est pas celle du terminal)
  const barText = (bar: Seg[], i: number) => (
    <Text wrap="truncate-end" mono>
      {bar.map((s, j) => seg(s, `bar-${i}-${j}`))}
    </Text>
  )
  return layoutRows(kit, rows, layout, columns, seg, (row, i, cells) =>
    cells === undefined ? (
      <Box width={COLUMNS.bar} flexShrink={0} flexDirection="row">
        {barText(row.bar, i)}
      </Box>
    ) : (
      <Box width={cells + 1} flexShrink={0} flexDirection="row">
        {barText(row.meter ? meterBar(row.meter, cells) : row.bar, i)}
      </Box>
    ),
  )
}

/**
 * Le bandeau des surfaces graphiques (app desktop, VS Code) : mêmes lignes, jauges SVG.
 * `version` change la source des SVG sans changer leur dessin : de quoi relancer des images
 * que la surface n'a pas su charger (elle affiche alors leur texte de remplacement).
 */
export function bandApp(kit: AppKit, rows: Row[], layout: Layout, columns: number, version = 0) {
  const { Box, Svg } = kit
  return layoutRows(kit, rows, layout, columns, segment(kit.Text, APP_COLORS), (row, _i, cells) => {
    if (cells === undefined) {
      const svg = row.meter && meterSvg(row.meter, { version })
      return (
        <Box paddingRight={1} flexShrink={0}>
          {svg && <Svg source={svg.source} alt={svg.alt} width={METER.width} height={METER.height} />}
        </Box>
      )
    }
    // sans largeur, la jauge prend celle de sa boîte : toute la place entre libellé et %
    const svg =
      row.meter &&
      meterSvg(row.meter, {
        width: cells * CELL_PX,
        stretch: true,
        version,
        altCells: Math.max(1, Math.floor(cells * ALT_FILL)),
      })
    return (
      <Box width={cells + 1} paddingRight={1} flexShrink={0}>
        {svg && <Svg source={svg.source} alt={svg.alt} height={METER.height} />}
      </Box>
    )
  })
}
