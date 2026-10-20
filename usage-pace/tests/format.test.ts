import { expect, test } from 'claude-code/testing'

import { decimal, duration, gauge, stacked, tokens } from '../hooks/format'
import { DAY, H, MIN, text } from './fixtures'

test('durées lisibles', async () => {
  expect(duration(45_000)).toBe('45s')
  expect(duration(12 * MIN)).toBe('12min')
  expect(duration(2 * H + 5 * MIN)).toBe('2h05')
  expect(duration(3 * DAY + 4 * H)).toBe('3j4h')
})

test('nombres à la française', async () => {
  expect(decimal(6.66)).toBe('6,7')
  expect(decimal(2)).toBe('2')
  expect(decimal(15.6)).toBe('16')
  expect(tokens(22_400)).toBe('22k')
  expect(tokens(1_200_000)).toBe('1,2M')
})

test('jauge : remplissage et repère du temps écoulé', async () => {
  expect(text(gauge(30, 'ok', 60))).toBe('━━━───│───')
})

test('barre empilée : toujours la largeur pleine', async () => {
  const bar = stacked([
    { value: 1, glyph: 'a', tone: 'claude' },
    { value: 1, glyph: 'b', tone: 'tools' },
    { value: 1, glyph: 'c', tone: 'you' },
  ])
  expect(text(bar)).toBe('aaabbbcccc')
  expect(stacked([])).toEqual([])
})
