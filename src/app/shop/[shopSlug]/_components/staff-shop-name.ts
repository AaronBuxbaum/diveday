import { cookies } from "next/headers";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { DEMO_SHOP_NAME_COOKIE, demoShopNameFor } from "@/lib/demo-shop-name";

type NamedShop = { id: string; name: string; slug: string; isDemo: boolean };

/**
 * **The name a staff screen calls this shop** (H-20261014-demo-wears-visitor-shop). A real shop's own name,
 * always. A minted demo wears the name its visitor typed at the door, read
 * from the cookie bound to this shop (`src/lib/demo-shop-name.ts`), so only
 * the browser that typed it sees it. The canonical demo shop is shared by
 * everyone and never wears one.
 *
 * Staff screens and the email preview only. The storefront, every mail that
 * leaves and every export keep `shop.name`.
 */
export async function staffShopName(shop: NamedShop): Promise<string> {
  if (!shop.isDemo || shop.slug === DEMO_SHOP_SLUG) return shop.name;
  const worn = demoShopNameFor((await cookies()).get(DEMO_SHOP_NAME_COOKIE)?.value, shop.id);
  return worn ?? shop.name;
}
