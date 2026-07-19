import { DemoBanner } from "@/components/DemoBanner";
import { ShopNav } from "@/components/ShopNav";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/queries";
import { auth } from "@/lib/auth";

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

  const session = await auth();
  let currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver" = "diver";
  if (session?.user) {
    if (session.user.roles.includes("owner") || session.user.roles.includes("manager")) {
      currentRole = "owner";
    } else if (session.user.roles.includes("instructor")) {
      currentRole = "instructor";
    } else if (session.user.roles.includes("divemaster")) {
      currentRole = "divemaster";
    } else if (session.user.roles.includes("captain")) {
      currentRole = "captain";
    }
  }

  return (
    <>
      {showBanner ? (
        <DemoBanner
          currentRole={currentRole}
          currentName={session?.user?.name}
          shopSlug={shopSlug}
        />
      ) : null}
      {session?.user && shop ? <ShopNav shopSlug={shopSlug} shopName={shop.name} /> : null}
      <div className="flex-1">{children}</div>
    </>
  );
}
