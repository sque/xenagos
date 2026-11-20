// The width limits of the viewer's side columns, for the reviewer's dragged dividers.
//
// The left column stays between 192 px and 40% of the layout; the right between 320 px and 45%. The middle column
// keeps at least 384 px, so a side column can never take more than what the other side and the middle leave. When
// the limits conflict, the column's own minimum wins.

export type Side = 'left' | 'right'

/** The file tree's width before any drag, matching the stylesheet's default of 16rem. */
export const DEFAULT_LEFT = 256

const MIN: Record<Side, number> = { left: 192, right: 320 }
const SHARE: Record<Side, number> = { left: 0.4, right: 0.45 }
const MIDDLE_MIN = 384

/** The width to use for a side column dragged to `wanted`; `total` is the layout's width, `other` the other side's. */
export function clampWidth(side: Side, wanted: number, total: number, other: number): number {
  const upper = Math.min(wanted, SHARE[side] * total, total - other - MIDDLE_MIN)
  return Math.max(MIN[side], upper)
}
