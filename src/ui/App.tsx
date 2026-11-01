import { useCallback, useEffect, useMemo, useState } from "react"
import { Globe, type GlobeCity } from "./Globe"
import { CITIES, type City } from "../data/cities"
import { useWeather } from "../data/useWeather"
import { satFieldOf, useSatellite, type SatState } from "../data/useSatellite"
import { TileFetcher } from "../data/tileFetcher"
import type { CityWeather } from "../data/weather"
import { GlobeCameraController, zoomed, type GlobeCamera } from "../globe/camera"
import { REGIONS } from "../globe/regions"
import type { DetailStatus } from "../globe/detail"
import { CLOUD_SOURCES } from "../geo/tiles"
import { skyLabel } from "../geo/sky"
import { cToF } from "../globe/tempColor"

// The page: the globe filling the window, a toolbar (regions, the world tour, clouds, units, zoom), the selected city's
// panel, and a caption saying what is drawn and where it comes from.

type Unit = "C" | "F"
const START: GlobeCamera = { lon: -30, lat: 25, zoom: 1 }
const UNIT_KEY = "weather-globe:unit"
const CAPTION_PX = 64

const readUnit = (): Unit => { try { return globalThis.localStorage?.getItem(UNIT_KEY) === "F" ? "F" : "C" } catch { return "C" } }
const tempText = (c: number, unit: Unit): string => `${Math.round(unit === "F" ? cToF(c) : c)}°${unit}`
const utcTime = (ms: number): string => new Date(ms).toISOString().slice(11, 16) + " UTC"
/** a city's local clock time from its UTC offset */
const localTime = (nowMs: number, offsetS: number): string => new Date(nowMs + offsetS * 1000).toISOString().slice(11, 16)

function cityNote(w: CityWeather | undefined): string {
  if (!w) return "No reading yet"
  const parts = [skyLabel(w.sky)]
  if (w.cloudPct != null) parts.push(`${Math.round(w.cloudPct)}% cloud`)
  if (w.atMs != null) parts.push(`read ${utcTime(w.atMs)}`)
  return parts.join(" · ")
}

function satCaption(s: SatState): string {
  switch (s.status) {
    case "none": return "Clouds: weather model (satellite image loading)"
    case "loading": return `Clouds: loading the ${utcTime(s.timeMs)} infrared mosaic…`
    case "ready": return `Clouds: NOAA GMGSI infrared mosaic, ${utcTime(s.sat.timeMs)}`
    case "failed": return s.sat ? `Clouds: NOAA GMGSI infrared, ${utcTime(s.sat.timeMs)} (newer image unavailable: ${s.why})` : `Clouds: weather model (satellite image unavailable: ${s.why})`
  }
}

function detailCaption(d: DetailStatus | null): string | null {
  if (!d) return null
  const parts: string[] = []
  if (d.surface === "sharp") parts.push("land: Blue Marble detail tiles")
  else if (d.surface === "loading") parts.push("land: loading detail tiles…")
  else if (d.surface === "failed") parts.push("land: detail tiles unavailable")
  if (d.clouds) {
    const src = CLOUD_SOURCES[d.clouds.source]
    parts.push(d.clouds.have > 0 ? `clouds sharpened by ${src.name} (${src.by}) ${utcTime(d.clouds.toMs)}` : `loading ${src.name} infrared tiles…`)
  }
  return parts.length ? parts.join(" · ") : null
}

export function App() {
  const [touring, setTouring] = useState(false)
  const controller = useMemo(() => new GlobeCameraController(START, setTouring), [])
  useEffect(() => () => controller.dispose(), [controller])
  const tiles = useMemo(() => new TileFetcher(), [])
  const [showClouds, setShowClouds] = useState(true)
  const [unit, setUnit] = useState<Unit>(readUnit)
  const [selected, setSelected] = useState<string | null>(null)
  const [gpu, setGpu] = useState<boolean | null>(null)
  const [detail, setDetail] = useState<DetailStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id) }, [])

  const weather = useWeather()
  const sat = useSatellite(showClouds)
  const satellite = satFieldOf(sat)

  const byId = useMemo(() => new Map((weather.cities ?? []).map((w) => [w.id, w])), [weather.cities])
  const cities: GlobeCity[] = useMemo(() => CITIES.map((c): GlobeCity => {
    const w = byId.get(c.id)
    const t = w?.tempC
    return { id: c.id, name: c.name, lat: c.lat, lon: c.lon, sky: w?.sky ?? null, note: cityNote(w),
      temp: t != null ? { text: tempText(t, unit), f: cToF(t) } : null }
  }), [byId, unit])

  const switchUnit = () => setUnit((u) => {
    const next = u === "C" ? "F" : "C"
    try { globalThis.localStorage?.setItem(UNIT_KEY, next) } catch { /* the choice lasts this visit only */ }
    return next
  })
  const onCity = useCallback((id: string) => {
    setSelected(id)
    const c = CITIES.find((x) => x.id === id)
    if (c) controller.flyTo({ lon: c.lon, lat: c.lat, zoom: Math.max(controller.camera.zoom, 2.4) })
  }, [controller])

  const city: City | undefined = CITIES.find((c) => c.id === selected)
  const cw = city ? byId.get(city.id) : undefined
  const detailLine = detailCaption(detail)

  return (
    <div className="app">
      <header className="bar">
        <h1>Weather Globe</h1>
        <nav className="tools" aria-label="Globe controls">
          {REGIONS.map(([name, cam]) => <button key={name} type="button" className="chip" onClick={() => controller.flyTo(cam)}>{name}</button>)}
          <button type="button" className={`chip${touring ? " on" : ""}`} aria-pressed={touring} onClick={() => controller.setTouring(!touring)}>Tour</button>
          <button type="button" className={`chip${showClouds ? " on" : ""}`} aria-pressed={showClouds} onClick={() => setShowClouds((v) => !v)} disabled={gpu === false}>Clouds</button>
          <button type="button" className="chip" onClick={switchUnit} aria-label={`Show temperatures in °${unit === "C" ? "F" : "C"}`}>°{unit}</button>
          <button type="button" className="chip" aria-label="Zoom in" onClick={() => controller.set(zoomed(controller.camera, 1.5))}>+</button>
          <button type="button" className="chip" aria-label="Zoom out" onClick={() => controller.set(zoomed(controller.camera, 1 / 1.5))}>−</button>
        </nav>
      </header>
      <main className="stage">
        <Globe cities={cities} clouds={weather.grid} satellite={showClouds ? satellite : null} selected={selected} onCity={onCity}
          controller={controller} showClouds={showClouds && gpu !== false} tiles={tiles} onGpu={setGpu} onDetail={setDetail} reserveBottom={CAPTION_PX} />
        {city && (
          <aside className="panel" aria-label={`${city.name} weather`}>
            <button type="button" className="close" aria-label="Close" onClick={() => setSelected(null)}>×</button>
            <h2>{city.name}</h2>
            <p className="big">{cw?.tempC != null ? tempText(cw.tempC, unit) : "—"}</p>
            <p>{skyLabel(cw?.sky)}{cw?.cloudPct != null ? ` · ${Math.round(cw.cloudPct)}% cloud cover` : ""}</p>
            {cw?.utcOffsetS != null && <p className="dim">Local time {localTime(now, cw.utcOffsetS)}</p>}
            <p className="dim">{city.lat.toFixed(2)}°, {city.lon.toFixed(2)}°{cw?.atMs != null ? ` · read ${utcTime(cw.atMs)}` : ""}</p>
          </aside>
        )}
        <footer className="caption">
          {gpu === false && <div>WebGL2 is unavailable: showing the plain outline globe.</div>}
          {gpu !== false && showClouds && <div>{satCaption(sat)}</div>}
          {detailLine && <div>{detailLine}</div>}
          {weather.error && <div className="warn">Weather: {weather.error}</div>}
          <div className="credit">
            Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a> ·{" "}
            <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA nowCOAST</a> · Weather data by{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0) · Land:{" "}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>
          </div>
        </footer>
      </main>
    </div>
  )
}
