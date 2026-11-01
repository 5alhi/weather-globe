// The world's clouds as a satellite sees them: NOAA's Global Mosaic of Geostationary Satellite Imagery (GMGSI longwave
// infrared, ~3 km, hourly, 2–3 h behind real time), read by the browser from NOAA nowCOAST's map service (which answers
// cross-origin requests). Its list of times is read at most every SAT_CHECK_MS; the newest image (~3.5 MB) is fetched
// only when a newer time is listed.
import { getBytes } from "./throttle"

export const SAT_WMS_URL = "https://nowcoast.noaa.gov/geoserver/satellite/wms"
export const SAT_LAYER = "global_longwave_imagery_mosaic"
/** the image asked for: the whole world between these latitudes (the mosaic's own reach), ~0.09° a pixel */
export const SAT_IMAGE = { w: 4096, h: 1638, latTop: 72, latBottom: -72 } as const
export const SAT_CHECK_MS = 20 * 60_000
/** a failed read waits this long before the next try */
export const SAT_RETRY_MS = 10 * 60_000
/** an image older than this is not shown (the model's clouds instead) */
export const SAT_MAX_AGE_MS = 8 * 3600_000
/** a whole world's image is ~3.5 MB; one much smaller is mostly empty (a time the mosaic does not have) */
const SAT_MIN_BYTES = 200_000
const CAPS_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 60_000

export const satCapabilitiesUrl = (): string => `${SAT_WMS_URL}?service=WMS&version=1.3.0&request=GetCapabilities`

/** The mosaic's image at one time, the whole world in longitude and latitude. */
export function satImageUrl(timeMs: number): string {
  const q = new URLSearchParams({
    service: "WMS", version: "1.3.0", request: "GetMap", layers: SAT_LAYER, styles: "", crs: "CRS:84",
    bbox: `-180,${SAT_IMAGE.latBottom},180,${SAT_IMAGE.latTop}`, width: String(SAT_IMAGE.w), height: String(SAT_IMAGE.h),
    format: "image/png", transparent: "true", time: new Date(timeMs).toISOString(),
  })
  return `${SAT_WMS_URL}?${q.toString()}`
}

/** The newest time the map service lists for a layer (its time dimension: a list of times, or start/end/period
 *  ranges); null when the layer or its times are missing. */
export function latestSatTime(xml: string, layer: string = SAT_LAYER): number | null {
  const at = xml.indexOf(`<Name>${layer}</Name>`)
  if (at < 0) return null
  const end = xml.indexOf("</Layer>", at)
  const block = xml.slice(at, end < 0 ? undefined : end)
  const m = /<Dimension[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/.exec(block)
  if (!m) return null
  let best: number | null = null
  for (const item of m[1].split(",")) {
    const parts = item.trim().split("/")
    const t = Date.parse(parts.length >= 2 ? parts[1] : parts[0])
    if (Number.isFinite(t) && (best == null || t > best)) best = t
  }
  return best
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
export const isPngImage = (b: Uint8Array): boolean => b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)

export interface CloudImage { timeMs: number; latTop: number; latBottom: number; png: Uint8Array }

/** The newest time listed, read from the service. */
export async function fetchLatestTime(): Promise<number> {
  const res = await fetch(satCapabilitiesUrl(), { headers: { accept: "text/xml" }, signal: AbortSignal.timeout(CAPS_TIMEOUT_MS), credentials: "omit" })
  if (res.status !== 200) throw new Error(`the map service answered HTTP ${res.status}`)
  const t = latestSatTime(await res.text())
  if (t == null) throw new Error("the map service lists no image")
  return t
}

/** The image at a listed time. */
export async function fetchImage(timeMs: number): Promise<CloudImage> {
  const r = await getBytes(satImageUrl(timeMs), IMAGE_TIMEOUT_MS, "image/png")
  if (r.status !== 200) throw new Error(`the map service answered HTTP ${r.status}`)
  if (!isPngImage(r.bytes)) throw new Error("the answer is not an image")
  if (r.bytes.length < SAT_MIN_BYTES) throw new Error("the image came back nearly empty")
  return { timeMs, latTop: SAT_IMAGE.latTop, latBottom: SAT_IMAGE.latBottom, png: r.bytes }
}
