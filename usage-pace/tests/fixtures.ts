import type { SessionStats } from '../types'

export const MIN = 60_000
export const H = 60 * MIN
export const DAY = 24 * H
/** Le moment de ta capture d'écran du 9 octobre. */
export const NOW = Date.parse('2026-10-09T15:39:00Z')
export const at = (ms: number) => new Date(NOW + ms).toISOString()
export const round2 = (x: number | null | undefined) => Math.round((x ?? NaN) * 100) / 100
export const text = (segs: { text: string }[] | undefined) => (segs ?? []).map(s => s.text).join('')

export function stats(over: Partial<SessionStats> = {}): SessionStats {
  return {
    startedAt: NOW - 72 * MIN,
    turns: 23,
    tools: 41,
    files: ['a.ts', 'b.ts'],
    cacheRead: 920_000,
    inputTotal: 1_000_000,
    time: { claude: 0, tools: 0, you: 0 },
    slow: {},
    base: { five_hour: { p: 5, resetsAt: at(3 * H) }, seven_day: { p: 64, resetsAt: at(2 * DAY) } },
    ...over,
  }
}
