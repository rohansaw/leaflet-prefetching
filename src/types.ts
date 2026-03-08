import type { TileLayer } from "leaflet";

export type PrefetchType =
  | "currentLayers"
  | "nextLocation"
  | "nextLocationLayers";

export interface LayerConfig {
  /** Unique key identifying this layer. */
  key: string;
  /** The Leaflet TileLayer instance. */
  layer: TileLayer;
  /**
   * Lower number = higher prefetch priority.
   * @default 10
   */
  priority?: number;
}

export interface PrefetchManagerOptions {
  /**
   * Maximum simultaneous prefetch requests.
   * @default 6
   */
  concurrency?: number;

  /**
   * Order in which prefetch types are processed (first = highest priority).
   * @default ["currentLayers", "nextLocation", "nextLocationLayers"]
   */
  typePriority?: PrefetchType[];

  /**
   * Zoom offsets to also prefetch for next-location (e.g. [-1, 0, 1]).
   * @default [0]
   */
  nextLocationZoomOffsets?: number[];

  onTilePrefetched?: (url: string, type: PrefetchType, layerKey: string) => void;
  onTileError?: (url: string, error: Error) => void;
}

export interface PrefetchStats {
  queued: number;
  inFlight: number;
  prefetched: number;
}

export interface QueueItem {
  url: string;
  type: PrefetchType;
  layerKey: string;
  /** Lower score = higher priority. */
  score: number;
}

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}
