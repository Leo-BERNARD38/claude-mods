import { expect, test } from 'claude-code/testing'

import { contextRows, groupParts, nextSeries, topMcp, turnsToCompact } from '../hooks/context'
import { text } from './fixtures'

const CATEGORIES = [
  { name: 'System prompt', tokens: 3000, kind: 'used' },
  { name: 'System tools', tokens: 12000, kind: 'used' },
  { name: 'MCP tools', tokens: 18000, kind: 'used' },
  { name: 'Memory files', tokens: 4000, kind: 'used' },
  { name: 'Skills', tokens: 2000, kind: 'used' },
  { name: 'Messages', tokens: 41000, kind: 'used' },
  { name: 'Free space', tokens: 100000, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
]

test('composition : regroupée en familles, sans l’espace libre ni la réserve', async () => {
  expect(groupParts(CATEGORIES)).toEqual([
    { key: 'conversation', tokens: 41000 },
    { key: 'MCP', tokens: 18000 },
    { key: 'système', tokens: 15000 },
    { key: 'instructions', tokens: 4000 },
    { key: 'skills', tokens: 2000 },
  ])
})

test('serveur MCP le plus lourd, outils non chargés exclus', async () => {
  const top = topMcp([
    { serverName: 'github', tokens: 9000, isLoaded: true },
    { serverName: 'github', tokens: 4000, isLoaded: true },
    { serverName: 'figma', tokens: 5000, isLoaded: true },
    { serverName: 'gmail', tokens: 20000, isLoaded: false },
  ])
  expect(top).toEqual({ name: 'github', tokens: 13000 })
  expect(topMcp([])).toBeUndefined()
})

test('série : doublons ignorés, remise à zéro après une compaction', async () => {
  expect(nextSeries([62000, 68000], 68000)).toEqual([62000, 68000])
  expect(nextSeries([62000, 68000], 74000)).toEqual([62000, 68000, 74000])
  expect(nextSeries([150000, 160000], 30000)).toEqual([30000])
})

test('compaction : +6k par échange, 80k aujourd’hui, seuil 167k → 14 échanges', async () => {
  expect(turnsToCompact([62000, 68000, 74000, 80000], 167000)).toBe(14)
  expect(turnsToCompact([80000, 80100, 80200], 167000)).toBeNull()
  expect(turnsToCompact([62000, 68000], 167000)).toBeNull()
})

test('lignes Contexte et « dont »', async () => {
  const rows = contextRows(
    {
      limits: [],
      ctx: 40,
      ctxTokens: 80_000,
      ctxWindow: 200_000,
      ctxParts: groupParts(CATEGORIES),
      mcpTop: { name: 'github', tokens: 13000 },
      compactAt: 167000,
      ctxSeries: [62000, 68000, 74000, 80000],
    },
    false,
  )
  expect(rows.map(r => r.label)).toEqual(['Contexte', '  dont'])
  expect(text(rows[0]?.detail)).toBe('80k / 200k tokens')
  // compaction lointaine : on ne l'annonce pas
  expect(rows[1]?.verdict?.text).toBe('surtout : conversation')
  expect(text(rows[1]?.detail)).toBe(
    'conversation 41k · MCP 18k (dont github 13k) · système 15k · instructions 4k · skills 2k',
  )
  expect(text(rows[1]?.bar)).toHaveLength(10)
})

test('contexte rempli à 85 % → en rouge, tokens compris', async () => {
  const [fill] = contextRows({ limits: [], ctx: 85, ctxTokens: 170_000, ctxWindow: 200_000 }, false)
  expect(fill?.pct?.tone).toBe('bad')
  expect(fill?.detail[0]?.tone).toBe('bad')
})

test('compaction annoncée seulement quand elle approche', async () => {
  const [, parts] = contextRows(
    {
      limits: [],
      ctx: 80,
      ctxParts: [{ key: 'conversation', tokens: 150_000 }],
      compactAt: 167_000,
      ctxSeries: [135_000, 141_000, 147_000, 153_000],
    },
    false,
  )
  expect(parts?.verdict).toEqual({ text: 'compaction dans ≈ 2 échanges', tone: 'warn' })
})
