// The globe's sharp detail of the part in view, once the view has stood still a moment (data/tileFetcher.ts fetches and
// caches the tiles; globeGl.ts draws them):
//  - the surface: NASA's Blue Marble tiles at the level that matches the screen there, laid into one texture covering
//    the view (the one on show stays until the next is in);
//  - the clouds: the infrared of the satellite with the best view of the middle of the picture (GOES-West, GOES-East or
//    Himawari), at the hour of the world's cloud image, turned into the clouds' fine structure off the
//    main thread (detailWorker.ts → irDecode.ts) and rebuilt as its tiles come in. It sharpens the cloud the world
//    image shows, near that cloud only, at the same hour; what is on show of another satellite or hour goes at once.
// Nothing is asked while the view is wide enough for the world's own pictures, and the detail is let go then. A tile that
// could not be had is asked again a minute later; the status says what is drawn, not what was asked.
import { CLOUD_MIN_LEVEL, CLOUD_SOURCES, SURFACE_MAX_LEVEL, SURFACE_MIN_LEVEL, TILE_PX, tileCols, tileRes, tileRows, tileSpan, type CloudSource, type TileAnswer, type TileReq } from "../geo/tiles"
import type { GlobeCamera } from "./camera"
import type { GlobeGl } from "./globeGl"

const RAD = Math.PI / 180
/** degrees a pixel of the world's own pictures (4096 wide): finer than this on screen, the detail is worth asking for */
export const WORLD_DEG_PER_PX = 360 / 4096
/** a level's pixels may be this much coarser than the screen's */
const LEVEL_SLACK = 1.25
/** the land's sharp picture spans at most this many tiles a side (3072 px), fewer where the GPU holds less */
export const MAX_SIDE = 6
/** the view has stood still this long */
const STILL_MS = 250
/** a satellite is used out to this angle from the point below it */
export const MAX_VIEW_DEG = 72
/** the surface on show waits at most this long for the rest of the next one */
const SHOW_WITHIN_MS = 1500
/** the clouds' detail is rebuilt at most this often while its tiles come in */
const REBUILD_MS = 700
/** tile pictures held in memory (the browser's cache keeps the surface tiles longer) */
const HELD_BYTES = 48e6

/** the frame in device pixels (y down), the globe's centre and radius */
export interface Frame { w: number; h: number; r: number; cx: number; cy: number }
/** a box of the world in degrees; east may pass 180° (it wraps) */
export interface Box { west: number; east: number; south: number; north: number }

/** The part of the globe in the frame — longitudes unwrapped round the camera's — a little wider; null when the whole
 *  disk fits in the frame or a pole is in view. */
export function visibleBox(cam: GlobeCamera, f: Frame): Box | null {
  if (f.r <= Math.min(f.cx, f.w - f.cx, f.cy, f.h - f.cy)) return null
  const p0 = cam.lat * RAD, sp0 = Math.sin(p0), cp0 = Math.cos(p0)
  const inFrame = (x: number, y: number) => x >= 0 && x <= f.w && y >= 0 && y <= f.h
  // a pole on the near side, in the frame: every longitude is in view
  for (const s of [1, -1]) {
    const y = f.cy - f.r * s * cp0
    if (s * sp0 > 0 && inFrame(f.cx, y)) return null
  }
  let w = Infinity, e = -Infinity, so = Infinity, no = -Infinity
  const add = (nx: number, ny: number, nz: number) => {
    const lat = Math.asin(Math.max(-1, Math.min(1, ny * cp0 + nz * sp0))) / RAD
    const dl = Math.atan2(nx, nz * cp0 - ny * sp0) / RAD
    w = Math.min(w, dl); e = Math.max(e, dl); so = Math.min(so, lat); no = Math.max(no, lat)
  }
  const N = 12
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const px = (i / N) * f.w, py = (j / N) * f.h
    const x = (px - f.cx) / f.r, y = (f.cy - py) / f.r, d2 = x * x + y * y
    if (d2 <= 1) add(x, y, Math.sqrt(1 - d2))
  }
  // the limb, where it crosses the frame
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * 2 * Math.PI, x = Math.cos(a), y = Math.sin(a)
    if (inFrame(f.cx + f.r * x, f.cy - f.r * y)) add(x, y, 0)
  }
  if (!Number.isFinite(w)) return null
  const mx = (e - w) * 0.08 + 0.5, my = (no - so) * 0.08 + 0.5
  return { west: cam.lon + w - mx, east: cam.lon + e + mx, south: Math.max(-90, so - my), north: Math.min(90, no + my) }
}

/** the coarsest level whose pixels are at most a little coarser than the screen's (degrees a device pixel) */
export function levelFor(degPerPx: number, min: number, max: number): number {
  const z = Math.ceil(Math.log2(tileRes(0) / (degPerPx * LEVEL_SLACK)))
  return Math.max(min, Math.min(max, z))
}

/** the tiles of a level that cover a box: a run of columns (they wrap round the world) and of rows, and their box */
export interface TilePlan { z: number; col0: number; cols: number; row0: number; rows: number; box: Box }

/** The tiles at level z over a box; null when more than `maxSide` a side would be needed. */
export function tilePlan(box: Box, z: number, maxSide = MAX_SIDE): TilePlan | null {
  const s = tileSpan(z)
  const col0 = Math.floor((box.west + 180) / s), col1 = Math.floor((box.east + 180 - 1e-9) / s)
  const row0 = Math.max(0, Math.floor((90 - box.north) / s)), row1 = Math.min(tileRows(z) - 1, Math.floor((90 - box.south - 1e-9) / s))
  const cols = col1 - col0 + 1, rows = row1 - row0 + 1
  if (cols > maxSide || rows > maxSide || cols < 1 || rows < 1) return null
  return { z, col0, cols, row0, rows, box: { west: -180 + col0 * s, east: -180 + (col1 + 1) * s, north: 90 - row0 * s, south: 90 - (row1 + 1) * s } }
}

export const planKey = (p: TilePlan): string => `${p.z}/${p.row0}/${((p.col0 % tileCols(p.z)) + tileCols(p.z)) % tileCols(p.z)}/${p.rows}x${p.cols}`

/** A plan's tiles, the middle first: where each goes in the mosaic (i across, j down) and its column on the grid. */
export function planTiles(p: TilePlan): Array<{ i: number; j: number; row: number; col: number }> {
  const n = tileCols(p.z), out: Array<{ i: number; j: number; row: number; col: number }> = []
  for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) out.push({ i, j, row: p.row0 + j, col: (((p.col0 + i) % n) + n) % n })
  const ci = (p.cols - 1) / 2, cj = (p.rows - 1) / 2
  return out.sort((a, b) => Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj))
}

/** The angle (°) between a point and the point below a satellite. */
export function sourceAngle(src: CloudSource, lat: number, lon: number): number {
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(lat * RAD) * Math.cos((lon - CLOUD_SOURCES[src].subLon) * RAD)))) / RAD
}

/** The satellite with the best view of a point; null when none sees it within MAX_VIEW_DEG. */
export function bestSource(lat: number, lon: number): CloudSource | null {
  let best: CloudSource | null = null, angle = MAX_VIEW_DEG
  for (const s of Object.keys(CLOUD_SOURCES) as CloudSource[]) {
    const a = sourceAngle(s, lat, lon)
    if (a < angle) { angle = a; best = s }
  }
  return best
}

/** each box blur's radius (pixels, applied twice each way) at level z: about one and a half of the world cloud map's
 *  pixels in all */
export const blurRadius = (z: number): number => Math.max(1, Math.round((1.5 * WORLD_DEG_PER_PX / tileRes(z) - 1) / 2))

export interface DetailStatus {
  /** NASA's picture of the whole world is in (else the land's colours are drawn) */
  photo: boolean
  photoError?: string | null
  /** the land in view: the world's picture is enough here ("off"), a sharper one is coming, at least part of it is on
   *  show, or none of it could be had */
  surface: "off" | "loading" | "sharp" | "failed"
  surfaceError?: string | null
  /** the clouds' sharpening in view: the satellite; the times of the pictures drawn (earliest, latest); the level; the
   *  tiles drawn with something in them, out of those wanted; and whether every tile has been asked */
  clouds: { source: CloudSource; fromMs: number; toMs: number; z: number; have: number; want: number; done: boolean; error?: string } | null
}

export interface TileApi { tile(req: TileReq): Promise<TileAnswer> }

interface Built { id: number; rg?: Uint8Array; seen?: number; failed?: number; error?: string }
/** a tile's picture held in memory, and the time of the picture (clouds) */
interface Held { bytes: Uint8Array; timeMs?: number }
interface Ask { req: TileReq; generation: number; go: (h: Held | null) => void }

/** at most this many tiles asked of the tile fetcher at once (older asks wait; those of a view left behind are dropped) */
const MAX_ASKING = 8
/** a tile that could not be had now is asked again after this */
const RETRY_MS = 60_000
/** the clouds' detail is built on at most this many tiles a side (its working arrays grow with the square) */
export const MAX_SIDE_CLOUDS = 5
/** a build that has not answered in this long is given up */
const BUILD_TIMEOUT_MS = 30_000

const reqKey = (r: TileReq): string => (r.kind === "surface" ? `s/${r.z}/${r.row}/${r.col}` : `c/${r.source}/${r.timeMs}/${r.z}/${r.row}/${r.col}`)

export class DetailLoader {
  private cam: GlobeCamera | null = null
  private frame: Frame | null = null
  private movedAt = 0
  private timer: number | null = null
  private hourMs: number | null = null
  private cloudsOn = true
  /** the loads under way or on show: each its plan's key and its own generation (a load started again gets a new one) */
  private surf: { key: string; generation: number } | null = null
  private cloud: { key: string; generation: number; source: CloudSource; timeMs: number } | null = null
  /** the satellite and hour of the clouds' detail on show */
  private cloudShown: { source: CloudSource; timeMs: number } | null = null
  private generation = 0
  /** tile pictures held, oldest first */
  private readonly held = new Map<string, Held>()
  private heldBytes = 0
  private readonly retryAt = new Map<string, number>()
  private retryTimer: number | null = null
  private readonly asking = new Map<string, { promise: Promise<Held | null>; ask: Ask | null }>()
  private readonly queue: Ask[] = []
  private inFlight = 0
  private worker: Worker | null | undefined
  private nextJob = 1
  private readonly jobs = new Map<number, (b: Built) => void>()
  private building = false
  private buildAgain: (() => void) | null = null
  private status: DetailStatus = { photo: false, surface: "off", clouds: null }
  private disposed = false

  constructor(private readonly gl: GlobeGl, private readonly api: TileApi | null, private readonly redraw: () => void, private readonly onStatus?: (s: DetailStatus) => void) {}

  /** The view now (called with every frame drawn): the detail is planned once it stands still. */
  view(cam: GlobeCamera, frame: Frame): void {
    const c = this.cam, f = this.frame
    if (c && f && c.lon === cam.lon && c.lat === cam.lat && c.zoom === cam.zoom && f.w === frame.w && f.h === frame.h && f.r === frame.r) return
    this.cam = { ...cam }
    this.frame = { ...frame }
    this.movedAt = performance.now()
    if (this.timer == null) this.timer = window.setTimeout(this.stilled, STILL_MS)
  }

  /** The hour of the world's cloud image (the clouds' detail is of the same hour); null = no image, no detail. */
  setHour(ms: number | null): void {
    if (ms === this.hourMs) return
    this.hourMs = ms
    this.plan()
  }

  /** whether the clouds show (no cloud tiles are asked while they do not) */
  setClouds(on: boolean): void {
    if (on === this.cloudsOn) return
    this.cloudsOn = on
    this.plan()
  }

  /** NASA's picture of the whole world is on show, or terminally unreadable for this load. */
  photoShown(): void { this.setStatus({ photo: true, photoError: null }) }
  photoFailed(why: string): void { this.setStatus({ photo: false, photoError: why }) }

  dispose(): void {
    this.disposed = true
    if (this.timer != null) window.clearTimeout(this.timer)
    if (this.retryTimer != null) window.clearTimeout(this.retryTimer)
    for (const a of this.queue) a.go(null)
    this.queue.length = 0
    this.worker?.terminate()
    this.held.clear()
  }

  private readonly stilled = (): void => {
    this.timer = null
    const quiet = performance.now() - this.movedAt
    if (quiet < STILL_MS) { this.timer = window.setTimeout(this.stilled, STILL_MS - quiet); return }
    this.plan()
  }

  private setStatus(s: Partial<DetailStatus>): void {
    this.status = { ...this.status, ...s }
    this.onStatus?.(this.status)
  }

  private dropSurface(): void {
    if (!this.surf && this.status.surface === "off") return
    this.surf = null
    this.gl.clearSurface()
    this.setStatus({ surface: "off" })
    this.redraw()
  }

  private dropClouds(): void {
    if (!this.cloud && !this.cloudShown && !this.status.clouds) return
    this.cloud = null
    this.cloudShown = null
    this.gl.setCloudDetail(null)
    this.setStatus({ clouds: null })
    this.redraw()
  }

  private plan(): void {
    const cam = this.cam, f = this.frame
    if (this.disposed || !this.api || !cam || !f) return
    const degPerPx = 1 / (f.r * RAD)
    const box = degPerPx < WORLD_DEG_PER_PX / LEVEL_SLACK ? visibleBox(cam, f) : null
    if (!box) { this.dropSurface(); this.dropClouds(); return }
    const fits = Math.max(1, this.gl.maxSharpTiles)
    // the surface: the finest level the screen needs, coarser where the view would want too many tiles
    let z = levelFor(degPerPx, SURFACE_MIN_LEVEL, SURFACE_MAX_LEVEL), plan = tilePlan(box, z, Math.min(MAX_SIDE, fits))
    while (!plan && z > SURFACE_MIN_LEVEL) plan = tilePlan(box, --z, Math.min(MAX_SIDE, fits))
    if (!plan) this.dropSurface()
    else if (planKey(plan) !== this.surf?.key) this.loadSurface(plan)
    // the clouds: the satellite overhead, at the world image's hour
    const src = this.cloudsOn && this.hourMs != null ? bestSource(cam.lat, cam.lon) : null
    let cp: TilePlan | null = null
    if (src) {
      let zc = levelFor(degPerPx, CLOUD_MIN_LEVEL, CLOUD_SOURCES[src].maxLevel)
      cp = tilePlan(box, zc, Math.min(MAX_SIDE_CLOUDS, fits))
      while (!cp && zc > CLOUD_MIN_LEVEL) cp = tilePlan(box, --zc, Math.min(MAX_SIDE_CLOUDS, fits))
    }
    if (!src || !cp || this.hourMs == null) { this.dropClouds(); return }
    const key = `${src}|${this.hourMs}|${planKey(cp)}`
    if (key !== this.cloud?.key) this.loadClouds(src, this.hourMs, cp, key)
  }

  private loadSurface(plan: TilePlan): void {
    const key = planKey(plan), generation = ++this.generation
    this.surf = { key, generation }
    this.gl.beginSurface(key, plan.box, plan.cols * TILE_PX, plan.rows * TILE_PX)
    this.setStatus({ surface: "loading", surfaceError: null })
    const tiles = planTiles(plan)
    const mine = () => this.surf?.generation === generation && !this.disposed
    let done = 0, put = 0, shown = false, late = false, decodeFailures = 0
    const show = () => {
      if (shown || !mine() || put === 0) return
      shown = true
      this.gl.showSurface(key)
      this.setStatus({ surface: "sharp" })
      this.redraw()
    }
    const deadline = window.setTimeout(() => { late = true; show() }, SHOW_WITHIN_MS)
    for (const t of tiles) {
      void this.fetch({ kind: "surface", z: plan.z, row: t.row, col: t.col }, generation).then(async (h) => {
        if (!h || !mine()) return
        const img = await createImageBitmap(new Blob([h.bytes as BlobPart], { type: "image/jpeg" }))
        if (mine()) {
          this.gl.putSurfaceTile(key, t.i * TILE_PX, t.j * TILE_PX, img)
          put++
          if (shown) this.redraw()
          else if (late) show()
        }
        img.close()
      }).catch(() => { decodeFailures++ }).finally(() => {
        if (++done < tiles.length || !mine()) return
        window.clearTimeout(deadline)
        if (put > 0) {
          show()
          if (decodeFailures) this.setStatus({ surfaceError: `${decodeFailures} of ${tiles.length} tiles could not be decoded; the world picture fills those gaps` })
        } else this.setStatus({ surface: "failed", surfaceError: decodeFailures ? `${decodeFailures} of ${tiles.length} tiles could not be decoded` : "no surface tiles available" })
      })
    }
  }

  private loadClouds(src: CloudSource, timeMs: number, plan: TilePlan, key: string): void {
    const generation = ++this.generation
    this.cloud = { key, generation, source: src, timeMs }
    // another satellite or hour: what is on show is not of it, so it goes at once
    if (this.cloudShown && (this.cloudShown.source !== src || this.cloudShown.timeMs !== timeMs)) {
      this.cloudShown = null
      this.gl.setCloudDetail(null)
      this.redraw()
    }
    const mine = () => this.cloud?.generation === generation && !this.disposed
    const tiles = planTiles(plan)
    const got: Array<{ x: number; y: number; key: string; bytes: Uint8Array; timeMs: number }> = []
    let done = 0, pending: number | null = null
    const status = (have: number, fromMs: number, toMs: number, error?: string) =>
      this.setStatus({ clouds: { source: src, fromMs, toMs, z: plan.z, have, want: tiles.length, done: done === tiles.length, error } })
    status(0, timeMs, timeMs)
    const build = () => {
      pending = null
      if (!mine()) return
      if (got.length === 0) { status(0, timeMs, timeMs); return }
      const parts = [...got], times = parts.map((p) => p.timeMs)
      this.build({
        w: plan.cols * TILE_PX, h: plan.rows * TILE_PX, blurPx: blurRadius(plan.z),
        area: { west: plan.box.west, north: plan.box.north, res: tileRes(plan.z), subLon: CLOUD_SOURCES[src].subLon },
        tiles: parts.map(({ x, y, key: k, bytes }) => ({ x, y, key: k, bytes })),
      }, (b) => {
        if (!mine()) return
        if (b.error || !b.rg) { status(0, timeMs, timeMs, b.error ?? "cloud detail decode failed"); return }
        this.gl.setCloudDetail({ key, box: plan.box, w: plan.cols * TILE_PX, h: plan.rows * TILE_PX, rg: b.rg })
        this.cloudShown = { source: src, timeMs }
        status(b.seen ?? 0, Math.min(...times), Math.max(...times), b.failed ? `${b.failed} of ${parts.length} fetched tiles could not be decoded` : undefined)
        this.redraw()
      })
    }
    for (const t of tiles) {
      const req: TileReq = { kind: "clouds", source: src, timeMs, z: plan.z, row: t.row, col: t.col }
      void this.fetch(req, generation).then((h) => {
        if (h && mine()) got.push({ x: t.i * TILE_PX, y: t.j * TILE_PX, key: reqKey(req), bytes: h.bytes, timeMs: h.timeMs ?? timeMs })
      }).finally(() => {
        if (!mine()) return
        if (++done === tiles.length) { if (pending != null) window.clearTimeout(pending); build() }
        else if (pending == null) pending = window.setTimeout(build, REBUILD_MS)
      })
    }
  }

  /** One build at a time; a newer one waiting replaces the one before it. */
  private build(job: Omit<WorkerJob, "id">, done: (b: Built) => void): void {
    const run = () => {
      this.building = true
      void this.inWorker(job).then(done).finally(() => {
        this.building = false
        const next = this.buildAgain
        this.buildAgain = null
        next?.()
      })
    }
    if (this.building) this.buildAgain = run
    else run()
  }

  private inWorker(job: Omit<WorkerJob, "id">): Promise<Built> {
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL("./detailWorker.ts", import.meta.url), { type: "module" })
        this.worker.onmessage = (ev: MessageEvent<Built>) => { const go = this.jobs.get(ev.data?.id); if (go) { this.jobs.delete(ev.data.id); go(ev.data) } }
        // a broken worker: the clouds keep the world image's detail
        const broken = () => {
          for (const go of this.jobs.values()) go({ id: 0, error: "the worker failed" })
          this.jobs.clear()
          this.worker?.terminate()
          this.worker = null
        }
        this.worker.onerror = broken
        this.worker.onmessageerror = broken
      } catch { this.worker = null }
    }
    const w = this.worker
    if (!w) return Promise.resolve({ id: 0, error: "no worker" })
    const id = this.nextJob++
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { if (this.jobs.delete(id)) resolve({ id, error: "the build took too long" }) }, BUILD_TIMEOUT_MS)
      this.jobs.set(id, (b) => { window.clearTimeout(timer); resolve(b) })
      // copies go to the worker: the window keeps its own for the next build
      const tiles = job.tiles.map((t) => ({ ...t, bytes: t.bytes.slice() }))
      w.postMessage({ ...job, id, tiles } satisfies WorkerJob, tiles.map((t) => t.bytes.buffer))
    })
  }

  /** A tile's picture for a load: held, or asked of the tile fetcher; null when there is none now. */
  private fetch(req: TileReq, generation: number): Promise<Held | null> {
    const k = reqKey(req)
    const held = this.held.get(k)
    if (held) { this.held.delete(k); this.held.set(k, held); return Promise.resolve(held) }
    const retry = this.retryAt.get(k)
    if (retry != null && retry > Date.now()) return Promise.resolve(null)
    const running = this.asking.get(k)
    if (running) {
      // still waiting to go: the current load takes it over
      if (running.ask) running.ask.generation = generation
      return running.promise
    }
    const entry: { promise: Promise<Held | null>; ask: Ask | null } = { promise: Promise.resolve(null), ask: null }
    entry.promise = new Promise<Held | null>((go) => {
      entry.ask = { req, generation, go }
      this.queue.push(entry.ask)
    }).finally(() => this.asking.delete(k))
    this.asking.set(k, entry)
    this.pump()
    return entry.promise
  }

  /** Sends queued asks while fewer than MAX_ASKING are out, newest view first; an ask of a load no longer current is
   *  dropped without being sent. */
  private pump(): void {
    while (this.inFlight < MAX_ASKING && this.queue.length) {
      const ask = this.queue.shift()!
      const entry = this.asking.get(reqKey(ask.req))
      if (entry) entry.ask = null
      if (ask.generation !== this.surf?.generation && ask.generation !== this.cloud?.generation) { ask.go(null); continue }
      this.inFlight++
      void this.api!.tile(ask.req).catch((): TileAnswer => ({ none: "failed" })).then((a) => {
        const k = reqKey(ask.req)
        if ("bytes" in a) {
          const prev = this.held.get(k)
          if (prev) this.heldBytes -= prev.bytes.length
          this.held.delete(k)
          this.held.set(k, { bytes: a.bytes, timeMs: a.timeMs })
          this.heldBytes += a.bytes.length
          for (const [old, h] of this.held) { if (this.heldBytes <= HELD_BYTES) break; this.held.delete(old); this.heldBytes -= h.bytes.length }
          ask.go({ bytes: a.bytes, timeMs: a.timeMs })
          return
        }
        this.retryAt.set(k, Date.now() + (a.none === "missing" ? 3600_000 : RETRY_MS))
        ask.go(null)
        if (a.none === "failed") this.retrySoon()
      }).finally(() => { this.inFlight--; this.pump() })
    }
  }

  /** A tile could not be had now: the view is planned again once it may be asked again (even if it stands still). */
  private retrySoon(): void {
    if (this.retryTimer != null || this.disposed) return
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      const now = Date.now()
      for (const [k, t] of this.retryAt) if (t <= now) this.retryAt.delete(k)
      // the same plans load again: what is held comes at once, what failed is asked again
      if (this.surf) this.surf = { ...this.surf, key: "" }
      if (this.cloud) this.cloud = { ...this.cloud, key: "" }
      this.plan()
    }, RETRY_MS + 1000)
  }
}

export interface WorkerJob {
  id: number
  w: number
  h: number
  blurPx: number
  area: { west: number; north: number; res: number; subLon: number }
  tiles: Array<{ x: number; y: number; key: string; bytes: Uint8Array }>
}
