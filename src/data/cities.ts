// The cities labelled on the globe: a spread of large cities on every inhabited continent. Coordinates are the city
// centre (degrees, north and east positive).

export interface City {
  /** a stable id */
  id: string
  name: string
  lat: number
  lon: number
}

export const CITIES: readonly City[] = [
  { id: "nyc", name: "New York", lat: 40.71, lon: -74.01 },
  { id: "lax", name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { id: "chi", name: "Chicago", lat: 41.88, lon: -87.63 },
  { id: "mia", name: "Miami", lat: 25.76, lon: -80.19 },
  { id: "sea", name: "Seattle", lat: 47.61, lon: -122.33 },
  { id: "den", name: "Denver", lat: 39.74, lon: -104.99 },
  { id: "hou", name: "Houston", lat: 29.76, lon: -95.37 },
  { id: "yto", name: "Toronto", lat: 43.65, lon: -79.38 },
  { id: "yvr", name: "Vancouver", lat: 49.28, lon: -123.12 },
  { id: "mex", name: "Mexico City", lat: 19.43, lon: -99.13 },
  { id: "hnl", name: "Honolulu", lat: 21.31, lon: -157.86 },
  { id: "anc", name: "Anchorage", lat: 61.22, lon: -149.9 },
  { id: "bog", name: "Bogotá", lat: 4.71, lon: -74.07 },
  { id: "lim", name: "Lima", lat: -12.05, lon: -77.04 },
  { id: "sao", name: "São Paulo", lat: -23.55, lon: -46.63 },
  { id: "rio", name: "Rio de Janeiro", lat: -22.91, lon: -43.17 },
  { id: "bue", name: "Buenos Aires", lat: -34.6, lon: -58.38 },
  { id: "scl", name: "Santiago", lat: -33.45, lon: -70.67 },
  { id: "lon", name: "London", lat: 51.51, lon: -0.13 },
  { id: "par", name: "Paris", lat: 48.86, lon: 2.35 },
  { id: "mad", name: "Madrid", lat: 40.42, lon: -3.7 },
  { id: "ber", name: "Berlin", lat: 52.52, lon: 13.4 },
  { id: "rom", name: "Rome", lat: 41.9, lon: 12.5 },
  { id: "sto", name: "Stockholm", lat: 59.33, lon: 18.07 },
  { id: "rey", name: "Reykjavík", lat: 64.15, lon: -21.94 },
  { id: "mow", name: "Moscow", lat: 55.76, lon: 37.62 },
  { id: "ist", name: "Istanbul", lat: 41.01, lon: 28.98 },
  { id: "cai", name: "Cairo", lat: 30.04, lon: 31.24 },
  { id: "los", name: "Lagos", lat: 6.52, lon: 3.38 },
  { id: "nbo", name: "Nairobi", lat: -1.29, lon: 36.82 },
  { id: "jnb", name: "Johannesburg", lat: -26.2, lon: 28.05 },
  { id: "cpt", name: "Cape Town", lat: -33.92, lon: 18.42 },
  { id: "dxb", name: "Dubai", lat: 25.2, lon: 55.27 },
  { id: "thr", name: "Tehran", lat: 35.69, lon: 51.39 },
  { id: "del", name: "Delhi", lat: 28.61, lon: 77.21 },
  { id: "bom", name: "Mumbai", lat: 19.08, lon: 72.88 },
  { id: "bkk", name: "Bangkok", lat: 13.76, lon: 100.5 },
  { id: "sin", name: "Singapore", lat: 1.35, lon: 103.82 },
  { id: "jkt", name: "Jakarta", lat: -6.21, lon: 106.85 },
  { id: "hkg", name: "Hong Kong", lat: 22.32, lon: 114.17 },
  { id: "bjs", name: "Beijing", lat: 39.9, lon: 116.41 },
  { id: "sha", name: "Shanghai", lat: 31.23, lon: 121.47 },
  { id: "sel", name: "Seoul", lat: 37.57, lon: 126.98 },
  { id: "tyo", name: "Tokyo", lat: 35.68, lon: 139.69 },
  { id: "syd", name: "Sydney", lat: -33.87, lon: 151.21 },
  { id: "per", name: "Perth", lat: -31.95, lon: 115.86 },
  { id: "akl", name: "Auckland", lat: -36.85, lon: 174.76 },
]
