// The globe: an orthographic projection — the earth seen from far away above a chosen point (`view`). Pure.
// Points on the near hemisphere project inside a disc of radius r; a point behind the horizon is pulled onto the rim
// along its own direction, so a land outline that crosses the horizon stays a closed shape hugging the edge (the rim
// between two hidden points is filled in by an arc, not a chord across the disc).
const RAD = Math.PI / 180

export interface GlobeView { lon: number; lat: number }
export interface GlobePoint { x: number; y: number; front: boolean }

/** lon/lat (degrees) on a globe of radius r centred at (cx, cy), seen from above `view`. */
export function orthoProject(lon: number, lat: number, view: GlobeView, r: number, cx: number, cy: number): GlobePoint {
  const l = (lon - view.lon) * RAD, p = lat * RAD, p0 = view.lat * RAD
  const cosP = Math.cos(p)
  const x = cosP * Math.sin(l)
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cosP * Math.cos(l)
  const cosC = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cosP * Math.cos(l)
  if (cosC >= 0) return { x: cx + r * x, y: cy - r * y, front: true }
  const n = Math.hypot(x, y) || 1
  return { x: cx + (r * x) / n, y: cy - (r * y) / n, front: false }
}

/** SVG path of land rings (flat lon, lat lists): a ring wholly behind the horizon is dropped; the others are drawn with
 *  their hidden stretches along the rim. Use with fill-rule evenodd (lakes are holes). */
export function globeLandPath(rings: ReadonlyArray<readonly number[]>, view: GlobeView, r: number, cx: number, cy: number): string {
  const out: string[] = []
  for (const ring of rings) {
    const pts: GlobePoint[] = []
    let anyFront = false
    for (let i = 0; i + 1 < ring.length; i += 2) {
      const p = orthoProject(ring[i], ring[i + 1], view, r, cx, cy)
      if (p.front) anyFront = true
      pts.push(p)
    }
    if (!anyFront) continue
    const d: string[] = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], prev = i > 0 ? pts[i - 1] : null
      if (prev && !prev.front && !p.front) for (const q of rimBetween(prev, p, r, cx, cy)) d.push(`L${q.x.toFixed(1)} ${q.y.toFixed(1)}`)
      d.push(`${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    }
    out.push(`${d.join("")}Z`)
  }
  return out.join("")
}

/** Points along the rim between two rim points, every ≤ 10°, the short way round (both exclusive). */
function rimBetween(a: GlobePoint, b: GlobePoint, r: number, cx: number, cy: number): GlobePoint[] {
  const ta = Math.atan2(a.y - cy, a.x - cx), tb = Math.atan2(b.y - cy, b.x - cx)
  let dt = tb - ta
  if (dt > Math.PI) dt -= 2 * Math.PI
  else if (dt < -Math.PI) dt += 2 * Math.PI
  const n = Math.floor(Math.abs(dt) / (10 * RAD))
  const out: GlobePoint[] = []
  for (let k = 1; k <= n; k++) { const t = ta + (dt * k) / (n + 1); out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), front: false }) }
  return out
}

/** Meridians and parallels every 30° as an SVG path, near side only. */
export function graticulePath(view: GlobeView, r: number, cx: number, cy: number): string {
  const d: string[] = []
  const line = (pts: Array<[number, number]>) => {
    let pen = false
    for (const [lon, lat] of pts) {
      const p = orthoProject(lon, lat, view, r, cx, cy)
      if (!p.front) { pen = false; continue }
      d.push(`${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      pen = true
    }
  }
  for (let lon = -180; lon < 180; lon += 30) line(Array.from({ length: 61 }, (_, i) => [lon, -90 + i * 3] as [number, number]))
  for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as [number, number]))
  return d.join("")
}
