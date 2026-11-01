import { describe, expect, test } from "vitest"
import { CLOUD_GRID, cloudGridPoints, currentUrl, parseCities, parseGrid } from "../src/data/weather"
import { skyFromWmo, skyLabel } from "../src/geo/sky"
import { cloudField, FIELD_H, FIELD_W } from "../src/globe/cloudField"

const cities = [{ id: "a", name: "A", lat: 10, lon: 20 }, { id: "b", name: "B", lat: -5, lon: 100 }]

describe("Open-Meteo parsing", () => {
  test("cities read in order, with their local offset and time", () => {
    const body = [
      { utc_offset_seconds: 3600, current: { time: "2026-01-15T13:00", temperature_2m: 12.3, cloud_cover: 100, weather_code: 63 } },
      { utc_offset_seconds: 0, current: { time: "2026-01-15T12:00", temperature_2m: "bad", weather_code: 0 } },
    ]
    const [a, b] = parseCities(body, cities)
    expect(a.tempC).toBe(12.3)
    expect(a.sky?.kind).toBe("rain")
    expect(a.atMs).toBe(Date.parse("2026-01-15T12:00:00Z"))
    expect(b.tempC).toBeNull()
    expect(b.sky?.kind).toBe("clear")
  })

  test("one location answers with an object, not a list", () => {
    const [a] = parseCities({ utc_offset_seconds: 0, current: { time: "2026-01-15T12:00", temperature_2m: 1 } }, cities.slice(0, 1))
    expect(a.tempC).toBe(1)
  })

  test("a missing answer leaves every field null", () => {
    const [a] = parseCities(null, cities.slice(0, 1))
    expect(a).toEqual({ id: "a", tempC: null, sky: null, cloudPct: null, utcOffsetS: null, atMs: null })
  })

  test("a malformed grid point stays null and does not shift the rest", () => {
    const n = CLOUD_GRID.rows * CLOUD_GRID.cols
    const body = Array.from({ length: n }, (_, k) => (k === 3 ? null : { current: { cloud_cover: k % 100, cloud_cover_high: 10, precipitation: 0.25, weather_code: k === 5 ? 95 : 3 } }))
    const g = parseGrid(body, 0)
    expect(g.cover[3]).toBeNull()
    expect(g.cover[4]).toBe(4)
    expect(g.storm[5]).toBe(1)
    expect(g.precip[4]).toBe(0.3)
  })

  test("the grid has one point per cell and one request carries them all", () => {
    const pts = cloudGridPoints()
    expect(pts.length).toBe(CLOUD_GRID.rows * CLOUD_GRID.cols)
    const u = new URL(currentUrl(pts, ["cloud_cover"]))
    expect(u.searchParams.get("latitude")!.split(",").length).toBe(pts.length)
    expect(u.searchParams.get("timezone")).toBeNull()
  })
})

describe("sky", () => {
  test("WMO codes map to drawable conditions", () => {
    expect(skyFromWmo(95, 80)?.kind).toBe("storm")
    expect(skyFromWmo(3, 100)).toEqual({ kind: "cloudy", intensity: 0, oktas: 8 })
    expect(skyFromWmo(1234, 0)).toBeNull()
    expect(skyLabel(skyFromWmo(3, 100))).toBe("Overcast")
    expect(skyLabel(skyFromWmo(65, 100))).toBe("Heavy rain")
    expect(skyLabel(null)).toBe("No report")
  })
})

describe("cloudField", () => {
  test("no grid and no cities: no evidence anywhere", () => {
    const f = cloudField(null)
    expect(f.data.length).toBe(FIELD_W * FIELD_H * 4)
    expect(f.validity.every((v) => v === 0)).toBe(true)
  })

  test("a city's own report is painted in around it", () => {
    const f = cloudField(null, [{ lat: 0.5, lon: 0.5, sky: skyFromWmo(63, 100) }])
    const k = (89 * FIELD_W + 180) * 4 // the texel at 0.5°N, 0.5°E
    expect(f.data[k]).toBeGreaterThan(200)
    expect(f.data[k + 2]).toBeGreaterThan(100)
  })

  test("the model grid fills the field between its points", () => {
    const n = CLOUD_GRID.rows * CLOUD_GRID.cols
    const grid = { atMs: 0, ...CLOUD_GRID, cover: new Array(n).fill(50), high: new Array(n).fill(0), precip: new Array(n).fill(0), storm: new Array<0 | 1>(n).fill(0) }
    const f = cloudField(grid)
    const k = (89 * FIELD_W + 180) * 4
    expect(f.validity[k]).toBe(255)
    expect(f.data[k]).toBe(Math.round(0.5 * 255))
  })
})
