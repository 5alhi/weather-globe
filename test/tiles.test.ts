import { describe, expect, test } from "vitest"
import { CLOUD_STEP_MS, checkTileReq, tileCols, tileRes, tileRows, tileSpan } from "../src/geo/tiles"
import { bestSource, levelFor, planKey, planTiles, tilePlan, visibleBox } from "../src/globe/detail"

const NOW = Date.parse("2026-01-15T12:00:00Z")

describe("the GIBS grid", () => {
  test("a level-z tile spans 288 / 2^z degrees", () => {
    expect(tileSpan(0)).toBe(288)
    expect(tileSpan(4)).toBe(18)
    expect(tileRes(4)).toBeCloseTo(18 / 512)
  })

  test("from level 3 on the world is whole tiles", () => {
    expect(tileCols(4)).toBe(20)
    expect(tileRows(4)).toBe(10)
  })
})

describe("checkTileReq", () => {
  test("accepts a surface tile on the grid", () => {
    expect(checkTileReq({ kind: "surface", z: 5, row: 3, col: 7 }, NOW)).toEqual({ kind: "surface", z: 5, row: 3, col: 7 })
  })

  test("refuses off-grid tiles and unlisted levels", () => {
    expect(checkTileReq({ kind: "surface", z: 4, row: 10, col: 0 }, NOW)).toBeNull()
    expect(checkTileReq({ kind: "surface", z: 9, row: 0, col: 0 }, NOW)).toBeNull()
    expect(checkTileReq({ kind: "surface", z: 4.5, row: 0, col: 0 }, NOW)).toBeNull()
    expect(checkTileReq(null, NOW)).toBeNull()
  })

  test("accepts a cloud tile on the 10-minute mark within the last day", () => {
    const t = NOW - 6 * CLOUD_STEP_MS
    expect(checkTileReq({ kind: "clouds", source: "goes-east", timeMs: t, z: 4, row: 3, col: 5 }, NOW)).not.toBeNull()
  })

  test("refuses unknown satellites, odd times, old times and levels past the satellite's own", () => {
    const base = { kind: "clouds", source: "goes-east", timeMs: NOW, z: 4, row: 3, col: 5 }
    expect(checkTileReq({ ...base, source: "elsewhere" }, NOW)).toBeNull()
    expect(checkTileReq({ ...base, timeMs: NOW + 1 }, NOW)).toBeNull()
    expect(checkTileReq({ ...base, timeMs: NOW - 2 * 86_400_000 }, NOW)).toBeNull()
    expect(checkTileReq({ ...base, z: 6 }, NOW)).toBeNull()
  })
})

describe("detail planning", () => {
  test("no box while the whole disc fits in the frame", () => {
    expect(visibleBox({ lon: 0, lat: 0, zoom: 1 }, { w: 800, h: 600, r: 250, cx: 400, cy: 300 })).toBeNull()
  })

  test("zoomed in, the box surrounds the camera's point", () => {
    const b = visibleBox({ lon: 140, lat: 35, zoom: 6 }, { w: 800, h: 600, r: 1600, cx: 400, cy: 300 })
    expect(b).not.toBeNull()
    expect(b!.west).toBeLessThan(140)
    expect(b!.east).toBeGreaterThan(140)
    expect(b!.south).toBeLessThan(35)
    expect(b!.north).toBeGreaterThan(35)
  })

  test("levelFor picks a level no coarser than the screen allows and clamps to the range", () => {
    expect(levelFor(1, 4, 7)).toBe(4)
    expect(levelFor(1e-6, 4, 7)).toBe(7)
    const z = levelFor(0.01, 4, 7)
    expect(tileRes(z)).toBeLessThanOrEqual(0.01 * 1.25 + 1e-12)
  })

  test("tilePlan covers the box and wraps columns round the world", () => {
    const p = tilePlan({ west: 170, east: 190, south: 0, north: 10 }, 4)
    expect(p).not.toBeNull()
    expect(p!.box.west).toBeLessThanOrEqual(170)
    expect(p!.box.east).toBeGreaterThanOrEqual(190)
    for (const t of planTiles(p!)) {
      expect(t.col).toBeGreaterThanOrEqual(0)
      expect(t.col).toBeLessThan(tileCols(4))
    }
    expect(planKey(p!)).toMatch(/^4\//)
  })

  test("tilePlan refuses a box that needs too many tiles", () => {
    expect(tilePlan({ west: -180, east: 180, south: -90, north: 90 }, 7)).toBeNull()
  })

  test("planTiles puts a middle tile first", () => {
    const p = tilePlan({ west: 0, east: 50, south: 0, north: 50 }, 4)!
    const first = planTiles(p)[0]
    expect(Math.abs(first.i - (p.cols - 1) / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(first.j - (p.rows - 1) / 2)).toBeLessThanOrEqual(0.5)
  })

  test("bestSource picks the satellite overhead, and none over Europe and Africa", () => {
    expect(bestSource(35, 140)).toBe("himawari")
    expect(bestSource(40, -75)).toBe("goes-east")
    expect(bestSource(40, -125)).toBe("goes-west")
    expect(bestSource(10, 25)).toBeNull()
  })
})
