import { useEffect, useState } from "react"
import type { SatField } from "../globe/satClouds"
import type { SatJob, SatResult } from "../globe/satDecode"
import { SAT_CHECK_MS, SAT_MAX_AGE_MS, SAT_RETRY_MS, fetchImage, fetchLatestTime, type CloudImage } from "./satellite"

// The satellite's cloud field: the newest mosaic time checked every SAT_CHECK_MS while the page is visible, the image
// fetched only when a newer time is listed, and decoded in its worker. A worker or decode failure leaves the model's
// clouds in place and says why; the image is never processed on the main thread.

export type SatState =
  | { status: "none" }
  | { status: "loading"; timeMs: number; sat: SatField | null }
  | { status: "ready"; sat: SatField }
  | { status: "failed"; why: string; sat: SatField | null }

/** the worker, started on first use and again after one that hung or crashed; null when the browser cannot start one */
let worker: Worker | null | undefined
let nextJob = 1
const WORKER_TIMEOUT_MS = 30_000
const TICK_MS = 60_000

/** the newest field decoded, and the read under way: shared by every mount, so a remount asks for nothing twice */
let held: SatField | null = null
let running: Promise<SatField | null> | null = null
let checkedAt = 0

/** The newest image when one newer than the field held is listed (null: nothing newer), decoded. */
function refresh(onLoading: (timeMs: number) => void): Promise<SatField | null> {
  if (running) return running
  running = (async () => {
    const latest = await fetchLatestTime()
    if (Date.now() - latest > SAT_MAX_AGE_MS) throw new Error("the newest image is too old; the model's clouds are shown")
    if (held && latest <= held.timeMs) return null
    onLoading(latest)
    held = await decode(await fetchImage(latest))
    return held
  })().finally(() => { running = null; checkedAt = Date.now() })
  return running
}

/** The job done in the worker: its answer matched to it by id, so two jobs in flight never swap images. */
function inWorker(job: SatJob): Promise<SatResult> {
  if (worker === undefined) {
    try { worker = new Worker(new URL("../globe/satWorker.ts", import.meta.url), { type: "module" }) } catch { worker = null }
  }
  const w = worker
  if (!w) return Promise.reject(new Error("no worker"))
  const id = nextJob++
  return new Promise<SatResult>((resolve, reject) => {
    const done = () => { window.clearTimeout(timer); w.removeEventListener("message", onMessage); w.removeEventListener("error", onBroken) }
    const onMessage = (ev: MessageEvent<{ id: number; result?: SatResult; error?: string }>) => {
      if (ev.data?.id !== id) return
      done()
      if (ev.data.result) resolve(ev.data.result)
      else reject(new Error(ev.data.error ?? "the worker failed"))
    }
    const onBroken = () => { done(); if (worker === w) worker = undefined; w.terminate(); reject(new Error("the worker failed")) }
    const timer = window.setTimeout(onBroken, WORKER_TIMEOUT_MS)
    w.addEventListener("message", onMessage)
    w.addEventListener("error", onBroken)
    // the worker receives a copy; the caller's bytes stay untouched
    const png = new Uint8Array(job.png)
    w.postMessage({ id, job: { ...job, png } }, [png.buffer])
  })
}

async function decode(img: CloudImage): Promise<SatField> {
  const r = await inWorker({ png: img.png, latTop: img.latTop, latBottom: img.latBottom })
  if (!r.ok) throw new Error(r.why)
  return { timeMs: img.timeMs, field: r.field, w: r.w, h: r.h, latTop: img.latTop, latBottom: img.latBottom, coverage: r.coverage }
}

/** `enabled`: whether the clouds show (nothing is fetched while they do not). */
export function useSatellite(enabled: boolean): SatState {
  const [state, setState] = useState<SatState>(() => (held ? { status: "ready", sat: held } : { status: "none" }))
  useEffect(() => {
    if (!enabled) return
    let live = true, triedAt = 0, ok = false
    const tick = () => {
      const now = Date.now()
      if (document.hidden || (ok && now - checkedAt < SAT_CHECK_MS) || now - triedAt < SAT_RETRY_MS) return
      triedAt = now
      refresh((timeMs) => { if (live) setState({ status: "loading", timeMs, sat: held }) }).then(
        (sat) => { ok = true; if (live && sat) setState({ status: "ready", sat }) },
        (err: unknown) => { ok = false; if (live) setState({ status: "failed", why: err instanceof Error ? err.message : "read failed", sat: held }) },
      )
    }
    tick()
    const id = window.setInterval(tick, TICK_MS)
    document.addEventListener("visibilitychange", tick)
    return () => { live = false; window.clearInterval(id); document.removeEventListener("visibilitychange", tick) }
  }, [enabled])
  return state
}

/** The field to draw from a state: the newest decoded one, if any. */
export const satFieldOf = (s: SatState): SatField | null => (s.status === "none" ? null : s.sat)
