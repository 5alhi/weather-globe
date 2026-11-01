// The globe's sharp clouds, built off the main thread (detail.ts): a satellite's infrared tiles decoded into
// temperatures and laid side by side, then turned into the clouds' fine structure (irDecode.ts). Each tile is decoded
// once and remembered while it may be asked again (a tile that would not decode is tried again next time). The answer
// says how many tiles had something to read.
import { NO_TEMP, cloudDetail, gibsReader, tileTemps } from "./irDecode"
import type { WorkerJob } from "./detail"
import { TILE_PX } from "../geo/tiles"

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerJob>) => void) | null
  postMessage(msg: unknown, transfer: Transferable[]): void
}
/** decoded tiles, oldest first, and whether each had anything seen in it */
const decoded = new Map<string, { temps: Int16Array; seen: boolean }>()
const KEEP_TILES = 72
/** a tile counts as seen when something is read in at least this share of it (sampled every SAMPLE_STEP pixels) */
const SEEN_SHARE = 0.01
const SAMPLE_STEP = 97
const read = gibsReader()

async function decode(bytes: Uint8Array): Promise<{ temps: Int16Array; seen: boolean }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
  const c = new OffscreenCanvas(TILE_PX, TILE_PX)
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("no 2D canvas in the worker")
  ctx.drawImage(bmp, 0, 0, TILE_PX, TILE_PX)
  bmp.close()
  const { temps } = tileTemps(ctx.getImageData(0, 0, TILE_PX, TILE_PX).data, TILE_PX, TILE_PX, read)
  let n = 0
  for (let k = 0; k < temps.length; k += SAMPLE_STEP) if (temps[k] !== NO_TEMP) n++
  return { temps, seen: n * SAMPLE_STEP >= temps.length * SEEN_SHARE }
}

scope.onmessage = (ev) => {
  const job = ev.data
  void (async () => {
    const temps = new Int16Array(job.w * job.h).fill(NO_TEMP)
    let seen = 0, failed = 0
    for (const t of job.tiles) {
      let d = decoded.get(t.key)
      if (d) decoded.delete(t.key)
      else d = await decode(t.bytes).catch(() => undefined)
      if (!d) { failed++; continue }
      decoded.set(t.key, d)
      if (d.seen) seen++
      for (let y = 0; y < TILE_PX; y++) temps.set(d.temps.subarray(y * TILE_PX, (y + 1) * TILE_PX), (t.y + y) * job.w + t.x)
    }
    while (decoded.size > KEEP_TILES) decoded.delete(decoded.keys().next().value as string)
    const rg = cloudDetail(temps, job.w, job.h, job.blurPx, job.area)
    scope.postMessage({ id: job.id, rg, seen, failed }, [rg.buffer])
  })().catch((err: unknown) => scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : "build failed" }, []))
}
