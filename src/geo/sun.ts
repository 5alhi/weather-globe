// Where the sun is overhead (the subsolar point) at an instant, for the globe's day and night: NOAA's low-precision solar
// formulas, well inside 0.1° for this century. Pure.
const RAD = Math.PI / 180
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180

/** The cosine of the zenith angle at which sunrise and sunset are timed: the sun's centre 0.833° below the horizon. */
export const SUN_UP_COS = -0.01454

export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const d = ms / 86_400_000 - 10957.5 // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD // mean anomaly
  const q = 280.459 + 0.98564736 * d // mean longitude (°)
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD // ecliptic longitude
  const eps = (23.439 - 0.00000036 * d) * RAD // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / RAD
  const eotMin = 4 * wrap180(q - ra) // equation of time: apparent minus mean solar time
  const utcHours = (((ms / 3_600_000) % 24) + 24) % 24
  return { lat: dec, lon: wrap180(15 * (12 - utcHours - eotMin / 60)) }
}

/** Cosine of the sun's zenith angle at a place: > 0 by day, < 0 by night. */
export function sunCosAt(lat: number, lon: number, sun: { lat: number; lon: number }): number {
  return Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD)
}
