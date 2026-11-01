// The clouds' infrared tiles read back into temperatures, and turned into the clouds' fine structure for the globe's
// sharp clouds (detail.ts, built in detailWorker.ts). NASA GIBS colours its clean-infrared tiles (GOES-West, GOES-East, Himawari) with one colour map, "Clean Longwave
//    Infrared Window Band": 86 colours from −92 °C to −19 °C, then a grey ramp from 197 down to 1 for −19 °C to +57 °C.
//    The tiles blend neighbouring pixels where they resample the picture, so a colour is read as, in turn: a grey (tinted
//    a few levels at most) on the warm ramp; a blend of two neighbouring entries; or a blend of an entry with a grey —
//    where a cloud's edge meets warm ground — at the blend of their temperatures. Ten greys of the map also stand for
//    −80 °C to −71 °C: read so only where they join a cold core (colder than −60 °C). A pixel far colder or warmer than
//    everything around it takes the middle of its neighbours' readings.
// A tile whose colours mostly sit far from the map is not read (the colour map has changed).
import { smooth } from "../geo/smoothstep"

/** the colour map's first 86 entries (r, g, b), coldest first, down to the first warm grey */
const RAMP = [
  255, 255, 255, 127, 0, 127, 140, 13, 135, 153, 25, 142, 165, 38, 150, 178, 51, 157, 191, 64, 165, 204, 76, 173, 217, 89, 180, 229, 102,
  188, 242, 114, 195, 255, 127, 203, 230, 230, 230, 204, 204, 204, 177, 177, 177, 155, 155, 155, 129, 129, 129, 102, 102, 102, 76, 76, 76,
  54, 54, 54, 27, 27, 27, 5, 5, 5, 26, 0, 0, 51, 0, 0, 77, 0, 0, 102, 0, 0, 128, 0, 0, 153, 0, 0, 179, 0, 0, 204, 0, 0, 230, 0, 0, 255, 0, 0, 255, 26, 0,
  255, 51, 0, 255, 77, 0, 255, 102, 0, 255, 128, 0, 255, 153, 0, 255, 179, 0, 255, 204, 0, 255, 230, 0, 255, 255, 0, 230, 255, 0, 204, 255, 0,
  179, 255, 0, 153, 255, 0, 128, 255, 0, 102, 255, 0, 77, 255, 0, 51, 255, 0, 26, 255, 0, 0, 255, 0, 0, 234, 10, 0, 212, 19, 0, 191, 29, 0, 170,
  38, 0, 149, 48, 0, 128, 58, 0, 106, 67, 0, 85, 77, 0, 64, 86, 0, 42, 96, 0, 21, 105, 0, 0, 115, 0, 0, 125, 0, 13, 122, 0, 26, 129, 0, 38, 136, 0,
  51, 143, 0, 64, 150, 0, 76, 157, 0, 89, 164, 0, 102, 171, 0, 115, 178, 0, 128, 185, 0, 140, 192, 0, 153, 199, 0, 166, 206, 0, 178, 213, 0, 191,
  220, 0, 204, 227, 0, 217, 234, 0, 230, 241, 0, 242, 248, 0, 255, 255, 197, 197, 197,
]
const RAMP_N = RAMP.length / 3
/** an entry's temperature (°C): the middle of its interval — 1 °C wide down to −31.1 °C, 0.5 °C from there */
export const rampTemp = (i: number): number => (i <= 61 ? -92.1 + i : -30.6 + 0.5 * (i - 62)) + (i <= 60 ? 0.5 : 0.25)
/** the warm grey ramp: 197 at −18.85 °C down to 1 at +57.15 °C */
export const greyTemp = (g: number): number => -18.85 + 0.387755 * (197 - g)
/** the cold greys: entries 12 (230, −79.6 °C) to 21 (5, −70.6 °C) */
const COLD_FROM = 12, COLD_TO = 21
/** a cold grey's reading (°C), between its entries; brighter than 230 toward the coldest white */
export function coldGreyTemp(g: number): number {
  if (g >= 230) return rampTemp(COLD_FROM) + ((g - 230) / 25) * (rampTemp(0) - rampTemp(COLD_FROM))
  for (let i = COLD_FROM; i < COLD_TO; i++) {
    const a = RAMP[3 * i], b = RAMP[3 * i + 3]
    if (g <= a && g >= b) return rampTemp(i) + ((a - g) / (a - b)) * (rampTemp(i + 1) - rampTemp(i))
  }
  return rampTemp(COLD_TO)
}
/** the cold greys that are also on the warm ramp */
const COLD_ON_WARM = new Set(Array.from({ length: COLD_TO - COLD_FROM + 1 }, (_, k) => RAMP[3 * (COLD_FROM + k)]).filter((g) => g <= 197))
/** a pixel whose channels spread this little is a grey */
const GREY_TINT = 6
/** a reading this close (RGB distance) is taken at once; one up to FAR when nothing is closer; past that, not of the map */
const NEAR = 12
const FAR = 24
/** colder than this, a pixel is a cold core */
const CORE_C = -60
/** a pixel this much colder or warmer than the middle of its eight neighbours is out of line with them */
const SPECK_K = 15

/** a temperature (°C × 10) where the satellite does not see */
export const NO_TEMP = -32768

/** A colour that is not a grey, as a temperature (°C): a blend of two neighbouring entries of the map (the cold greys
 *  aside), or a blend of an entry with the warm ground's grey; NaN when it is neither. */
export function rampReading(r: number, g: number, b: number): number {
  let best = Infinity, at = NaN
  for (let i = 0; i < RAMP_N - 1; i++) {
    if (i >= COLD_FROM - 1 && i <= COLD_TO) continue
    const ar = RAMP[3 * i], ag = RAMP[3 * i + 1], ab = RAMP[3 * i + 2]
    const dr = RAMP[3 * i + 3] - ar, dg = RAMP[3 * i + 4] - ag, db = RAMP[3 * i + 5] - ab
    const len2 = dr * dr + dg * dg + db * db
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((r - ar) * dr + (g - ag) * dg + (b - ab) * db) / len2)) : 0
    const er = ar + u * dr - r, eg = ag + u * dg - g, eb = ab + u * db - b
    const d2 = er * er + eg * eg + eb * eb
    if (d2 < best) { best = d2; at = rampTemp(i) + u * (rampTemp(i + 1) - rampTemp(i)) }
  }
  if (best <= NEAR * NEAR) return at
  // an entry blended with a grey: the colour ≈ α · entry + β · (1, 1, 1), the grey β / (1 − α) (least squares)
  let bestB = Infinity, atB = NaN
  const c1 = r + g + b
  for (let i = 0; i < RAMP_N; i++) {
    if (i >= COLD_FROM && i <= COLD_TO) continue
    const pr = RAMP[3 * i], pg = RAMP[3 * i + 1], pb = RAMP[3 * i + 2]
    const pp = pr * pr + pg * pg + pb * pb, p1 = pr + pg + pb, pc = pr * r + pg * g + pb * b
    const det = 3 * pp - p1 * p1
    if (Math.abs(det) < 1) continue
    const a = (3 * pc - p1 * c1) / det, beta = (pp * c1 - p1 * pc) / det
    if (a < 0 || a >= 1) continue
    const ground = beta / (1 - a)
    if (!(ground >= 0 && ground <= 197.5)) continue
    const er = a * pr + beta - r, eg = a * pg + beta - g, eb = a * pb + beta - b
    const d2 = er * er + eg * eg + eb * eb
    if (d2 < bestB) { bestB = d2; atB = a * rampTemp(i) + (1 - a) * greyTemp(ground) }
  }
  if (bestB <= NEAR * NEAR) return atB
  return best <= FAR * FAR ? at : bestB <= FAR * FAR ? atB : NaN
}

/** A reader of NASA GIBS's colours (°C; NaN = not of the colour map), remembering each colour it has read. */
export function gibsReader(): (r: number, g: number, b: number) => number {
  const seen = new Map<number, number>()
  return (r, g, b) => {
    if (Math.max(r, g, b) - Math.min(r, g, b) <= GREY_TINT) {
      const m = (r + g + b) / 3
      return m <= 197.5 ? greyTemp(Math.min(197, m)) : coldGreyTemp(m)
    }
    const key = (r << 16) | (g << 8) | b
    let t = seen.get(key)
    if (t === undefined) { t = rampReading(r, g, b); seen.set(key, t) }
    return t
  }
}

export interface TileTemps {
  /** °C × 10, row by row; NO_TEMP where the satellite does not see */
  temps: Int16Array
  /** the share of the seen pixels whose colour is not of the colour map */
  far: number
}

/** A tile's temperatures from its RGBA pixels in NASA's colours. A tile with more than 10% of its colours off the map
 *  is read as unseen. */
export function tileTemps(px: ArrayLike<number>, w: number, h: number, read = gibsReader()): TileTemps {
  const n = w * h, temps = new Int16Array(n).fill(NO_TEMP)
  let seen = 0, far = 0
  /** seen pixels whose colour is off the map */
  const odd = new Uint8Array(n)
  /** greys that may be of the cold ramp, and their grey */
  const coldGrey = new Map<number, number>()
  for (let k = 0; k < n; k++) {
    if (px[4 * k + 3] < 128) continue
    seen++
    const r = px[4 * k], g = px[4 * k + 1], b = px[4 * k + 2]
    const t = read(r, g, b)
    if (Number.isNaN(t)) { far++; odd[k] = 1; continue }
    temps[k] = Math.round(t * 10)
    if (Math.max(r, g, b) - Math.min(r, g, b) <= GREY_TINT) {
      const m = Math.round((r + g + b) / 3)
      if (COLD_ON_WARM.has(m)) coldGrey.set(k, m)
    }
  }
  if (seen > 0 && far / seen > 0.1) return { temps: new Int16Array(n).fill(NO_TEMP), far: far / seen }
  // a grey of the cold ramp touching a cold core is part of it; the core grows through such greys
  if (coldGrey.size) {
    const queue: number[] = []
    const core = (k: number) => temps[k] !== NO_TEMP && temps[k] < CORE_C * 10 && !coldGrey.has(k)
    for (const k of coldGrey.keys()) {
      const x = k % w
      if ((x > 0 && core(k - 1)) || (x < w - 1 && core(k + 1)) || (k >= w && core(k - w)) || (k < n - w && core(k + w))) queue.push(k)
    }
    while (queue.length) {
      const k = queue.pop()!
      const m = coldGrey.get(k)
      if (m === undefined) continue
      coldGrey.delete(k)
      temps[k] = Math.round(coldGreyTemp(m) * 10)
      const x = k % w
      for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) if (j >= 0 && j < n && coldGrey.has(j)) queue.push(j)
    }
  }
  // a pixel out of line with the middle of its eight neighbours (a speck the size of a pixel or two, as cloud or as a
  // hole in it) takes that middle, and so does one whose colour is off the map; a straight edge keeps its line
  const out = temps.slice(), nb = new Int16Array(8)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x, t = temps[k]
    if (t === NO_TEMP && !odd[k]) continue
    let c = 0
    for (const j of [k - w - 1, k - w, k - w + 1, k - 1, k + 1, k + w - 1, k + w, k + w + 1]) if (temps[j] !== NO_TEMP) nb[c++] = temps[j]
    if (c < 5) continue
    const sorted = nb.subarray(0, c).sort()
    const mid = sorted[c >> 1]
    if (t === NO_TEMP || Math.abs(t - mid) > SPECK_K * 10) out[k] = mid
  }
  return { temps: out, far: seen > 0 ? far / seen : 0 }
}

/** box sums of a row-major grid along one axis, in place (radius r, edges counted as empty), through a line buffer */
function boxPass(a: Float32Array, w: number, h: number, r: number, alongX: boolean, line: Float32Array): void {
  const lines = alongX ? h : w, len = alongX ? w : h, step = alongX ? 1 : w
  for (let l = 0; l < lines; l++) {
    const base = alongX ? l * w : l
    for (let i = 0; i < len; i++) line[i] = a[base + i * step]
    let s = 0
    for (let i = 0; i <= Math.min(r, len - 1); i++) s += line[i]
    for (let i = 0; i < len; i++) {
      a[base + i * step] = s
      const add = i + r + 1, drop = i - r
      if (add < len) s += line[add]
      if (drop >= 0) s -= line[drop]
    }
  }
}

export interface DetailArea {
  /** the mosaic's box (degrees): its west and north edges, and degrees a pixel */
  west: number; north: number; res: number
  /** the satellite's longitude: its picture is trusted less far from the point below it */
  subLon: number
}

/** working arrays, kept between builds of the same size (a build runs every few hundred ms while tiles come in) */
let scratch: { n: number; c: Float32Array; mb: Float32Array; cb: Float32Array; line: Float32Array } | null = null

/** The clouds' fine structure over a mosaic of tiles (temperatures, °C × 10): how much colder each point (lightly
 *  smoothed, 1-2-1 each way, so no single pixel stands alone) is than its surroundings at the scale of the world's cloud
 *  map (a box of `blurPx` either side, twice) — > 0 on the cold side of an edge, inside a cloud's towers — and how far to
 *  trust it: not where the satellite does not see, less where its surroundings are half unseen, and less toward the edge
 *  of the satellite's view (65° to 78° from the point below it). Encoded two bytes a pixel for the GPU: 128 + 3.2 a
 *  kelvin (±40 K), and the trust × 255. */
export function cloudDetail(temps: Int16Array, w: number, h: number, blurPx: number, area: DetailArea): Uint8Array {
  const n = w * h
  if (!scratch || scratch.n !== n || scratch.line.length < Math.max(w, h)) {
    scratch = { n, c: new Float32Array(n), mb: new Float32Array(n), cb: new Float32Array(n), line: new Float32Array(Math.max(w, h)) }
  }
  const { c, mb, cb, line } = scratch
  for (let k = 0; k < n; k++) {
    const seen = temps[k] !== NO_TEMP
    c[k] = seen ? -temps[k] / 10 : 0
    mb[k] = seen ? 1 : 0
    cb[k] = c[k]
  }
  // a box twice over, each way: close to the world map's own smoothing
  for (let round = 0; round < 2; round++) {
    boxPass(mb, w, h, blurPx, true, line); boxPass(mb, w, h, blurPx, false, line)
    boxPass(cb, w, h, blurPx, true, line); boxPass(cb, w, h, blurPx, false, line)
  }
  const full = (2 * blurPx + 1) ** 4
  const out = new Uint8Array(2 * n)
  const RAD = Math.PI / 180
  const cosLon = new Float32Array(w)
  for (let x = 0; x < w; x++) cosLon[x] = Math.cos((area.west + (x + 0.5) * area.res - area.subLon) * RAD)
  for (let y = 0; y < h; y++) {
    const cosLat = Math.cos((area.north - (y + 0.5) * area.res) * RAD)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      out[2 * k] = 128
      if (temps[k] === NO_TEMP || mb[k] <= 0) continue
      // the point, lightly smoothed over its seen neighbours
      let s = 0, ws = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, j = yy * w + xx
          if (xx < 0 || xx >= w || temps[j] === NO_TEMP) continue
          const wt = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)
          s += wt * c[j]
          ws += wt
        }
      }
      const hf = s / ws - cb[k] / mb[k]
      const angle = Math.acos(Math.max(-1, Math.min(1, cosLat * cosLon[x]))) / RAD
      const trust = smooth(0.6, 0.95, mb[k] / full) * (1 - smooth(65, 78, angle))
      out[2 * k] = Math.max(0, Math.min(255, Math.round(128 + hf * 3.2)))
      out[2 * k + 1] = Math.round(trust * 255)
    }
  }
  return out
}

