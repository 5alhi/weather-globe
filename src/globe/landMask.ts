// The land as an equirectangular picture (longitude across, latitude down) for the globe's GPU drawing, from Natural
// Earth's 1:50m coastline: red = land, crisp; green = the land blurred a little (water near a coast), blue = blurred a lot
// (how far inland a place is) — both drawn smaller and stretched, the blur being the costly part. A ring that crosses the
// date line is unwrapped and drawn on both sides of it; one that circles a pole (Antarctica) is closed along that pole's
// edge.
import { WORLD_LAND_FINE } from "../geo/worldLandFine"

export const LAND_MASK_W = 4096
export const LAND_MASK_H = 2048

/** A ring (flat lon, lat list) with continuous longitudes, and how many times it circles a pole (−1, 0 or 1). */
export function unwrapRing(ring: readonly number[]): { pts: number[]; turns: number } {
  const pts: number[] = []
  let off = 0
  for (let i = 0; i + 1 < ring.length; i += 2) {
    let lon = ring[i] + off
    if (pts.length) {
      const d = lon - pts[pts.length - 2]
      if (d > 180) { off -= 360; lon -= 360 } else if (d < -180) { off += 360; lon += 360 }
    }
    pts.push(lon, ring[i + 1])
  }
  if (pts.length < 4) return { pts, turns: 0 }
  let close = pts[0] - pts[pts.length - 2]
  close -= 360 * Math.round(close / 360)
  return { pts, turns: Math.round((pts[pts.length - 2] - pts[0] + close) / 360) }
}

let cached: HTMLCanvasElement | null = null

/** The land's outline at the mask's full size. */
function landPath(): Path2D {
  const x = (lon: number) => ((lon + 180) / 360) * LAND_MASK_W
  const y = (lat: number) => ((90 - lat) / 180) * LAND_MASK_H
  const path = new Path2D()
  for (const ring of WORLD_LAND_FINE) {
    const { pts, turns } = unwrapRing(ring)
    if (pts.length < 6) continue
    if (turns !== 0) {
      let latSum = 0
      for (let i = 1; i < pts.length; i += 2) latSum += pts[i]
      const pole = latSum < 0 ? -90 : 90
      pts.push(pts[pts.length - 2], pole, pts[0], pole)
    }
    for (const shift of [-360, 0, 360]) {
      path.moveTo(x(pts[0] + shift), y(pts[1]))
      for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(x(pts[i] + shift), y(pts[i + 1]))
      path.closePath()
    }
  }
  return path
}

/** The land filled in one colour and blurred, on a canvas `scale` times the mask's size (blur in that canvas's pixels). */
function blurredLand(path: Path2D, scale: number, blurPx: number, colour: string): HTMLCanvasElement {
  const b = document.createElement("canvas")
  b.width = Math.round(LAND_MASK_W * scale)
  b.height = Math.round(LAND_MASK_H * scale)
  const g = b.getContext("2d")
  if (!g) return b
  g.fillStyle = "#000"
  g.fillRect(0, 0, b.width, b.height)
  g.setTransform(scale, 0, 0, scale, 0, 0)
  g.filter = `blur(${blurPx}px)`
  g.fillStyle = colour
  g.fill(path, "evenodd")
  return b
}

/** Drawn once per window (4096 × 2048; the blurred channels at a half and a quarter of that). */
export function landMask(): HTMLCanvasElement {
  if (cached) return cached
  const c = document.createElement("canvas")
  c.width = LAND_MASK_W
  c.height = LAND_MASK_H
  const ctx = c.getContext("2d")
  if (!ctx) return c
  const path = landPath()
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, LAND_MASK_W, LAND_MASK_H)
  ctx.fillStyle = "rgb(255 0 0)"
  ctx.fill(path, "evenodd")
  ctx.globalCompositeOperation = "lighter"
  ctx.imageSmoothingQuality = "high"
  // ~1° of blur near the coasts, ~6° inland: the same reach as at any size
  ctx.drawImage(blurredLand(path, 0.5, 6, "rgb(0 255 0)"), 0, 0, LAND_MASK_W, LAND_MASK_H)
  ctx.drawImage(blurredLand(path, 0.25, 18, "rgb(0 0 255)"), 0, 0, LAND_MASK_W, LAND_MASK_H)
  ctx.globalCompositeOperation = "source-over"
  cached = c
  return c
}
