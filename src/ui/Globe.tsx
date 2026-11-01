import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { globeLandPath, graticulePath } from "../geo/orthographic"
import { subsolarPoint, sunCosAt } from "../geo/sun"
import type { Sky } from "../geo/sky"
import { WORLD_LAND } from "../geo/worldLand"
import { GlobeGl } from "../globe/globeGl"
import { cloudField, type CloudGrid } from "../globe/cloudField"
import { pillBox, pillWidth, placeLabels, type LabelSide } from "../globe/labels"
import { tempColor } from "../globe/tempColor"
import { clampLat, reducedMotion, wrapLon, zoomed, type GlobeCamera, type GlobeCameraController } from "../globe/camera"
import type { SatField } from "../globe/satClouds"
import { DetailLoader, type DetailStatus } from "../globe/detail"
import type { TileFetcher } from "../data/tileFetcher"

// The globe, in three layers on one orthographic projection (screen pixels):
//  - the GPU (globeGl.ts): the surface as NASA's Blue Marble shows it, the sun's real day and night, the clouds where a
//    satellite saw them (the weather model's beyond its image), the atmosphere — and, once the view stands still zoomed
//    in, the sharp detail of the part in view (detail.ts: the surface's tiles, the clouds sharpened by the infrared of
//    the satellite overhead);
//  - SVG: each city's marker, a ring lying ON the surface (it tilts and narrows with the globe), with a silver glow where
//    it is night;
//  - label pills (HTML): name and temperature on one cold → hot scale. The labels keep clear of the markers and of each
//    other, and hold their places as the globe moves (labels.ts).
// The camera lives outside React (camera.ts): a drag, the wheel, a fly-to or the tour moves it and layout() writes the
// new positions straight into the elements (looked up once per render, not per frame), so the globe turns at the
// display's frame rate without re-rendering. Frames are drawn only when something moves: the camera, new clouds being
// baked, a sharp picture fading in, lightning in a storm.

export interface GlobeCity {
  id: string
  name: string
  lon: number
  lat: number
  /** the temperature as the pill shows it, and in °F for its colour */
  temp: { text: string; f: number } | null
  /** the sky now, for the clouds over the city */
  sky: Sky | null
  /** the tooltip: the conditions and when they were read */
  note: string
}

/** the globe's radius at zoom 1, as a share of the frame's smaller side (room left for the atmosphere) */
const FIT = 0.46
const DRAG_START_PX = 4
/** the ring's radius on the ground, as it shows face-on (px) */
const MARKER_PX = 4.2
const RING_POINTS = 24
const RING_TRIG = Array.from({ length: RING_POINTS }, (_, k) => [Math.cos((2 * Math.PI * k) / RING_POINTS), Math.sin((2 * Math.PI * k) / RING_POINTS)])
/** lightning flickers this often while a storm shows */
const STORM_MS = 200
/** device pixels per CSS pixel, at most: past 2 the eye gains little and the shader pays for every pixel */
const DPR_MAX = 2
/** the sun is redrawn this often (it moves a quarter of a degree a minute) */
const SUN_EVERY_MS = 60_000
/** below this sun height (cosine of the zenith angle) a city counts as in the night */
const NIGHT_COS = -0.05
const RAD = Math.PI / 180

interface Props {
  cities: GlobeCity[]
  clouds: CloudGrid | null
  /** the satellite's cloud field (useSatellite.ts); null = the model's clouds everywhere */
  satellite: SatField | null
  selected: string | null
  onCity: (id: string) => void
  controller: GlobeCameraController
  showClouds: boolean
  tiles: TileFetcher
  /** whether the GPU layer (and with it the clouds) is drawn; false = the plain SVG globe */
  onGpu?: (ok: boolean) => void
  /** what the sharp pictures are now, for the caption */
  onDetail?: (s: DetailStatus) => void
  /** screen space reserved at the bottom (the caption), in CSS pixels */
  reserveBottom?: number
}

type Vec3 = [number, number, number]
/** a world vector (x toward 0° lon, y toward 90°E, z north) in the camera's frame (x right, y up, z toward the viewer) */
function toCam(v: Vec3, view: GlobeCamera): Vec3 {
  const l0 = view.lon * RAD, p0 = view.lat * RAD
  const a = v[0] * Math.cos(l0) + v[1] * Math.sin(l0), b = -v[0] * Math.sin(l0) + v[1] * Math.cos(l0)
  return [b, Math.cos(p0) * v[2] - Math.sin(p0) * a, Math.sin(p0) * v[2] + Math.cos(p0) * a]
}
const unit = (lat: number, lon: number): Vec3 => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]

/** the elements layout() moves, found once per render */
interface CityEls { g: SVGGElement; lat: number; lon: number; rings: Array<[SVGPolygonElement, number]>; pill: HTMLElement | null }

export const Globe = memo(function Globe({ cities, clouds, satellite, selected, onCity, controller, showClouds, tiles, onGpu, onDetail, reserveBottom = 0 }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [gl, setGl] = useState<GlobeGl | "none" | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => { const b = el.getBoundingClientRect(); setSize((s) => (Math.round(b.width) === s.w && Math.round(b.height) === s.h ? s : { w: Math.round(b.width), h: Math.round(b.height) })) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener("resize", measure)
    return () => { ro.disconnect(); window.removeEventListener("resize", measure) }
  }, [])
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), SUN_EVERY_MS); return () => window.clearInterval(id) }, [])
  const sun = useMemo(() => subsolarPoint(now), [now])

  useEffect(() => { if (gl != null) onGpu?.(gl !== "none") }, [gl, onGpu])
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    let live = true, restores = 0
    let current = GlobeGl.create(c)
    setGl(current ?? "none")
    const lost = (e: Event) => { e.preventDefault(); setGl("none") }
    const restored = () => {
      if (!live || restores >= 2) return
      restores++
      const next = GlobeGl.create(c)
      if (!live) { next?.dispose(); return }
      if (next) { current = next; setGl(next) }
      else setGl("none")
    }
    c.addEventListener("webglcontextlost", lost)
    c.addEventListener("webglcontextrestored", restored)
    return () => {
      live = false
      c.removeEventListener("webglcontextlost", lost)
      c.removeEventListener("webglcontextrestored", restored)
      current?.dispose()
    }
  }, [])

  // the clouds over the world: the model's grid with each city's own report painted in — rebuilt only when the grid or
  // a city's sky changes
  const skies = useMemo(() => cities.map((c) => ({ lat: c.lat, lon: c.lon, sky: c.sky })), [cities])
  const skyKey = JSON.stringify(skies)
  const skiesRef = useRef(skies)
  skiesRef.current = skies
  const cloudData = useMemo(() => (clouds || skiesRef.current.some((c) => c.sky) ? cloudField(clouds, skiesRef.current) : null), [clouds, skyKey])
  const stormy = useMemo(() => {
    const data = cloudData?.data
    if (!data) return false
    for (let k = 3; k < data.length; k += 4) if (data[k] > 0) return true
    return false
  }, [cloudData])

  const { w, h } = size
  // never under a device pixel per CSS pixel (a zoomed-out window), at most DPR_MAX
  const dpr = typeof window !== "undefined" ? Math.max(1, Math.min(DPR_MAX, window.devicePixelRatio || 1)) : 1
  const pillW = useMemo(() => new Map(cities.map((c) => [c.id, pillWidth(c.name, c.temp?.text ?? null)])), [cities])
  const night = useMemo(() => new Set(cities.filter((c) => sunCosAt(c.lat, c.lon, sun) < NIGHT_COS).map((c) => c.id)), [cities, sun])

  // everything layout() needs from the latest render
  const data = useRef({ showClouds, selected, sun, pillW, w, h, dpr, reserveBottom, gl: null as GlobeGl | null })
  data.current = { showClouds, selected, sun, pillW, w, h, dpr, reserveBottom, gl: gl && gl !== "none" ? gl : null }
  const els = useRef(new Map<string, CityEls>())
  /** where each label sat a moment ago, so it holds its place as the globe moves */
  const sidesRef = useRef(new Map<string, LabelSide>())
  /** a frame asked for (a bake under way, a sharp picture fading in) */
  const frameRef = useRef<number | null>(null)
  /** the sharp detail of the part in view */
  const detailRef = useRef<DetailLoader | null>(null)
  const fallbackRefs = useRef<{ sphere: SVGCircleElement | null; grid: SVGPathElement | null; land: SVGPathElement | null }>({ sphere: null, grid: null, land: null })

  /** Writes the current camera's positions into the elements, and draws the GPU layer. */
  const layout = useCallback(() => {
    const d = data.current
    if (!d.w || !d.h) return
    const cam = controller.camera
    const r = FIT * Math.min(d.w, d.h) * cam.zoom, cx = d.w / 2, cy = d.h / 2
    const still = reducedMotion()
    const tS = still ? 0 : (performance.now() / 1000) % 100_000
    d.gl?.draw({ width: Math.round(d.w * d.dpr), height: Math.round(d.h * d.dpr), cx: cx * d.dpr, cy: cy * d.dpr, r: r * d.dpr, view: cam, sun: d.sun, timeS: tS, clouds: d.showClouds, whole: still })
    detailRef.current?.view(cam, { w: d.w * d.dpr, h: d.h * d.dpr, r: r * d.dpr, cx: cx * d.dpr, cy: cy * d.dpr })
    const fb = fallbackRefs.current
    if (fb.land) {
      fb.sphere?.setAttribute("cx", String(cx)); fb.sphere?.setAttribute("cy", String(cy)); fb.sphere?.setAttribute("r", r.toFixed(1))
      fb.grid?.setAttribute("d", graticulePath(cam, r, cx, cy))
      fb.land.setAttribute("d", globeLandPath(WORLD_LAND, cam, r, cx, cy))
    }

    // cities: where each stands, and the ring lying on the ground around it
    const items: Array<{ id: string; x: number; y: number; marker: [number, number, number, number]; w: number; rank: number }> = []
    for (const [id, c] of els.current) {
      const lat = c.lat * RAD, lon = c.lon * RAD
      const C = toCam(unit(c.lat, c.lon), cam)
      const x = cx + r * C[0], y = cy - r * C[1]
      if (C[2] <= 0.02 || x < -40 || x > d.w + 40 || y < -40 || y > d.h + 40) {
        c.g.style.display = "none"
        if (c.pill) c.pill.style.display = "none"
        continue
      }
      c.g.style.display = ""
      c.g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
      // east and north along the ground, in the camera's frame: the ring is drawn in the ground's own plane
      const E = toCam([-Math.sin(lon), Math.cos(lon), 0], cam)
      const N = toCam([-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)], cam)
      for (const [poly, px] of c.rings) {
        const alpha = px / r, ca = Math.cos(alpha), sa = Math.sin(alpha)
        let pts = ""
        for (const [co, si] of RING_TRIG) {
          const qx = C[0] * ca + (E[0] * co + N[0] * si) * sa, qy = C[1] * ca + (E[1] * co + N[1] * si) * sa
          pts += `${(cx + r * qx - x).toFixed(2)},${(cy - r * qy - y).toFixed(2)} `
        }
        poly.setAttribute("points", pts)
      }
      const m = MARKER_PX + 3
      // the selected city first, then the ones nearest the middle of the view
      items.push({ id, x, y, w: d.pillW.get(id) ?? 80, rank: id === d.selected ? -1 : 1 - C[2], marker: [-m, -m, m, m] })
    }

    // labels: the most important first, clear of every marker and every other label, each held where it was while it
    // still fits
    items.sort((a, b) => a.rank - b.rank)
    const prev = sidesRef.current
    const sides = placeLabels(items, [], items.map((it) => prev.get(it.id) ?? null), { width: d.w, height: d.h, reserveBottom: d.reserveBottom + 8 })
    const next = new Map<string, LabelSide>()
    items.forEach((it, i) => {
      const pill = els.current.get(it.id)?.pill
      if (!pill) return
      const side = sides[i]
      if (!side) { pill.style.display = "none"; return }
      next.set(it.id, side)
      const b = pillBox(side, it)
      pill.style.display = ""
      pill.style.transform = `translate3d(${(it.x + b[0]).toFixed(1)}px, ${(it.y + b[1]).toFixed(1)}px, 0)`
    })
    sidesRef.current = next

    // another frame while the clouds on show are being baked or a sharp picture fades in
    if (((d.showClouds && d.gl?.busy) || d.gl?.fading) && frameRef.current == null) {
      frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; layoutRef.current() })
    }
  }, [controller])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(() => () => { if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current) }, [])

  // new clouds are drawn at once, not at the next move (the globe may be standing still)
  useEffect(() => { if (gl && gl !== "none") { gl.setClouds(cloudData); layout() } }, [gl, cloudData, layout])
  useEffect(() => { if (gl && gl !== "none") { gl.setSatellite(satellite); layout() } }, [gl, satellite, layout])

  // the sharp pictures: NASA's picture of the whole world once, and the detail of the part in view (the drawn colours
  // stay where the pictures cannot be had)
  const onDetailRef = useRef(onDetail)
  onDetailRef.current = onDetail
  useEffect(() => {
    if (!gl || gl === "none") return
    let live = true
    const loader = new DetailLoader(gl, tiles, () => layoutRef.current(), (st) => onDetailRef.current?.(st))
    detailRef.current = loader
    void tiles.base().then(async (bytes) => {
      if (!live) return
      if (!bytes) { loader.photoFailed("NASA base image unavailable"); return }
      const img = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
      if (live) { gl.setPhoto(img); loader.photoShown(); layoutRef.current() }
      img.close()
    }).catch((err: unknown) => { if (live) loader.photoFailed(`NASA base image could not be decoded (${err instanceof Error ? err.message : "decode failed"})`) })
    return () => { live = false; loader.dispose(); detailRef.current = null }
  }, [gl, tiles])
  useEffect(() => { detailRef.current?.setHour(satellite?.timeMs ?? null) }, [gl, satellite])
  useEffect(() => { detailRef.current?.setClouds(showClouds) }, [gl, showClouds])

  // after every render: find the elements, then place them
  useLayoutEffect(() => {
    const svg = svgRef.current, pills = pillsRef.current
    if (!svg || !pills) return
    const found = new Map<string, CityEls>()
    for (const g of svg.querySelectorAll<SVGGElement>("g.city")) {
      found.set(g.dataset.city ?? "", {
        g, lat: Number(g.dataset.lat), lon: Number(g.dataset.lon), pill: null,
        rings: [...g.querySelectorAll<SVGPolygonElement>("polygon[data-px]")].map((p): [SVGPolygonElement, number] => [p, Number(p.dataset.px)]),
      })
    }
    for (const p of pills.querySelectorAll<HTMLElement>(".pill-city")) { const c = found.get(p.dataset.city ?? ""); if (c) c.pill = p }
    els.current = found
    layout()
  })
  useEffect(() => controller.subscribe(() => layout()), [controller, layout])
  // lightning in a storm flickers while it shows
  useEffect(() => {
    if (!showClouds || !stormy || reducedMotion()) return
    const id = window.setInterval(() => { if (!document.hidden) layout() }, STORM_MS)
    return () => window.clearInterval(id)
  }, [showClouds, stormy, layout])

  // the wheel zooms the globe, never the page (a passive React listener could not stop the page scrolling)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); controller.set(zoomed(controller.camera, Math.exp(-ev.deltaY * 0.0015))) }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [controller])

  const drag = useRef<{ x: number; y: number; camera: GlobeCamera; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onDown = (ev: React.PointerEvent<HTMLDivElement>) => { if (ev.button === 0) drag.current = { x: ev.clientX, y: ev.clientY, camera: controller.camera, moved: false } }
  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const dr = drag.current
    if (!dr || ev.buttons === 0) return
    if (!dr.moved && Math.hypot(ev.clientX - dr.x, ev.clientY - dr.y) < DRAG_START_PX) return
    // the pointer is captured only once a drag starts: a plain click still reaches the city under it
    if (!dr.moved) { dr.moved = true; setDragging(true); ev.currentTarget.setPointerCapture(ev.pointerId) }
    const degPerPx = 180 / Math.PI / (FIT * Math.min(w, h) * dr.camera.zoom)
    controller.set({ ...dr.camera, lon: wrapLon(dr.camera.lon - (ev.clientX - dr.x) * degPerPx), lat: clampLat(dr.camera.lat + (ev.clientY - dr.y) * degPerPx) })
  }
  const onUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId)
    setDragging(false)
    // a click that never turned the globe still reaches the city under it
    setTimeout(() => { drag.current = null }, 0)
  }
  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return // a focused city handles its own keys
    const cam = controller.camera, step = 10 / cam.zoom
    const move = (c: GlobeCamera) => { ev.preventDefault(); controller.set(c) }
    if (ev.key === "+" || ev.key === "=") return move(zoomed(cam, 1.25))
    if (ev.key === "-") return move(zoomed(cam, 0.8))
    const k: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = k[ev.key]
    if (m) move({ ...cam, lon: wrapLon(cam.lon + m[0]), lat: clampLat(cam.lat + m[1]) })
  }
  const open = (id: string) => { if (!drag.current?.moved) onCity(id) }

  return (
    <div ref={stageRef} className={`globe-stage${dragging ? " dragging" : ""}`} role="application" tabIndex={0}
      aria-label="Globe — drag or use the arrow keys to turn it, scroll or + / − to zoom; Tab moves between the labelled cities"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <canvas ref={canvasRef} className="globe-gl" width={Math.max(1, Math.round(w * dpr))} height={Math.max(1, Math.round(h * dpr))} style={{ width: w, height: h }} />
      <svg ref={svgRef} className="globe-svg" width={w} height={h} viewBox={`0 0 ${w || 1} ${h || 1}`}>
        <defs>
          <radialGradient id="g-citylight">
            <stop offset="0" stopColor="#e9eeff" stopOpacity="0.7" />
            <stop offset="0.45" stopColor="#b9c6ff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#8d97dc" stopOpacity="0" />
          </radialGradient>
        </defs>
        {gl === "none" && (
          <g className="globe-fallback">
            <circle className="sphere" ref={(el) => { fallbackRefs.current.sphere = el }} />
            <path className="graticule" ref={(el) => { fallbackRefs.current.grid = el }} />
            <path className="land" ref={(el) => { fallbackRefs.current.land = el }} />
          </g>
        )}
        <g>
          {cities.map((c) => (
            <g key={c.id} data-city={c.id} data-lat={c.lat} data-lon={c.lon} style={{ display: "none" }} onClick={() => open(c.id)}
              className={`city${selected === c.id ? " selected" : ""}${night.has(c.id) ? " night" : ""}`}>
              <title>{`${c.name}${c.note ? `\n${c.note}` : ""}`}</title>
              {night.has(c.id) && <circle className="citylight" r={MARKER_PX + 7} />}
              {selected === c.id && <polygon className="sel" data-px={MARKER_PX + 5} />}
              <polygon className="ring" data-px={MARKER_PX} />
              <circle className="dot" r={1.6} />
              <circle className="hit" r={11} />
            </g>
          ))}
        </g>
      </svg>
      <div ref={pillsRef} className="globe-pills">
        {cities.map((c) => {
          const temp = c.temp?.text ?? null
          return (
            <button key={c.id} type="button" data-city={c.id} className={`pill-city${selected === c.id ? " selected" : ""}`} style={{ display: "none", minWidth: pillW.get(c.id) }}
              onClick={() => open(c.id)} aria-label={`${c.name}${temp ? `, ${temp}` : ""}${c.note ? `. ${c.note}` : ""}`}
              title={`${c.name}${c.note ? `\n${c.note}` : ""}`}>
              <span className="pc-name">{c.name}</span>
              {temp && c.temp && <span className="pc-temp" style={{ ["--tc" as string]: tempColor(c.temp.f) }}>{temp}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
})
