# leaflet-prefetching

Tile prefetching and instant layer switching for [Leaflet](https://leafletjs.com) maps.

## Features

- **`InstantLayerSwitcher`** - keeps multiple tile layers ready for instant switching. The active layer is loaded first with full bandwidth priority; hidden layers are deferred until it finishes.
- **`PrefetchingManager`** - prefetch tiles for a known next location across all layers, ordered by a fixed per-layer priority.

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

const cartoLayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  { subdomains: ["a", "b", "c", "d"] }
);
const satLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
);

// Active layer loads first; hidden layers are deferred until it finishes.
switcher.register("carto",     cartoLayer, true); // true = active
switcher.register("satellite", satLayer);

const manager = new PrefetchingManager(map, switcher, [
  { key: "carto",     layer: cartoLayer, priority: 0 },
  { key: "satellite", layer: satLayer,   priority: 1 },
], {
  onQueueEmpty() {
    console.log("All prefetching complete");
  },
});

// Prefetch tiles for a future location (all layers, by priority order)
manager.prefetchNextLocation(L.latLng(48.8566, 2.3522));

// Navigate - instant if tiles are already cached
map.setView(L.latLng(48.8566, 2.3522), map.getZoom());

// Switch layers - instant if the layer's tiles are loaded
switcher.switchTo("satellite");
```

## API

### `InstantLayerSwitcher`

Manages multiple tile layers on a single map. The active layer is added to the map immediately and gets full browser bandwidth. Hidden layers are deferred until the active layer finishes loading, then added at opacity 0 for instant switching later.

On every pan/zoom, hidden layers are temporarily **disconnected** from map events so the active layer gets 100% of browser connections. Once it finishes, hidden layers are reconnected one at a time in priority order - no DOM elements are destroyed or recreated, so already-loaded tiles stay in place.

```ts
const switcher = new InstantLayerSwitcher(map);

switcher.register(key, layer, makeActive?)  // register a layer (deferred unless active)
switcher.switchTo(key)                      // returns true if switch was instant
switcher.isActive(key)                      // boolean
switcher.isLoaded(key)                      // true once layer's 'load' event fired
switcher.activeKey                          // string | null
```

---

### `PrefetchingManager`

Prefetches tiles into the browser cache using `Image()` requests, independent of Leaflet's own tile loading. Primarily useful for pre-loading tiles at a **future location** so that navigation + layer switches there are instant.

> **Note:** If you are using `InstantLayerSwitcher`, you do **not** need to call `prefetchHiddenLayers()` for the current viewport - the switcher already handles loading all registered layers at the current view. Use the manager for **next-location** prefetching.

```ts
const manager = new PrefetchingManager(map, switcher, layerConfigs, options?);

manager.prefetchNextLocation(latLng)        // prefetch all layers at a future location (by priority)
manager.prefetchHiddenLayers()              // prefetch hidden layers at current viewport (not needed with InstantLayerSwitcher)
manager.clearQueue()                        // cancel pending (not in-flight) requests
manager.resetCache()                        // allow tiles to be re-fetched
manager.getStats()                          // { queued, inFlight, prefetched }
manager.isLayerPrefetched(key)              // true once all tiles for a layer are done
```

**`LayerConfig`**

```ts
{ key: string; layer: L.TileLayer; priority?: number; prefetch?: boolean }
```

- `priority` - lower number = prefetched first. All layers are prefetched in this fixed order. Default: `10`.
- `prefetch` - set to `false` to exclude a layer from prefetching entirely. Default: `true`.

**`PrefetchManagerOptions`**

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `6` | Max simultaneous prefetch requests |
| `nextLocationZoomOffsets` | `number[]` | `[0]` | Extra zoom levels to also prefetch, e.g. `[-1, 0, 1]` |
| `onTilePrefetched` | `fn` | - | Called on each successful prefetch |
| `onTileError` | `fn` | - | Called on each failed prefetch |
| `onQueueEmpty` | `fn` | - | Called when the queue is fully drained and no requests are in flight |


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
