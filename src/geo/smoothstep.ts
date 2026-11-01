/** Smoothstep: 0 below `a`, 1 above `b`, an S-curve between. */
export const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
