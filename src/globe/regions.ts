import type { GlobeCamera } from "./camera"

/** Views the toolbar can fly to. */
export const REGIONS: ReadonlyArray<readonly [string, GlobeCamera]> = [
  ["Americas", { lon: -80, lat: 15, zoom: 1.3 }],
  ["Europe", { lon: 12, lat: 47, zoom: 3.2 }],
  ["Africa", { lon: 20, lat: 2, zoom: 1.6 }],
  ["Asia-Pacific", { lon: 120, lat: 12, zoom: 1.5 }],
  ["Globe", { lon: -30, lat: 25, zoom: 1 }],
]
