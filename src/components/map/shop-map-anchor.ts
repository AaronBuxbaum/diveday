import type { ShopAnchor } from "./SiteMap";

/** A shop label belongs only at its recorded position. */
export function shopMapAnchor(shop: {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}): ShopAnchor | null {
  if (shop.latitude == null || shop.longitude == null) return null;
  return { name: shop.name, latitude: shop.latitude, longitude: shop.longitude };
}
