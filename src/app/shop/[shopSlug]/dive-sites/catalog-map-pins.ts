import type { MapPin } from "@/components/map/SiteMap";

export type CatalogMapPin = Pick<MapPin, "id" | "name" | "latitude" | "longitude"> & {
  slug: string;
};

/** An allowlist at the server/client boundary: no briefing or repeated presentation crosses it. */
export function compactCatalogPins(
  rows: readonly {
    templateId: string;
    slug: string;
    name: string;
    latitude: number;
    longitude: number;
  }[],
): CatalogMapPin[] {
  return rows.map(({ templateId, slug, name, latitude, longitude }) => ({
    id: templateId,
    slug,
    name,
    latitude,
    longitude,
  }));
}
