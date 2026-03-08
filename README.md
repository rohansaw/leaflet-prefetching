# leaflet-prefetching

Tile prefetching and instant layer switching for [Leaflet](https://leafletjs.com) maps. Provides utilities for pre-loading hidden map layers and for pre-loading the map tiles around the next anticipated location.

## Features

- **`PrefetchingManager`** - prefetch tiles for hidden layers and known next locations, with per-layer priority and concurrency control
- **`InstantLayerSwitcher`** - keep multiple layers on the map at opacity 0; switching is a single opacity change with no DOM rebuild or tile flicker

## Installation

```bash
npm install leaflet-prefetching
```

Leaflet is a peer dependency - install it separately if you haven't already:

```bash
npm install leaflet
```

## Usage

```ts
import L from "leaflet";
import {
  InstantLayerSwitcher,
  PrefetchingManager,
} from "leaflet-prefetching";

const map = L.map("map").setView([51.505, -0.09], 12);
const switcher = new InstantLayerSwitcher(map);

// All layers are added to the map immediately at opacity 0.
const cartoLayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  { subdomains: ["a", "b", "c", "d"], keepBuffer: 6, updateWhenZooming: false }
);
const satLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
);

switcher.register("carto",     cartoLayer, true); // true = make active
switcher.register("satellite", satLayer);

const manager = new PrefetchingManager(map, switcher, [
  { key: "carto",     layer: cartoLayer, priority: 0 },
  { key: "satellite", layer: satLayer,   priority: 1 },
]);

// Prefetch hidden layers for the current viewport
manager.prefetchHiddenLayers();

// Prefetch tiles for a location you expect the user to navigate to next
manager.prefetchNextLocation(L.latLng(48.8566, 2.3522));

// Switch layers - instant if tiles are already cached
switcher.switchTo("satellite");
```

## API

### `InstantLayerSwitcher`

```ts
const switcher = new InstantLayerSwitcher(map);

switcher.register(key, layer, makeActive?)  // add layer to map at opacity 0
switcher.switchTo(key)                      // returns true if switch was instant
switcher.isActive(key)                      // boolean
switcher.isLoaded(key)                      // true once layer's 'load' event fired
switcher.activeKey                          // string | null
```

---

### `PrefetchingManager`

```ts
const manager = new PrefetchingManager(map, switcher, layerConfigs, options?);

manager.prefetchHiddenLayers()              // prefetch hidden layers at current viewport
manager.prefetchNextLocation(latLng)        // prefetch active + hidden layers at next location
manager.clearQueue()                        // cancel pending (not in-flight) requests
manager.resetCache()                        // allow tiles to be re-fetched
manager.getStats()                          // { queued, inFlight, prefetched }
manager.isLayerPrefetched(key)              // true once all tiles for a layer are done
```

**`LayerConfig`**

```ts
{ key: string; layer: L.TileLayer; priority?: number }
```

Lower `priority` number = prefetched first. Default: `10`.

**`PrefetchManagerOptions`**

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `6` | Max simultaneous requests |
| `typePriority` | `PrefetchType[]` | `["currentLayers", "nextLocation", "nextLocationLayers"]` | Order of prefetch types |
| `nextLocationZoomOffsets` | `number[]` | `[0]` | Extra zoom levels to also prefetch for next location, e.g. `[-1, 0, 1]` |
| `onTilePrefetched` | `fn` | - | Called on each successful prefetch |
| `onTileError` | `fn` | - | Called on each failed prefetch |


## Development

```bash
npm install
npm run dev       # watch mode
npm test          # run tests
npm run typecheck # TypeScript check
npm run build     # production build → dist/
```

## License

MIT
