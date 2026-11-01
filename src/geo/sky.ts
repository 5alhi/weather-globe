// What the sky is doing at a city, as one condition the globe can draw: a clear sky, clouds, fog or haze, or something
// falling (drizzle, rain, freezing rain, sleet / hail, snow, a thunderstorm) at an intensity. Read from a forecast's
// WMO weather code and the hour's cloud cover. Pure.

export type SkyKind = "clear" | "partly" | "cloudy" | "haze" | "fog" | "drizzle" | "rain" | "freezing" | "sleet" | "snow" | "storm"
/** 0 none · 1 light · 2 moderate · 3 heavy */
export type Intensity = 0 | 1 | 2 | 3
export interface Sky {
  kind: SkyKind
  intensity: Intensity
  /** cloud cover in oktas (0 clear … 8 overcast); null when the source does not say */
  oktas: number | null
}

const FALLING: ReadonlySet<SkyKind> = new Set(["drizzle", "rain", "freezing", "sleet", "snow", "storm"])
/** precipitation is falling (or a storm is under way) */
export const isWet = (s: Sky | null | undefined): boolean => s != null && FALLING.has(s.kind)

/** A WMO weather code (as Open-Meteo reports it) with the hour's cloud cover (%); null for an unknown code. */
export function skyFromWmo(code: number | null | undefined, cloudPct: number | null | undefined): Sky | null {
  if (code == null || !Number.isFinite(code)) return null
  const oktas = cloudPct == null || !Number.isFinite(cloudPct) ? null : Math.max(0, Math.min(8, Math.round(cloudPct / 12.5)))
  const s = (kind: SkyKind, intensity: Intensity): Sky => ({ kind, intensity, oktas })
  switch (code) {
    case 0: case 1: return s("clear", 0)
    case 2: return s("partly", 0)
    case 3: return s("cloudy", 0)
    case 45: case 48: return s("fog", 2)
    case 51: case 53: return s("drizzle", 1)
    case 55: return s("drizzle", 2)
    case 56: return s("freezing", 1)
    case 57: return s("freezing", 2)
    case 61: return s("rain", 1)
    case 63: return s("rain", 2)
    case 65: return s("rain", 3)
    case 66: return s("freezing", 1)
    case 67: return s("freezing", 3)
    case 71: case 77: return s("snow", 1)
    case 73: return s("snow", 2)
    case 75: return s("snow", 3)
    case 80: return s("rain", 1)
    case 81: return s("rain", 2)
    case 82: return s("rain", 3)
    case 85: return s("snow", 1)
    case 86: return s("snow", 3)
    case 95: case 96: return s("storm", 2)
    case 99: return s("storm", 3)
    default: return null
  }
}

const NAMES: Record<SkyKind, [string, string, string]> = {
  drizzle: ["Light drizzle", "Drizzle", "Heavy drizzle"],
  rain: ["Light rain", "Rain", "Heavy rain"],
  freezing: ["Light freezing rain", "Freezing rain", "Heavy freezing rain"],
  sleet: ["Light sleet / hail", "Sleet / hail", "Heavy sleet / hail"],
  snow: ["Light snow", "Snow", "Heavy snow"],
  storm: ["Thunderstorm", "Thunderstorm", "Heavy thunderstorm"],
  fog: ["Patchy fog", "Fog", "Fog"],
  haze: ["Mist / haze", "Mist / haze", "Mist / haze"],
  clear: ["Clear", "Clear", "Clear"],
  partly: ["Partly cloudy", "Partly cloudy", "Partly cloudy"],
  cloudy: ["Cloudy", "Cloudy", "Cloudy"],
}

/** "Light rain", "Overcast", … */
export function skyLabel(s: Sky | null | undefined): string {
  if (!s) return "No report"
  if (s.kind === "cloudy" && s.oktas === 8) return "Overcast"
  return NAMES[s.kind][Math.max(0, Math.min(2, s.intensity - 1))]
}
