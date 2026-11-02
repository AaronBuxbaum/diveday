import type { ReactNode } from "react";
import { Suspense } from "react";
import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  canManageBilling,
  canManageMessagingSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
} from "@/lib/authz";
import { requireShopSurface } from "@/lib/session";
import { SettingsRail } from "./_components/SettingsRail";
import { SettingsRailSkeleton } from "./_components/SettingsRailSkeleton";
import { SETTINGS_GROUPS, settingsRailGatesFor, settingsRailRowsFor } from "./settings-groups";

/**
 * Settings is a rail and a pane — ADR 20260827-clearwater-surface-language,
 * decision 6. This is the frame that holds the two: the map on the left from
 * `lg` up, the destination on the right, and a compact navigation control
 * on narrower screens.
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
    // The rail is a fixed-width sibling of the pane (a flex row, so the pane
    // takes the rest). Every reader who reaches a settings page may manage the
    // shop: the reader's own account lives under `/me` (issue #2739).
    <div className="mx-auto w-full max-w-6xl lg:flex lg:gap-8 lg:px-6">
      <Suspense fallback={<SettingsRailSkeleton />}>
        <SettingsRailPanel params={params} />
      </Suspense>
      <div className="min-w-0 lg:flex-1">{children}</div>
    </div>
  );
}

/**
 * The rail's own reads, gathered where a `<Suspense>` boundary can hold them.
 *
 * **The frame does not gate; every page under it does.** A redirect here runs
 * beside the page's own and wins, so a captain sent to Today read the generic
 * "Shop settings are managed by the owner or a manager" where each page
 * explains its own reason ("Billing is limited to the owner", "Data export is
 * limited to owners and managers", H-20260724-staff-role-reach). So the tenant
 * assert runs for everyone, the map is drawn only for a reader who may manage
 * the shop, and `settings-gates.test.ts` fails a page here that names no gate
 * of its own (issue #2739: no ungated reader).
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
  const rows = settingsRailRowsFor(
    settingsRailGatesFor({
      canPayments,
      canManageTeam: canManageStaffAccounts(roles),
      canManageWaivers: canManageWaiverTemplates(roles),
      canManageMessaging: canManageMessagingSettings(roles),
      canBilling: canManageBilling(roles),
      hasBoatDiving: shop.hasBoatDiving,
      isDemo: shop.isDemo,
      selfRegistrationEnabled: shop.selfRegistrationEnabled,
    }),
  );
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
