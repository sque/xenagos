import { expect, test } from 'vitest'
import { clampWidth } from './widths'

test.each([
  ['left', 100, 1440, 400, 192], // below the minimum
  ['left', 900, 1440, 400, 576], // 40% of 1440
  ['right', 700, 1440, 500, 556], // middle keeps 384: 1440 - 500 - 384
  ['right', 200, 1440, 256, 320], // below the minimum
  ['left', 300, 1100, 600, 192], // limits conflict: the minimum wins
] as const)('clampWidth(%s, %d, total %d, other %d) is %d', (side, wanted, total, other, expected) => {
  expect(clampWidth(side, wanted, total, other)).toBe(expected)
})
