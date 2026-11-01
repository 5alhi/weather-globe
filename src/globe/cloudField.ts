// The globe's clouds as textures for the GPU: the weather model's coarse world grid (CloudGrid) spread smoothly over a
// 1°-per-texel map, then each city's current conditions painted in around it (within a few degrees), so the clouds over
// a city match its own report. RGBA bytes, row 0 at the north pole: r = total cloud cover, g = high cloud,
// b = rain (0 → 2 mm or more in 15 min), a = thunderstorm. Pure.
import { isWet, type Sky } from "../geo/sky"

/** The weather model's clouds now on a coarse world grid, row-major from the south-west corner (lat0, lon0). */
export interface CloudGrid {
  atMs: number
  lat0: number
  latStep: number
  rows: number
  lon0: number
  lonStep: number
  cols: number
  /** total cloud cover (%), null where unknown */
  cover: ReadonlyArray<number | null>
  /** high cloud cover (%) */
  high: ReadonlyArray<number | null>
  /** precipitation over the last 15 minutes (mm) */
  precip: ReadonlyArray<number | null>
  /** a thunderstorm is reported (1) or not (0) */
  storm: ReadonlyArray<0 | 1>
}

export const FIELD_W = 360
export const FIELD_H = 180
/** how far a city's own report reaches into the field (°): full weight at the city, half at ~1.8° */
const CITY_SIGMA_DEG = 1.5
const CITY_REACH_DEG = 4.5

export interface CityCloud { lat: number; lon: number; sky: Sky | null }
export interface CloudField {
  /** values multiplied by their evidence weights, ready for the GPU to interpolate with validity */
  data: Uint8Array
  /** known-sample weight per channel; zero = unknown, never a measurement of clear/dry/no storm */
  validity: Uint8Array
}
interface Interpolated { value: number; weight: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The cloud field and its per-channel evidence. A null or wholly missing grid contributes no model weather. */
export function cloudField(grid: CloudGrid | null, cities: readonly CityCloud[] = []): CloudField {
  const cover = new Float32Array(FIELD_W * FIELD_H), high = new Float32Array(FIELD_W * FIELD_H)
  const rain = new Float32Array(FIELD_W * FIELD_H), storm = new Float32Array(FIELD_W * FIELD_H)
  const coverValid = new Float32Array(FIELD_W * FIELD_H), highValid = new Float32Array(FIELD_W * FIELD_H)
  const rainValid = new Float32Array(FIELD_W * FIELD_H), stormValid = new Float32Array(FIELD_W * FIELD_H)
  if (grid) {
    const at = (arr: ReadonlyArray<number | null>, i: number, j: number): number | null => {
      const ii = Math.max(0, Math.min(grid.rows - 1, i)), jj = ((j % grid.cols) + grid.cols) % grid.cols
      const value = arr[ii * grid.cols + jj]
      return value != null && Number.isFinite(value) ? value : null
    }
    const bilinear = (arr: ReadonlyArray<number | null>, fi: number, fj: number, out: Interpolated): void => {
      const i0 = Math.floor(fi), j0 = Math.floor(fj), di = fi - i0, dj = fj - j0
      let sum = 0, weight = 0
      const add = (i: number, j: number, w: number): void => {
        const value = at(arr, i, j)
        if (value != null) { sum += value * w; weight += w }
      }
      add(i0, j0, (1 - di) * (1 - dj)); add(i0, j0 + 1, (1 - di) * dj)
      add(i0 + 1, j0, di * (1 - dj)); add(i0 + 1, j0 + 1, di * dj)
      out.value = weight > 0 ? sum / weight : 0
      out.weight = weight
    }
    // storm = 0 stands both for "no storm" and for an unavailable answer. The other channels distinguish those cases; a
    // storm-only nonzero at an otherwise unavailable point is not enough evidence to draw.
    const stormEvidence = grid.storm.map((s, k): number | null => grid.cover[k] == null && grid.high[k] == null && grid.precip[k] == null ? null : s)
    const sample: Interpolated = { value: 0, weight: 0 }
    for (let y = 0; y < FIELD_H; y++) {
      const lat = 89.5 - y
      const fi = (lat - grid.lat0) / grid.latStep
      // beyond the grid's last rows the clouds thin toward the poles rather than stopping at an edge
      const polar = fi < 0 ? clamp01(1 + fi * 0.6) : fi > grid.rows - 1 ? clamp01(1 - (fi - (grid.rows - 1)) * 0.6) : 1
      for (let x = 0; x < FIELD_W; x++) {
        const lon = -179.5 + x
        const fj = (lon - grid.lon0) / grid.lonStep
        const k = y * FIELD_W + x
        bilinear(grid.cover, fi, fj, sample)
        cover[k] = clamp01(sample.value / 100) * polar; coverValid[k] = sample.weight
        bilinear(grid.high, fi, fj, sample)
        high[k] = clamp01(sample.value / 100) * polar; highValid[k] = sample.weight
        bilinear(grid.precip, fi, fj, sample)
        rain[k] = clamp01(sample.value / 2); rainValid[k] = sample.weight
        bilinear(stormEvidence, fi, fj, sample)
        storm[k] = clamp01(sample.value); stormValid[k] = sample.weight
      }
    }
  }
  for (const c of cities) {
    if (!c.sky) continue
    const own = c.sky.oktas != null ? c.sky.oktas / 8 : null
    const wet = isWet(c.sky) ? [0, 0.35, 0.65, 1][c.sky.intensity] : 0
    const isStorm = c.sky.kind === "storm"
    const y0 = Math.floor(89.5 - c.lat), cosLat = Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))
    const reachY = Math.ceil(CITY_REACH_DEG), reachX = Math.ceil(CITY_REACH_DEG / cosLat)
    for (let dy = -reachY; dy <= reachY; dy++) {
      const y = y0 + dy
      if (y < 0 || y >= FIELD_H) continue
      for (let dx = -reachX; dx <= reachX; dx++) {
        const x = (((Math.floor(c.lon + 179.5) + dx) % FIELD_W) + FIELD_W) % FIELD_W
        const lat = 89.5 - y, lon = -179.5 + x
        let dLon = lon - c.lon
        dLon -= 360 * Math.round(dLon / 360)
        const d2 = (lat - c.lat) ** 2 + (dLon * cosLat) ** 2
        if (d2 > CITY_REACH_DEG ** 2) continue
        const w = Math.exp(-d2 / (2 * CITY_SIGMA_DEG ** 2))
        const k = y * FIELD_W + x
        if (own != null) {
          cover[k] = cover[k] * (1 - w) + Math.max(own, wet > 0 ? 0.8 : 0) * w
          coverValid[k] = 1
        }
        if (wet > 0) { rain[k] = Math.max(rain[k], wet * w); rainValid[k] = 1 }
        if (isStorm) { storm[k] = Math.max(storm[k], w); stormValid[k] = 1 }
      }
    }
  }
  const data = new Uint8Array(FIELD_W * FIELD_H * 4), validity = new Uint8Array(FIELD_W * FIELD_H * 4)
  for (let k = 0; k < FIELD_W * FIELD_H; k++) {
    const o = k * 4
    const cv = clamp01(coverValid[k]), hv = clamp01(highValid[k]), rv = clamp01(rainValid[k]), sv = clamp01(stormValid[k])
    data[o] = Math.round(cover[k] * cv * 255); validity[o] = Math.round(cv * 255)
    data[o + 1] = Math.round(high[k] * hv * 255); validity[o + 1] = Math.round(hv * 255)
    data[o + 2] = Math.round(rain[k] * rv * 255); validity[o + 2] = Math.round(rv * 255)
    data[o + 3] = Math.round(storm[k] * sv * 255); validity[o + 3] = Math.round(sv * 255)
  }
  return { data, validity }
}
