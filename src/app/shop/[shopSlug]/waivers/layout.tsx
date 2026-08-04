import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { WaiversSubNav, type WaiversSubNavCopy } from "./_components/WaiversSubNav";

// Restored alongside `trips/[id]/layout.tsx` — same reasoning, same commit.
// Not implicated by any failing spec, but it was removed on the same argument,
// so it goes back on the same evidence. See ADR 20260803-instant-opt-out-placement.
export const instant = false;

/**
 * One shell for both waiver surfaces — Template and Signatures (task 155).
 * Owning the container width and the sub-nav here, rather than repeating them
 * on each page, keeps the two tabs visually identical and keeps the nav
 * mounted across navigations, matching `trips/[id]/layout.tsx`'s pattern.
 * Each page still runs its own `requireStaffSession()` + `canPersonManageWaiverTemplates`
 * gate — the layout does not authorize anything.
 */
export default async function WaiversLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  // Staff read the nav in the language their own device asks for, same
  // negotiation as every other staff surface (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const subNavCopy: WaiversSubNavCopy = {
    ariaLabel: t("waiversStaff.tabs.ariaLabel"),
    template: t("waiversStaff.tabs.template"),
    signatures: t("waiversStaff.tabs.signatures"),
  };
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <WaiversSubNav shopSlug={shopSlug} copy={subNavCopy} className="mb-6" />
      {children}
    </main>
  );
}
