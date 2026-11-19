export type Location = {
  id: string;
  city: string;
  country: string;
  region?: string;
  latitude: number;
  longitude: number;
};

export function nearbyCity(
  places: Location[],
  latitude: number,
  longitude: number,
): Location | null {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  let nearest: Location | null = null,
    best = 50;
  for (const place of places) {
    const a =
      Math.sin(radians(latitude - place.latitude) / 2) ** 2 +
      Math.cos(radians(latitude)) *
        Math.cos(radians(place.latitude)) *
        Math.sin(radians(longitude - place.longitude) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (distance < best) {
      best = distance;
      nearest = place;
    }
  }
  return nearest;
}
