import * as L from "leaflet";

interface LayerEntry {
  layer: L.TileLayer;
  fullyLoaded: boolean;
}

/**
 * Keeps all registered layers on the map simultaneously at opacity 0.
 * Switching between layers is a single opacity change - no DOM teardown,
 * no tile grid rebuild, no flicker.
 */
export class InstantLayerSwitcher {
  private readonly map: L.Map;
  private readonly layers: Record<string, LayerEntry> = {};
  private _activeKey: string | null = null;

  constructor(map: L.Map) {
    this.map = map;
  }

  get activeKey(): string | null {
    return this._activeKey;
  }

  /**
   * Register a layer. It is added to the map immediately at opacity 0.
   * @param makeActive - If true, this layer becomes the visible one.
   */
  register(key: string, layer: L.TileLayer, makeActive = false): void {
    layer.addTo(this.map);
    this.applyOpacity(layer, 0);

    this.layers[key] = { layer, fullyLoaded: false };
    layer.on("load", () => {
      this.layers[key].fullyLoaded = true;
    });

    if (makeActive) this.switchTo(key);
  }

  /**
   * Switch the visible layer to `key`.
   * @returns `true` if the switch was instant (layer tiles were already loaded).
   */
  switchTo(key: string): boolean {
    if (key === this._activeKey) return true;

    const next = this.layers[key];
    if (!next) throw new Error(`Layer "${key}" is not registered.`);

    if (this._activeKey && this.layers[this._activeKey]) {
      this.applyOpacity(this.layers[this._activeKey].layer, 0);
    }

    this.applyOpacity(next.layer, 1);
    const wasInstant = next.fullyLoaded;
    this._activeKey = key;
    return wasInstant;
  }

  isActive(key: string): boolean {
    return this._activeKey === key;
  }

  isLoaded(key: string): boolean {
    return this.layers[key]?.fullyLoaded ?? false;
  }

  private applyOpacity(layer: L.TileLayer, opacity: number): void {
    layer.setOpacity(opacity);
    const container = (layer as unknown as { getContainer?: () => HTMLElement | undefined }).getContainer?.();
    if (container) {
      container.style.pointerEvents = opacity === 0 ? "none" : "";
    }
  }
}
