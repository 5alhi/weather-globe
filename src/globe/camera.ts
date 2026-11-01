// The globe's camera, kept outside React: a drag, the wheel, a fly-to or the world tour moves it many times a second and
// the globe redraws straight from it (Globe.tsx subscribes), so React renders only when something else changes. The tour
// turns the globe eastward like the Earth at TOUR_DEG_PER_S, timed by the clock (smooth at any frame rate); under reduced
// motion a fly-to jumps and the tour shows a still, whole globe. Animation frames stop while the window is hidden.

/** where the globe looks from, and how close: zoom 1 = the whole globe in the frame */
export interface GlobeCamera { lon: number; lat: number; zoom: number }

export const ZOOM_MIN = 1
/** close enough to see the land at its picture's own resolution (~500 m) */
export const ZOOM_MAX = 16
/** one turn in ~90 s */
export const TOUR_DEG_PER_S = 4
const TOUR_VIEW = { lat: 18, zoom: 1 }
const FLY_MS = 650

export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180
export const clampLat = (lat: number): number => Math.max(-70, Math.min(70, lat))

/** The camera `t` (0..1) of the way from `a` to `b`, turning the short way round in longitude. */
export function cameraBetween(a: GlobeCamera, b: GlobeCamera, t: number): GlobeCamera {
  let dl = b.lon - a.lon
  if (dl > 180) dl -= 360
  else if (dl < -180) dl += 360
  return { lon: wrapLon(a.lon + dl * t), lat: a.lat + (b.lat - a.lat) * t, zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) }
}

export function zoomed(c: GlobeCamera, factor: number): GlobeCamera {
  return { ...c, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * factor)) }
}

/** The viewer asked for less motion. */
export const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

export class GlobeCameraController {
  private cam: GlobeCamera
  private readonly listeners = new Set<(c: GlobeCamera) => void>()
  private frame: number | null = null
  private tour = false

  constructor(initial: GlobeCamera, private readonly onTouring?: (on: boolean) => void) { this.cam = initial }

  get camera(): GlobeCamera { return this.cam }
  get touring(): boolean { return this.tour }

  subscribe(fn: (c: GlobeCamera) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A move the user made (drag, wheel, keys, zoom buttons): any fly-to or tour stops. */
  set(c: GlobeCamera): void {
    this.stop()
    this.setTour(false)
    this.emit(c)
  }

  flyTo(target: GlobeCamera, then?: () => void): void {
    this.stop()
    if (then == null) this.setTour(false)
    if (reducedMotion() || typeof requestAnimationFrame === "undefined") { this.emit(target); then?.(); return }
    const from = this.cam, t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / FLY_MS), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      this.emit(cameraBetween(from, target, e))
      if (k < 1) this.frame = requestAnimationFrame(step)
      else { this.frame = null; then?.() }
    }
    this.frame = requestAnimationFrame(step)
  }

  /** The world tour: out to the whole globe, then turning until a move or the button stops it. */
  setTouring(on: boolean): void {
    this.stop()
    this.setTour(on)
    if (!on) return
    this.flyTo({ ...TOUR_VIEW, lon: this.cam.lon }, () => {
      if (!this.tour || reducedMotion() || typeof requestAnimationFrame === "undefined") return
      let last = performance.now()
      const spin = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        this.emit({ ...this.cam, lon: wrapLon(this.cam.lon - TOUR_DEG_PER_S * dt) })
        this.frame = requestAnimationFrame(spin)
      }
      this.frame = requestAnimationFrame(spin)
    })
  }

  dispose(): void { this.stop(); this.listeners.clear() }

  private setTour(on: boolean): void {
    if (this.tour === on) return
    this.tour = on
    this.onTouring?.(on)
  }
  private stop(): void { if (this.frame != null) { cancelAnimationFrame(this.frame); this.frame = null } }
  private emit(c: GlobeCamera): void {
    this.cam = c
    for (const fn of this.listeners) fn(c)
  }
}
