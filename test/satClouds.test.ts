import { describe, expect, test } from "vitest"
import { satCloudField } from "../src/globe/satClouds"

/** a grey image of the world with a bright (cold) block in the middle */
function image(w: number, h: number, ground: number, block: number) {
  const gray = new Uint8Array(w * h).fill(ground)
  for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y++) for (let x = Math.floor(w * 0.4); x < Math.floor(w * 0.6); x++) gray[y * w + x] = block
  return { w, h, gray, alpha: null, latTop: 72, latBottom: -72 }
}

describe("satCloudField", () => {
  const w = 360, h = 144
  const field = satCloudField(image(w, h, 60, 220))
  const at = (x: number, y: number, c: number) => field[(y * w + x) * 4 + c]

  test("clear ground reads as no cloud", () => {
    expect(at(10, 10, 0)).toBe(0)
  })

  test("a bright, cold block reads as full, high cloud", () => {
    expect(at(w / 2, h / 2, 0)).toBe(255)
    expect(at(w / 2, h / 2, 1)).toBe(255)
  })

  test("coverage is carried in alpha", () => {
    expect(at(5, 5, 3)).toBe(255)
  })

  test("a moderately bright cloud is mostly cloud but not high cloud", () => {
    const f = satCloudField(image(w, h, 60, 140))
    expect(f[((h / 2) * w + w / 2) * 4]).toBeGreaterThan(180)
    expect(f[((h / 2) * w + w / 2) * 4 + 1]).toBe(0)
  })

  test("pixels without data stay empty", () => {
    const img = image(w, h, 60, 220)
    const alpha = new Uint8Array(w * h).fill(255)
    alpha[0] = 0
    const f = satCloudField({ ...img, alpha })
    expect([f[0], f[1], f[2], f[3]]).toEqual([0, 0, 0, 0])
  })
})
