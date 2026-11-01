// The satellite image's decoding and cloud mapping, off the main thread (a ~4096-wide image is a few hundred ms of
// work). One message in (a job: its id and a SatJob), one out (the same id with a SatResult — the field's bytes
// transferred, not copied — or with the decode error).
import { decodeSat, type SatJob } from "./satDecode"

const scope = self as unknown as { onmessage: ((ev: MessageEvent<{ id: number; job: SatJob }>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (ev) => {
  const { id, job } = ev.data
  decodeSat(job).then(
    (result) => scope.postMessage({ id, result }, result.ok ? [result.field.buffer as ArrayBuffer] : []),
    (err: unknown) => scope.postMessage({ id, error: err instanceof Error ? err.message : "decode failed" }, []),
  )
}
