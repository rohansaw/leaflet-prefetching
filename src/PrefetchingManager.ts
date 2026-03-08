import * as L from "leaflet";
import { buildTileUrl, getTileCoordsForBounds, viewportBoundsAt } from "./tileUtils.js";
import type {
  LayerConfig,
  PrefetchManagerOptions,
  PrefetchStats,
  PrefetchType,
  QueueItem,
} from "./types.js";
import type { InstantLayerSwitcher } from "./InstantLayerSwitcher.js";

const DEFAULT_TYPE_PRIORITY: PrefetchType[] = [
  "currentLayers",
  "nextLocation",
  "nextLocationLayers",
];

export class PrefetchingManager {
  private readonly map: L.Map;
  private readonly switcher: InstantLayerSwitcher;
  private readonly layerConfigs: LayerConfig[];
  private readonly options: Required<PrefetchManagerOptions>;

  private readonly prefetchedUrls = new Set<string>();
  private readonly prefetchedLayers = new Set<string>();
  private queue: QueueItem[] = [];
  private inFlight = 0;

  constructor(
    map: L.Map,
    switcher: InstantLayerSwitcher,
    layerConfigs: LayerConfig[],
    options: PrefetchManagerOptions = {}
  ) {
    this.map = map;
    this.switcher = switcher;
    this.layerConfigs = layerConfigs;
    this.options = {
      concurrency: options.concurrency ?? 6,
      typePriority: options.typePriority ?? DEFAULT_TYPE_PRIORITY,
      nextLocationZoomOffsets: options.nextLocationZoomOffsets ?? [0],
      onTilePrefetched: options.onTilePrefetched ?? (() => {}),
      onTileError: options.onTileError ?? (() => {}),
      onQueueEmpty: options.onQueueEmpty ?? (() => {}),
    };
  }

  /** Prefetch all hidden layers for the current map viewport. */
  prefetchHiddenLayers(): void {
    this.enqueueLayerTiles(
      this.map.getBounds(),
      this.map.getZoom(),
      "currentLayers"
    );
    this.drain();
  }

  /**
   * Prefetch tiles for a known next location:
   * - Active layer tiles centred on `nextCenter` at current zoom (+/- offsets)
   * - All hidden layer tiles for the same viewport
   */
  prefetchNextLocation(nextCenter: L.LatLng): void {
    const zoom = this.map.getZoom();
    const nextBounds = viewportBoundsAt(this.map, nextCenter);
    const typeScore = this.typeScore("nextLocation");

    for (const offset of this.options.nextLocationZoomOffsets) {
      const z = Math.max(0, zoom + offset);
      for (const cfg of this.activeLayers()) {
        for (const coord of getTileCoordsForBounds(nextBounds, z)) {
          this.enqueue(
            buildTileUrl(cfg.layer, coord),
            "nextLocation",
            typeScore + (cfg.priority ?? 10),
            cfg.key
          );
        }
      }
    }

    this.enqueueLayerTiles(nextBounds, zoom, "nextLocationLayers");
    this.drain();
  }

  /** Clear the pending queue (in-flight requests are not cancelled). */
  clearQueue(): void {
    this.queue = [];
  }

  /** Reset prefetch cache, allowing tiles to be re-fetched. */
  resetCache(): void {
    this.prefetchedUrls.clear();
    this.prefetchedLayers.clear();
  }

  getStats(): PrefetchStats {
    return {
      queued: this.queue.length,
      inFlight: this.inFlight,
      prefetched: this.prefetchedUrls.size,
    };
  }

  /** Returns true once all tiles for a given layer key have been prefetched. */
  isLayerPrefetched(key: string): boolean {
    return this.prefetchedLayers.has(key);
  }

  private hiddenLayers(): LayerConfig[] {
    return this.layerConfigs.filter(
      (c) => c.prefetch !== false && !this.switcher.isActive(c.key)
    );
  }

  private activeLayers(): LayerConfig[] {
    return this.layerConfigs.filter(
      (c) => c.prefetch !== false && this.switcher.isActive(c.key)
    );
  }

  private typeScore(type: PrefetchType): number {
    const i = this.options.typePriority.indexOf(type);
    return (i === -1 ? 99 : i) * 1000;
  }

  private enqueueLayerTiles(
    bounds: L.LatLngBounds,
    zoom: number,
    type: PrefetchType
  ): void {
    const score = this.typeScore(type);
    const sorted = [...this.hiddenLayers()].sort(
      (a, b) => (a.priority ?? 10) - (b.priority ?? 10)
    );
    for (const cfg of sorted) {
      for (const coord of getTileCoordsForBounds(bounds, zoom)) {
        this.enqueue(
          buildTileUrl(cfg.layer, coord),
          type,
          score + (cfg.priority ?? 10),
          cfg.key
        );
      }
    }
  }

  private enqueue(
    url: string,
    type: PrefetchType,
    score: number,
    layerKey: string
  ): void {
    if (this.prefetchedUrls.has(url)) return;
    if (this.queue.some((i) => i.url === url)) return;
    this.queue.push({ url, type, score, layerKey });
    this.queue.sort((a, b) => a.score - b.score);
  }

  private drain(): void {
    while (this.inFlight < this.options.concurrency && this.queue.length > 0) {
      this.fetch(this.queue.shift()!);
    }
    if (this.queue.length === 0 && this.inFlight === 0) {
      this.options.onQueueEmpty();
    }
  }

  private fetch(item: QueueItem): void {
    this.inFlight++;
    this.prefetchedUrls.add(item.url);

    const img = new Image();
    img.onload = () => {
      this.inFlight--;
      if (!this.queue.some((i) => i.layerKey === item.layerKey)) {
        this.prefetchedLayers.add(item.layerKey);
      }
      this.options.onTilePrefetched(item.url, item.type, item.layerKey);
      this.drain();
    };
    img.onerror = () => {
      this.inFlight--;
      this.prefetchedUrls.delete(item.url);
      this.options.onTileError(
        item.url,
        new Error(`Failed to prefetch tile: ${item.url}`)
      );
      this.drain();
    };
    img.src = item.url;
  }
}
