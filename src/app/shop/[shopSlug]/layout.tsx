import { DemoBanner } from "@/components/DemoBanner";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/queries";

/**
 * Staff-surface shell. If the shop is a demo shop, it hangs the demo banner
 * (with its reset) above every /shop page so the "this is a playground" framing
 * is always present (docs ADR 20260718-demo-mode).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const showBanner = shop?.isDemo ?? false;

  return (
    <>
      {showBanner ? <DemoBanner /> : null}
      {children}
    </>
  );
}
