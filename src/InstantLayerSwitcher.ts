import * as L from "leaflet";

/**
 * Leaflet GridLayer internal methods we use for event (dis)connection and
 * triggering tile loads.  These are stable across Leaflet 1.x but are not
 * part of the public type definitions.
 */
interface GridLayerInternals {
  /** Map event handlers returned by GridLayer.getEvents(). */
  getEvents(): Record<string, (...args: unknown[]) => void>;
  /** Internal: reset grid state and load tiles for a given center/zoom. */
  _setView(center: L.LatLng, zoom: number, noPrune?: boolean, noUpdate?: boolean): void;
  /** Internal: load tiles for the current viewport. */
  _update(center?: L.LatLng): void;
  /** Internal: true while tiles are still loading. */
  _loading?: boolean;
  /** Internal: current tile zoom level. */
  _tileZoom?: number;
}

interface LayerEntry {
  layer: L.TileLayer;
  fullyLoaded: boolean;
  /** Whether the layer has been added to the Leaflet map. */
  onMap: boolean;
  /**
   * Whether the layer is currently listening to map move/zoom events
   * (i.e. will auto-request tiles when the viewport changes).
   */
  connected: boolean;
  /**
   * Lower number = higher priority for background loading.
   * The active layer always loads first regardless of this value.
   */
  priority: number;
}

/**
 * Manages multiple tile layers for instant switching with **active-layer
 * priority**.
 *
 * ### How it works
 *
 * 1. **Registration** - only the active layer is added to the map immediately.
 *    Hidden layers are deferred until the active layer fires `load`.
 *
 * 2. **Pan / zoom** - hidden layers are **disconnected** from map events so
 *    they stop requesting new tiles.  The active layer keeps full bandwidth.
 *    Once the active layer finishes loading, hidden layers are reconnected
 *    **one at a time** in `priority` order (lowest number first).  Each hidden
 *    layer triggers `_update()` when reconnected and waits for its `load`
 *    before the next one is reconnected.
 *
 *    No DOM elements are removed or recreated - already-loaded tiles stay in
 *    place, only *new* tile requests are deferred.
 *
 * 3. **switchTo()** - the target layer is ensured on the map and connected,
 *    opacity is swapped, and the priority waterfall restarts for the
 *    remaining layers.
 */
export class InstantLayerSwitcher {
  private readonly map: L.Map;
  private readonly layers: Record<string, LayerEntry> = {};
  private _activeKey: string | null = null;

  /** Keys waiting to be sequentially reconnected after a move. */
  private pendingKeys: string[] = [];
  /** True while we are sequentially reconnecting hidden layers. */
  private flushing = false;
  /** Monotonically increasing counter used to invalidate stale flush chains. */
  private flushGeneration = 0;

  constructor(map: L.Map) {
    this.map = map;
    this.map.on("movestart", this.onMoveStart, this);
  }

  get activeKey(): string | null {
    return this._activeKey;
  }

  /**
   * Register a layer.
   * @param priority - Lower number = loaded before other hidden layers.
   *                   Default `10`. The active layer always loads first.
   */
  register(
    key: string,
    layer: L.TileLayer,
    makeActive = false,
    priority = 10,
  ): void {
    this.layers[key] = {
      layer,
      fullyLoaded: false,
      onMap: false,
      connected: false,
      priority,
    };

    layer.on("load", () => {
      this.layers[key].fullyLoaded = true;
    });

    if (makeActive || this._activeKey === null) {
      this.addToMap(key);
      this.switchTo(key);
      layer.once("load", () => this.startFlush());
    } else {
      // Don't add to map yet - wait for the active layer to finish.
      this.pendingKeys.push(key);
      if (this._activeKey && this.layers[this._activeKey]?.fullyLoaded) {
        this.startFlush();
      }
    }
  }

  /**
   * Switch the visible layer to `key`.
   * @returns `true` if the switch was instant (layer tiles were already loaded).
   */
  switchTo(key: string): boolean {
    if (key === this._activeKey) return true;

    const next = this.layers[key];
    if (!next) throw new Error(`Layer "${key}" is not registered.`);

    // Hide the old active layer.
    if (this._activeKey && this.layers[this._activeKey]) {
      this.applyOpacity(this.layers[this._activeKey].layer, 0);
    }

    // Ensure the new active layer is on the map and connected.
    if (!next.onMap) this.addToMap(key);
    if (!next.connected) this.connectLayer(key);

    this.applyOpacity(next.layer, 1);
    const wasInstant = next.fullyLoaded;
    this._activeKey = key;

    // Restart the waterfall - disconnect hidden layers, then flush them
    // back in priority order once the new active layer finishes.
    this.suspendHiddenLayers();
    if (next.fullyLoaded) {
      this.startFlush();
    } else {
      next.layer.once("load", () => this.startFlush());
    }

    return wasInstant;
  }

  isActive(key: string): boolean {
    return this._activeKey === key;
  }

  isLoaded(key: string): boolean {
    return this.layers[key]?.fullyLoaded ?? false;
  }

  // ── Pan / zoom lifecycle ────────────────────────────────────────────

  /**
   * Called on `movestart`.  Disconnects hidden layers from map events so
   * the active layer gets 100 % of the browser's connection pool for new
   * tile requests.  Already-loaded tile DOM elements are untouched.
   */
  private onMoveStart = (): void => {
    this.suspendHiddenLayers();

    if (this._activeKey) {
      const active = this.layers[this._activeKey];
      active.fullyLoaded = false;
      active.layer.once("load", () => this.startFlush());
    }
  };

  /**
   * Disconnect all non-active layers from map events and queue them for
   * sequential reconnection.  No DOM changes - tiles already in the DOM
   * stay there.
   */
  private suspendHiddenLayers(): void {
    this.flushing = false;
    this.pendingKeys = [];

    for (const [key, entry] of Object.entries(this.layers)) {
      if (key === this._activeKey) continue;
      if (entry.connected) {
        this.disconnectLayer(key);
      }
      if (entry.onMap) {
        this.pendingKeys.push(key);
      }
    }
  }

  // ── Sequential flush (priority waterfall) ───────────────────────────

  /** Sort pending keys by priority and start reconnecting them one by one. */
  private startFlush(): void {
    if (this.flushing) return;
    this.flushing = true;
    this.flushGeneration++;

    this.pendingKeys.sort(
      (a, b) => this.layers[a].priority - this.layers[b].priority,
    );
    this.flushNext(this.flushGeneration);
  }

  /**
   * Reconnect the next pending layer, trigger its `_update()` so it
   * requests tiles for the current viewport, and wait for `load` before
   * continuing.  The `generation` parameter guards against stale callbacks.
   */
  private flushNext(generation: number): void {
    if (!this.flushing || generation !== this.flushGeneration) return;
    if (this.pendingKeys.length === 0) {
      this.flushing = false;
      return;
    }

    const key = this.pendingKeys.shift()!;
    if (key === this._activeKey) {
      this.flushNext(generation);
      return;
    }

    const entry = this.layers[key];

    // First-time flush: layer hasn't been added to the map yet.
    // addToMap will add it, connect events, and trigger tile loading.
    if (!entry.onMap) {
      this.addToMap(key);
    } else if (!entry.connected) {
      // Already on the map but disconnected (pan/zoom suspend) -
      // reconnect and manually trigger tile loading.
      this.connectLayer(key);
      this.triggerUpdate(entry);
    }

    const internals = entry.layer as unknown as GridLayerInternals;
    if (!internals._loading) {
      // All tiles for this layer are already cached - move on immediately.
      this.flushNext(generation);
    } else {
      entry.layer.once("load", () => this.flushNext(generation));
    }
  }

  // ── Event (dis)connection helpers ───────────────────────────────────

  /** Subscribe a layer to its map events (moveend, viewreset, etc.). */
  private connectLayer(key: string): void {
    const entry = this.layers[key];
    if (!entry || entry.connected) return;
    const events = (entry.layer as unknown as GridLayerInternals).getEvents();
    for (const [type, fn] of Object.entries(events)) {
      this.map.on(type, fn, entry.layer);
    }
    entry.connected = true;
  }

  /** Unsubscribe a layer from map events so it stops requesting new tiles. */
  private disconnectLayer(key: string): void {
    const entry = this.layers[key];
    if (!entry || !entry.connected) return;
    const events = (entry.layer as unknown as GridLayerInternals).getEvents();
    for (const [type, fn] of Object.entries(events)) {
      this.map.off(type, fn as L.LeafletEventHandlerFn, entry.layer);
    }
    entry.connected = false;
  }

  /**
   * Reset the layer's internal grid state for the current map center/zoom
   * and trigger tile loading.  This is necessary because the layer missed
   * the `viewreset` / `moveend` events while it was disconnected, so its
   * internal `_tileZoom`, `_levels`, and `_globalTileRange` are stale.
   *
   * Calling `_setView()` (rather than just `_update()`) mirrors what
   * Leaflet itself does in `_resetView`, which is the handler for the
   * `viewreset` event the layer missed.
   */
  private triggerUpdate(entry: LayerEntry): void {
    const internals = entry.layer as unknown as GridLayerInternals;
    entry.fullyLoaded = false;
    internals._setView(this.map.getCenter(), this.map.getZoom(), false, false);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Add a layer to the map.  Leaflet's `addTo()` calls `onAdd()` which
   * subscribes to map events via `getEvents()`.  We track that as
   * `connected = true`.
   */
  private addToMap(key: string): void {
    const entry = this.layers[key];
    if (!entry || entry.onMap) return;
    entry.layer.addTo(this.map);
    this.applyOpacity(entry.layer, 0);
    entry.onMap = true;
    entry.connected = true; // addTo → onAdd → map.on(getEvents())
  }

  private applyOpacity(layer: L.TileLayer, opacity: number): void {
    layer.setOpacity(opacity);
    const container = (
      layer as unknown as { getContainer?: () => HTMLElement | undefined }
    ).getContainer?.();
    if (container) {
      container.style.pointerEvents = opacity === 0 ? "none" : "";
    }
  }
}
