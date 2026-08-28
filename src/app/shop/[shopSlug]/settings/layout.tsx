import type { ReactNode } from "react";
import { Suspense } from "react";
import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  canExportShopData,
  canImportShopData,
  canManageMessagingSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canViewShopReports,
} from "@/lib/authz";
import { requireShopSurface } from "@/lib/session";
import { SettingsRail } from "./_components/SettingsRail";
import { SETTINGS_GROUPS, type SettingsRailGate, settingsRailRowsFor } from "./settings-groups";

/**
 * Settings is a rail and a pane — ADR 20260827-clearwater-surface-language,
 * decision 6. This is the frame that holds the two: the map on the left from
 * `lg` up, the destination on the right, and below `lg` nothing at all beyond
 * the page it has always been.
 *
 * The layout itself awaits nothing above `{children}` — a request-scoped read
 * there would cost every route beneath it its static shell (ADR
 * 20260804-instant-navigation) — so the rail's session, shop and permission
 * reads live in an async child inside its own `<Suspense>`.
 */
export default function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  return (
    /* **Flex, not grid, and the reason is a reader rather than a taste.**
       `/settings/calendar` is a staffer's own feed and takes no permission
       gate, so an ordinary staffer reaches this frame while the map beside it
       is drawn only for someone who may manage the shop. Under
       `grid-cols-[264px_1fr]` that reader's pane was auto-placed into the
       *first* track — 264px wide at desktop, on a page with a whole empty
       column beside it. A flex row has no track to fall into: the rail is a
       fixed-width sibling when it exists, and when it does not the pane simply
       takes the width. */
    <div className="mx-auto w-full max-w-6xl lg:flex lg:gap-8 lg:px-6">
      <Suspense fallback={<SettingsRailSkeleton />}>
        <SettingsRailPanel params={params} />
      </Suspense>
      <div className="min-w-0 lg:flex-1">{children}</div>
    </div>
  );
}

function SettingsRailSkeleton() {
  return (
    <div className="hidden lg:block lg:w-[264px] lg:shrink-0" aria-hidden="true">
      <div className="sticky top-(--chrome-h) animate-pulse space-y-6 py-10 pe-2">
        {[0, 1, 2].map((group) => (
          <div key={group} className="space-y-2">
            <div className="mx-2 h-3 w-24 rounded bg-surface-sunken" />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="mx-2 h-4 w-36 rounded bg-surface-sunken" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The rail's own reads, gathered where a `<Suspense>` boundary can hold them.
 *
 * `requireShopSurface` without an `allow` gate deliberately: this is the frame
 * around `/settings/calendar` too, which is a staffer's *personal* feed and
 * sits outside the hub's owner/manager gate on purpose. So the tenant assert
 * runs for everyone, and the map itself is drawn only for a reader who may
 * manage the shop. Hiding a row is convenience; every destination re-checks
 * its own permission server-side, and none of them lost that in the
 * decomposition.
 */
async function SettingsRailPanel({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const canSettings = await canPersonManageShopSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!canSettings) return null;

  const canPayments = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  const roles = session.user.roles;
  const gates = new Set<SettingsRailGate>();
  if (canPayments) gates.add("payments");
  if (canManageStaffAccounts(roles)) gates.add("team");
  if (canManageWaiverTemplates(roles)) gates.add("waivers");
  if (canViewShopReports(roles)) gates.add("promos");
  if (canManageMessagingSettings(roles)) gates.add("messaging");
  if (canImportShopData(roles)) gates.add("import");
  if (canExportShopData(roles)) gates.add("export");
  if (shop.hasBoatDiving) gates.add("boats");

  const rows = settingsRailRowsFor(gates);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // The one badge the map may carry, from the same summary reader the hub row
  // states its own value with — never a query of the rail's own.
  const badges: Record<string, string> = {};
  const paymentRows = rows.filter((row) => row.badgeSource === "payments");
  if (paymentRows.length > 0) {
    const account = await getShopStripeAccount(db, session.user.shopId);
    const warning = !account
      ? t("settings.main.stripe.summaryNotConnected")
      : account.disconnectedAt
        ? t("settings.main.stripe.summaryDisconnected")
        : canAcceptPayments(account)
          ? undefined
          : t("settings.main.stripe.notReadyBadge");
    if (warning) for (const row of paymentRows) badges[row.id] = warning;
  }

  return (
    <SettingsRail
      groups={SETTINGS_GROUPS.map((group) => ({
        id: group.id,
        label: t(group.labelKey),
        rows: rows.filter((row) => row.group === group.id),
      })).filter((group) => group.rows.length > 0)}
      labels={Object.fromEntries(rows.map((row) => [row.id, t(row.labelKey)]))}
      badges={badges}
      shopBasePath={`/shop/${shop.slug}`}
      ariaLabel={t("settings.main.rail.ariaLabel")}
    />
  );
}
