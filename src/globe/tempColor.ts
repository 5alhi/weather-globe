// A temperature's colour on one scale from bitter cold to extreme heat, the same for every city (°C is converted). The
// hue turns where people feel a change — freezing, cool, mild, warm, hot — and every stop stays readable on the dark
// background.
const STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [176, 150, 255]], // bitter: violet
  [20, [122, 162, 255]], // cold: blue
  [32, [96, 196, 250]], // freezing: ice blue
  [45, [84, 214, 204]], // cool: teal
  [58, [134, 222, 146]], // mild: green
  [68, [212, 226, 118]], // pleasant: yellow-green
  [77, [250, 204, 96]], // warm: amber
  [86, [255, 156, 84]], // hot: orange
  [95, [255, 108, 104]], // very hot: red
  [105, [255, 96, 176]], // extreme: magenta
]

export const cToF = (c: number): number => (c * 9) / 5 + 32

/** The colour of a temperature in °F, as `rgb(r g b)`. */
export function tempColor(f: number): string {
  const [r, g, b] = tempRgb(f)
  return `rgb(${r} ${g} ${b})`
}

export function tempRgb(f: number): [number, number, number] {
  if (!Number.isFinite(f) || f <= STOPS[0][0]) return [...STOPS[0][1]]
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]
    if (f <= t1) {
      const [t0, c0] = STOPS[i - 1]
      const k = (f - t0) / (t1 - t0)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number]
    }
  }
  return [...STOPS[STOPS.length - 1][1]]
}
