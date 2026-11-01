import { describe, expect, test } from "vitest"
import { unwrapRing } from "../src/globe/landMask"
import { WORLD_LAND_FINE } from "../src/geo/worldLandFine"
import { WORLD_LAND } from "../src/geo/worldLand"

describe("unwrapRing", () => {
  test("a ring crossing the date line gets continuous longitudes", () => {
    const { pts, turns } = unwrapRing([170, 0, -170, 0, -170, 10, 170, 10, 170, 0])
    expect(pts).toEqual([170, 0, 190, 0, 190, 10, 170, 10, 170, 0])
    expect(turns).toBe(0)
  })

  test("a ring circling a pole counts one turn", () => {
    const { turns } = unwrapRing([-180, -80, -90, -80, 0, -80, 90, -80, 180, -80])
    expect(Math.abs(turns)).toBe(1)
  })

  test("an ordinary ring is left as it is", () => {
    const ring = [0, 0, 10, 0, 10, 10, 0, 0]
    expect(unwrapRing(ring)).toEqual({ pts: ring, turns: 0 })
  })
})

describe("the land data", () => {
  test("every ring is a flat list of valid lon, lat pairs", () => {
    for (const set of [WORLD_LAND, WORLD_LAND_FINE]) {
      expect(set.length).toBeGreaterThan(100)
      for (const ring of set) {
        expect(ring.length % 2).toBe(0)
        for (let i = 0; i < ring.length; i += 2) {
          expect(Math.abs(ring[i])).toBeLessThanOrEqual(180)
          expect(Math.abs(ring[i + 1])).toBeLessThanOrEqual(90)
        }
      }
    }
  })

  test("exactly the rings that circle a pole are Antarctica's", () => {
    const polar = WORLD_LAND_FINE.filter((r) => unwrapRing(r).turns !== 0)
    expect(polar.length).toBeGreaterThan(0)
    for (const r of polar) {
      let sum = 0
      for (let i = 1; i < r.length; i += 2) sum += r[i]
      expect(sum / (r.length / 2)).toBeLessThan(-60)
    }
  })
})
