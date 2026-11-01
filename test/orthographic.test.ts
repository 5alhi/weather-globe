import { describe, expect, test } from "vitest"
import { globeLandPath, graticulePath, orthoProject } from "../src/geo/orthographic"

describe("orthoProject", () => {
  const view = { lon: 0, lat: 0 }

  test("the point under the camera lands on the centre", () => {
    const p = orthoProject(0, 0, view, 100, 200, 150)
    expect(p.front).toBe(true)
    expect(p.x).toBeCloseTo(200)
    expect(p.y).toBeCloseTo(150)
  })

  test("90° east lands on the right rim, the north pole on the top rim", () => {
    const east = orthoProject(90, 0, view, 100, 0, 0)
    expect(east.x).toBeCloseTo(100)
    expect(east.y).toBeCloseTo(0)
    const north = orthoProject(0, 90, view, 100, 0, 0)
    expect(north.x).toBeCloseTo(0)
    expect(north.y).toBeCloseTo(-100) // screen y grows downward
  })

  test("a point behind the horizon is pulled onto the rim and flagged hidden", () => {
    const p = orthoProject(135, 10, view, 100, 0, 0)
    expect(p.front).toBe(false)
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100)
  })

  test("points in front stay inside the disc", () => {
    for (let lon = -80; lon <= 80; lon += 20) for (let lat = -80; lat <= 80; lat += 20) {
      const p = orthoProject(lon, lat, { lon: 10, lat: 20 }, 50, 0, 0)
      if (p.front) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50 + 1e-9)
    }
  })
})

describe("SVG paths", () => {
  test("a ring wholly behind the globe is dropped", () => {
    const hidden = [179, 1, 179, -1, 178, -1, 179, 1]
    expect(globeLandPath([hidden], { lon: 0, lat: 0 }, 100, 0, 0)).toBe("")
  })

  test("a ring in front is drawn as one closed path", () => {
    const d = globeLandPath([[0, 0, 10, 0, 10, 10, 0, 0]], { lon: 0, lat: 0 }, 100, 0, 0)
    expect(d.startsWith("M")).toBe(true)
    expect(d.endsWith("Z")).toBe(true)
  })

  test("the graticule draws only the near side", () => {
    expect(graticulePath({ lon: 0, lat: 0 }, 100, 0, 0).length).toBeGreaterThan(100)
  })
})
