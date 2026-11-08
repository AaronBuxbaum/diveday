import { Suspense } from "react";
import { getDb } from "@/db/client";
import { shopByIdCached } from "@/db/shops";
import type { requireStaffSession } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { CallPanel, type CallPanelSearch } from "./CallPanel";

/** What the shop home's URL says about the panel: `call=1` opens it. */
type CallPanelParams = CallPanelSearch & { call?: string };

/**
 * The shop home's "Add a booking" panel (`?call=1`, #2737), above the day and
 * in its own boundary, so the panel paints without waiting on the day's queue
 * and the home's static shell never waits on its query. Nothing at all
 * without `call`.
 */
export function CallPanelSlot(props: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  /** The home's own query; the panel reads only its part of it. */
  searchParams: Promise<CallPanelParams>;
}) {
  return (
    <Suspense fallback={null}>
      <CallPanelBody {...props} />
    </Suspense>
  );
}

async function CallPanelBody({
  session,
  shopSlug,
  searchParams,
}: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  searchParams: Promise<CallPanelParams>;
}) {
  const { call, page, request, notice, outcome, from } = await searchParams;
  if (!call) return null;
  const db = await getDb();
  const shop = await shopByIdCached(db, session.user.shopId);
  // The home's own rule (`TodayBody`): the session's shop, under its own
  // slug, or nothing. The day below says `notFound()` for both.
  if (!shop || shop.slug !== shopSlug) return null;
  const locale = await requestLocale(shop.defaultLocale);
  return (
    <div className="mb-10">
      <CallPanel
        db={db}
        shop={shop}
        user={session.user}
        shopSlug={shopSlug}
        locale={locale}
        t={staffTranslator(locale)}
        search={{ page, request, notice, outcome, from }}
      />
    </div>
  );
}
