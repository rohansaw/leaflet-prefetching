import { describe, it, expect } from "vitest";
import { getTileCoordsForBounds } from "./tileUtils.js";
import * as L from "leaflet";

describe("getTileCoordsForBounds", () => {
  it("returns tiles covering the given bounds at zoom 1", () => {
    // At zoom 1 the world is 2x2 tiles
    const world = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));
    const coords = getTileCoordsForBounds(world, 1);
    expect(coords.length).toBe(4);
    expect(coords.every((c) => c.z === 1)).toBe(true);
  });

  it("clamps to valid tile range", () => {
    const world = L.latLngBounds(L.latLng(-90, -200), L.latLng(90, 200));
    const coords = getTileCoordsForBounds(world, 2);
    const max = Math.pow(2, 2) - 1;
    expect(coords.every((c) => c.x >= 0 && c.x <= max)).toBe(true);
    expect(coords.every((c) => c.y >= 0 && c.y <= max)).toBe(true);
  });

  it("returns a single tile for a tiny area at low zoom", () => {
    // London at zoom 0 should be tile (0,0,0)
    const london = L.latLngBounds(
      L.latLng(51.4, -0.2),
      L.latLng(51.6, 0.0)
    );
    const coords = getTileCoordsForBounds(london, 0);
    expect(coords.length).toBe(1);
    expect(coords[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });
});
