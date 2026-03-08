import * as L from "leaflet";
import type { TileCoord } from "./types.js";

/** Convert a lat/lng to slippy-map tile coordinates at a given zoom. */
function latLngToTile(lat: number, lng: number, zoom: number): L.Point {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return L.point(x, y);
}

/** Return all tile coords covering a LatLngBounds at a given zoom. */
export function getTileCoordsForBounds(
  bounds: L.LatLngBounds,
  zoom: number
): TileCoord[] {
  const z = Math.round(zoom);
  const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), z);
  const se = latLngToTile(bounds.getSouth(), bounds.getEast(), z);
  const maxTile = Math.pow(2, z) - 1;

  const coords: TileCoord[] = [];
  for (let x = Math.max(0, nw.x); x <= Math.min(maxTile, se.x); x++) {
    for (let y = Math.max(0, nw.y); y <= Math.min(maxTile, se.y); y++) {
      coords.push({ x, y, z });
    }
  }
  return coords;
}

/**
 * Build a tile URL for a given coord without calling getTileUrl().
 *
 * We bypass layer.getTileUrl() because:
 *  1. Hidden layers have no map reference, causing _getZoomForUrl() to return NaN.
 *  2. Leaflet's guard `coords.z ? coords.z : this._getZoomForUrl()` treats
 *     zoom level 0 as falsy, also producing NaN.
 */
export function buildTileUrl(layer: L.TileLayer, coord: TileCoord): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = layer as any;
  const data: Record<string, string | number> = {
    r: L.Browser.retina && layer.options.detectRetina ? "@2x" : "",
    s: l._getSubdomain ? l._getSubdomain(L.point(coord.x, coord.y)) : "",
    x: coord.x,
    y: coord.y,
    z: coord.z + ((layer.options as L.TileLayerOptions).zoomOffset ?? 0),
  };
  return L.Util.template(l._url as string, L.extend(data, layer.options));
}

/**
 * Return a LatLngBounds with the same geographic size as the map's current
 * viewport but centred on a different location.
 */
export function viewportBoundsAt(map: L.Map, center: L.LatLng): L.LatLngBounds {
  const b = map.getBounds();
  const dLat = (b.getNorth() - b.getSouth()) / 2;
  const dLng = (b.getEast() - b.getWest()) / 2;
  return L.latLngBounds(
    L.latLng(center.lat - dLat, center.lng - dLng),
    L.latLng(center.lat + dLat, center.lng + dLng)
  );
}
