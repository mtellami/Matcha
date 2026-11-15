import { test } from "node:test";
import assert from "node:assert/strict";
import { nearbyCity, type Location } from "../src/features/location/location.ts";

const places: Location[] = [
  {
    id: "rabat",
    city: "Rabat",
    country: "Morocco",
    latitude: 34.02,
    longitude: -6.84,
  },
  {
    id: "casablanca",
    city: "Casablanca",
    country: "Morocco",
    latitude: 33.59,
    longitude: -7.62,
  },
];
test("GPS suggests a nearby city without changing coordinates", () => {
  assert.equal(nearbyCity(places, 33.6, -7.63)?.id, "casablanca");
  assert.equal(nearbyCity(places, 34.03, -6.85)?.id, "rabat");
});
test("GPS outside catalogue coverage requires a label instead of guessing a city", () => {
  assert.equal(nearbyCity(places, 48.86, 2.35), null);
  assert.equal(nearbyCity([], 33.59, -7.62), null);
});
test("invalid GPS coordinates are never treated as a city match", () => {
  assert.equal(nearbyCity(places, NaN, 0), null);
  assert.equal(nearbyCity(places, 91, 0), null);
  assert.equal(nearbyCity(places, 0, 181), null);
});
