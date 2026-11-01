import { describe, expect, test } from "vitest"
import { subsolarPoint, sunCosAt } from "../src/geo/sun"

const at = (iso: string) => Date.parse(iso)

describe("subsolarPoint", () => {
  test("the sun is over the equator near an equinox", () => {
    expect(Math.abs(subsolarPoint(at("2024-03-20T03:06:00Z")).lat)).toBeLessThan(0.2)
  })

  test("the sun is over the tropics at the solstices", () => {
    expect(subsolarPoint(at("2024-06-20T20:51:00Z")).lat).toBeCloseTo(23.44, 1)
    expect(subsolarPoint(at("2024-12-21T09:20:00Z")).lat).toBeCloseTo(-23.44, 1)
  })

  test("at 12:00 UTC the sun is near the prime meridian (within the equation of time)", () => {
    const s = subsolarPoint(at("2024-04-15T12:00:00Z"))
    expect(Math.abs(s.lon)).toBeLessThan(4.5)
  })

  test("the sun moves 15° west an hour", () => {
    const a = subsolarPoint(at("2024-04-15T12:00:00Z")), b = subsolarPoint(at("2024-04-15T13:00:00Z"))
    expect(a.lon - b.lon).toBeCloseTo(15, 1)
  })
})

describe("sunCosAt: the terminator", () => {
  const sun = { lat: 0, lon: 0 }

  test("the subsolar point has the sun overhead", () => {
    expect(sunCosAt(0, 0, sun)).toBeCloseTo(1)
  })

  test("90° away is on the terminator, the antipode is midnight", () => {
    expect(sunCosAt(0, 90, sun)).toBeCloseTo(0)
    expect(sunCosAt(0, -90, sun)).toBeCloseTo(0)
    expect(sunCosAt(0, 180, sun)).toBeCloseTo(-1)
  })

  test("a summer pole stays lit all day", () => {
    const june = subsolarPoint(at("2024-06-21T00:00:00Z"))
    for (let lon = -180; lon < 180; lon += 30) expect(sunCosAt(89, lon, june)).toBeGreaterThan(0)
  })
})
