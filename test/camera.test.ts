import { describe, expect, test, vi } from "vitest"
import { GlobeCameraController, ZOOM_MAX, ZOOM_MIN, cameraBetween, clampLat, wrapLon, zoomed } from "../src/globe/camera"

describe("camera math", () => {
  test("wrapLon keeps longitudes in [-180, 180)", () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(180)).toBe(-180)
    expect(wrapLon(45)).toBe(45)
  })

  test("clampLat stops short of the poles", () => {
    expect(clampLat(89)).toBe(70)
    expect(clampLat(-89)).toBe(-70)
    expect(clampLat(12)).toBe(12)
  })

  test("zoom is clamped to its range", () => {
    expect(zoomed({ lon: 0, lat: 0, zoom: 1 }, 0.1).zoom).toBe(ZOOM_MIN)
    expect(zoomed({ lon: 0, lat: 0, zoom: 10 }, 10).zoom).toBe(ZOOM_MAX)
  })

  test("cameraBetween turns the short way across the date line", () => {
    const mid = cameraBetween({ lon: 170, lat: 0, zoom: 1 }, { lon: -170, lat: 10, zoom: 4 }, 0.5)
    expect(Math.abs(mid.lon)).toBeCloseTo(180)
    expect(mid.lat).toBeCloseTo(5)
    expect(mid.zoom).toBeCloseTo(2) // geometric
  })

  test("cameraBetween hits both ends", () => {
    const a = { lon: 10, lat: 20, zoom: 1 }, b = { lon: 40, lat: -5, zoom: 3 }
    expect(cameraBetween(a, b, 0)).toEqual(a)
    const end = cameraBetween(a, b, 1)
    expect(end.lon).toBeCloseTo(40)
    expect(end.zoom).toBeCloseTo(3)
  })
})

describe("GlobeCameraController", () => {
  test("set notifies subscribers and stops the tour", () => {
    const onTour = vi.fn()
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 }, onTour)
    const seen: number[] = []
    const off = c.subscribe((cam) => seen.push(cam.lon))
    c.set({ lon: 30, lat: 0, zoom: 1 })
    expect(seen).toEqual([30])
    expect(c.camera.lon).toBe(30)
    off()
    c.set({ lon: 40, lat: 0, zoom: 1 })
    expect(seen).toEqual([30])
    expect(onTour).not.toHaveBeenCalled()
  })

  test("without animation frames a fly-to jumps straight to its target", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 })
    const done = vi.fn()
    c.flyTo({ lon: 100, lat: 10, zoom: 2 }, done)
    expect(c.camera).toEqual({ lon: 100, lat: 10, zoom: 2 })
    expect(done).toHaveBeenCalledOnce()
  })

  test("the tour reports itself on and off", () => {
    const states: boolean[] = []
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 3 }, (on) => states.push(on))
    c.setTouring(true)
    expect(c.touring).toBe(true)
    expect(c.camera.zoom).toBe(1)
    c.set({ lon: 5, lat: 0, zoom: 1 })
    expect(c.touring).toBe(false)
    expect(states).toEqual([true, false])
    c.dispose()
  })
})
