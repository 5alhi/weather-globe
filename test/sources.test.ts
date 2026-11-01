import { describe, expect, test } from "vitest"
import { SAT_IMAGE, latestSatTime, satImageUrl } from "../src/data/satellite"
import { TileFetcher, baseUrl, cloudTileUrl, surfaceTileUrl } from "../src/data/tileFetcher"
import { Lane } from "../src/data/throttle"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array<number>(80).fill(0)])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, ...new Array<number>(200).fill(0)])
const NOW = Date.parse("2026-01-15T12:00:00Z")
const NONE = new Uint8Array(0)

describe("nowCOAST", () => {
  const caps = (dim: string) => `<Layer><Name>other</Name></Layer><Layer><Name>global_longwave_imagery_mosaic</Name>
    <Dimension name="time" units="ISO8601">${dim}</Dimension></Layer>`

  test("the newest time from a list", () => {
    expect(latestSatTime(caps("2026-01-15T09:00:00.000Z,2026-01-15T10:00:00.000Z"))).toBe(Date.parse("2026-01-15T10:00:00Z"))
  })

  test("the end of a start/end/period range", () => {
    expect(latestSatTime(caps("2026-01-14T00:00:00Z/2026-01-15T10:00:00Z/PT1H"))).toBe(Date.parse("2026-01-15T10:00:00Z"))
  })

  test("null when the layer is not listed", () => {
    expect(latestSatTime("<Layer><Name>other</Name></Layer>")).toBeNull()
  })

  test("the image asks for the whole world between the mosaic's latitudes", () => {
    const u = new URL(satImageUrl(NOW))
    expect(u.searchParams.get("bbox")).toBe(`-180,${SAT_IMAGE.latBottom},180,${SAT_IMAGE.latTop}`)
    expect(u.searchParams.get("time")).toBe("2026-01-15T12:00:00.000Z")
  })
})

describe("GIBS addresses", () => {
  test("tiles and the base picture", () => {
    expect(surfaceTileUrl(5, 3, 7)).toMatch(/BlueMarble_NextGeneration\/default\/500m\/5\/3\/7\.jpeg$/)
    expect(cloudTileUrl("himawari", NOW, 4, 2, 15)).toMatch(/Himawari_AHI_Band13_Clean_Infrared\/default\/2026-01-15T12:00:00Z\/2km\/4\/2\/15\.png$/)
    expect(new URL(baseUrl()).searchParams.get("WIDTH")).toBe("4096")
  })
})

describe("TileFetcher", () => {
  test("a surface tile is fetched once even when asked twice at once", async () => {
    let calls = 0
    const f = new TileFetcher({ cache: false, now: () => NOW, get: async () => { calls++; return { status: 200, bytes: JPEG } } })
    const [a, b] = await Promise.all([f.tile({ kind: "surface", z: 4, row: 1, col: 1 }), f.tile({ kind: "surface", z: 4, row: 1, col: 1 })])
    expect("bytes" in a && "bytes" in b).toBe(true)
    expect(calls).toBe(1)
  })

  test("a missing cloud time is tried 10 minutes either side", async () => {
    const asked: string[] = []
    const f = new TileFetcher({ cache: false, now: () => NOW, get: async (url) => {
      asked.push(url)
      return url.includes("11:50:00Z") ? { status: 200, bytes: PNG } : { status: 404, bytes: NONE }
    } })
    const a = await f.tile({ kind: "clouds", source: "goes-east", timeMs: NOW, z: 4, row: 2, col: 5 })
    expect(a).toEqual({ bytes: PNG, timeMs: NOW - 600_000 })
    expect(asked.length).toBe(2)
  })

  test("a tile the service lacks is not asked again", async () => {
    let calls = 0
    const f = new TileFetcher({ cache: false, now: () => NOW, get: async () => { calls++; return { status: 404, bytes: NONE } } })
    const req = { kind: "surface", z: 4, row: 1, col: 2 }
    expect(await f.tile(req)).toEqual({ none: "missing" })
    expect(await f.tile(req)).toEqual({ none: "missing" })
    expect(calls).toBe(1)
  })

  test("a request off the grid is refused without a fetch", async () => {
    let calls = 0
    const f = new TileFetcher({ cache: false, get: async () => { calls++; return { status: 200, bytes: JPEG } } })
    expect(await f.tile({ kind: "surface", z: 4, row: 99, col: 0 })).toEqual({ none: "missing" })
    expect(calls).toBe(0)
  })

  test("a server error is a failure worth retrying, not a missing tile", async () => {
    const f = new TileFetcher({ cache: false, now: () => NOW, get: async () => ({ status: 503, bytes: NONE }) })
    expect(await f.tile({ kind: "surface", z: 4, row: 1, col: 3 })).toEqual({ none: "failed" })
  })

  test("the base picture is fetched once and shared", async () => {
    let calls = 0
    const f = new TileFetcher({ cache: false, get: async () => { calls++; return { status: 200, bytes: JPEG } } })
    const [a, b] = await Promise.all([f.base(), f.base()])
    expect(a).toBe(JPEG)
    expect(b).toBe(JPEG)
    expect(calls).toBe(1)
  })
})

describe("Lane", () => {
  test("never runs more than `max` at once", async () => {
    const lane = new Lane(2, 100)
    let running = 0, peak = 0
    const job = () => lane.run(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running-- })
    await Promise.all([job(), job(), job(), job(), job()])
    expect(peak).toBe(2)
  })

  test("refuses past its per-minute budget", async () => {
    const lane = new Lane(5, 2, () => NOW)
    expect(await lane.run(async () => 1)).toBe(1)
    expect(await lane.run(async () => 2)).toBe(2)
    expect(await lane.run(async () => 3)).toBe("refused")
  })
})
