import { describe, expect, test } from "vitest"
import { NO_TEMP, cloudDetail, coldGreyTemp, gibsReader, greyTemp, rampReading, rampTemp, tileTemps } from "../src/globe/irDecode"

/** an RGBA tile of one colour */
function tile(w: number, h: number, rgb: [number, number, number], alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let k = 0; k < w * h; k++) px.set([...rgb, alpha], k * 4)
  return px
}

describe("the colour map's temperatures", () => {
  test("the warm grey ramp runs from −18.85 °C (197) to +57.15 °C (1)", () => {
    expect(greyTemp(197)).toBeCloseTo(-18.85)
    expect(greyTemp(1)).toBeCloseTo(57.15, 1)
  })

  test("the coldest entry is about −91.6 °C and entries warm monotonically", () => {
    expect(rampTemp(0)).toBeCloseTo(-91.6)
    for (let i = 1; i < 86; i++) expect(rampTemp(i)).toBeGreaterThan(rampTemp(i - 1))
  })

  test("a cold grey reads between −80 °C and −70 °C", () => {
    for (const g of [5, 54, 129, 230]) {
      const t = coldGreyTemp(g)
      expect(t).toBeGreaterThan(-81)
      expect(t).toBeLessThan(-70)
    }
  })

  test("an exact map colour reads as its entry", () => {
    // entry 31 is pure red
    expect(rampReading(255, 0, 0)).toBeCloseTo(rampTemp(31), 1)
  })

  test("a colour half-way between two neighbouring entries reads half-way", () => {
    // entries 31 (255, 0, 0) and 32 (255, 26, 0)
    expect(rampReading(255, 13, 0)).toBeCloseTo((rampTemp(31) + rampTemp(32)) / 2, 1)
  })

  test("the reader takes a grey on the warm ramp", () => {
    const read = gibsReader()
    expect(read(100, 100, 100)).toBeCloseTo(greyTemp(100))
    expect(read(101, 99, 100)).toBeCloseTo(greyTemp(100))
  })
})

describe("tileTemps", () => {
  test("a grey tile reads as one warm temperature (°C × 10)", () => {
    const { temps, far } = tileTemps(tile(4, 4, [120, 120, 120]), 4, 4)
    expect(far).toBe(0)
    for (const t of temps) expect(t).toBe(Math.round(greyTemp(120) * 10))
  })

  test("transparent pixels are unseen", () => {
    const { temps } = tileTemps(tile(3, 3, [120, 120, 120], 0), 3, 3)
    expect([...temps].every((t) => t === NO_TEMP)).toBe(true)
  })

  test("a tile mostly off the colour map is not read", () => {
    const { temps, far } = tileTemps(tile(4, 4, [20, 200, 255]), 4, 4)
    expect(far).toBeGreaterThan(0.1)
    expect([...temps].every((t) => t === NO_TEMP)).toBe(true)
  })

  test("a one-pixel speck takes the middle of its neighbours", () => {
    const px = tile(5, 5, [120, 120, 120])
    px.set([255, 0, 0, 255], (2 * 5 + 2) * 4) // a −60 °C pixel in warm ground
    const { temps } = tileTemps(px, 5, 5)
    expect(temps[2 * 5 + 2]).toBe(Math.round(greyTemp(120) * 10))
  })
})

describe("cloudDetail", () => {
  const area = { west: -80, north: 5, res: 0.02, subLon: -75 }

  test("a uniform field has no fine structure (128) and full trust near the satellite", () => {
    const w = 40, h = 40
    const rg = cloudDetail(new Int16Array(w * h).fill(-300), w, h, 2, area)
    const mid = (20 * w + 20) * 2
    expect(rg[mid]).toBe(128)
    expect(rg[mid + 1]).toBe(255)
  })

  test("a cold patch stands above its surroundings", () => {
    const w = 40, h = 40, temps = new Int16Array(w * h).fill(200)
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) temps[y * w + x] = -500
    const rg = cloudDetail(temps, w, h, 4, area)
    expect(rg[(20 * w + 20) * 2]).toBeGreaterThan(160)
  })

  test("unseen pixels carry no trust", () => {
    const w = 10, h = 10
    const rg = cloudDetail(new Int16Array(w * h).fill(NO_TEMP), w, h, 1, area)
    for (let k = 0; k < w * h; k++) { expect(rg[2 * k]).toBe(128); expect(rg[2 * k + 1]).toBe(0) }
  })
})
