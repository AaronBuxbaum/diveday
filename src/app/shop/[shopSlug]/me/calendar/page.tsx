import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import {
  FEED_FUTURE_DAYS,
  FEED_PAST_DAYS,
  type FeedScope,
  listCalendarFeeds,
} from "@/features/calendar-sync";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { StaffIntlProvider } from "@/i18n/StaffIntlProvider";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { staffPageClass } from "../../_components/staff-page";
import { CalendarFeedPanel } from "./CalendarFeedPanel";
import type { FeedScopeView } from "./feed-panel-types";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

/**
 * Static metadata resolves before locale negotiation, so it stays English —
 * the same documented exemption every other page's title carries (docs ADR
 * 20260729-diver-copy-localization).
 */
export const metadata: Metadata = { title: "Calendar subscriptions — DiveDay" };

export default async function CalendarSubscriptionsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // No `allow` gate, deliberately: a staff calendar subscription is a personal
  // feed, not shop policy, which is why it lives under `/me` and not Settings.
  const { session, db, shop } = await requireShopSurface(shopSlug);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const feeds = await listCalendarFeeds(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
  });

  // The whole-shop feed is a rolling export of the operation, so it is offered
  // only to the roles that may see one. The store re-checks this on issue and
  // on every fetch — hiding it here is convenience, not the gate.
  const canSeeShopWide = session.user.roles.some((role) => role === "owner" || role === "manager");
  const scopes: FeedScope[] = canSeeShopWide ? ["assignments", "shop_trips"] : ["assignments"];

  const views: FeedScopeView[] = scopes.map((scope) => {
    const live = feeds.find((feed) => feed.scope === scope);
    // Dates are formatted here, against the negotiated locale and the shop's
    // timezone, so the Client Component never needs a locale of its own.
    return {
      scope,
      name: t(
        scope === "shop_trips"
          ? "calendar.scope.shopTrips.name"
          : "calendar.scope.assignments.name",
      ),
      detail: t(
        scope === "shop_trips"
          ? "calendar.scope.shopTrips.detail"
          : "calendar.scope.assignments.detail",
      ),
      subscribedLabel: live
        ? t("calendar.status.active", {
            issued: formatDateTimeTz(live.issuedAt, locale, shop.timezone),
          })
        : null,
      lastReadLabel: live?.lastAccessedAt
        ? t("calendar.status.lastRead", {
            when: formatDateTimeTz(live.lastAccessedAt, locale, shop.timezone),
          })
        : null,
    };
  });

  return (
    <main className={staffPageClass("reading")}>
      <ShopPageHeader eyebrow={t("settings.security.title")} title={t("calendar.title")} />

      <p className="mb-6 text-sm text-muted">{t("calendar.refreshNote")}</p>

      <StaffIntlProvider
        locale={locale}
        timeZone={shop.timezone}
        namespaces={["calendar", "words"]}
      >
        <div className="border-t border-border">
          {views.map((view) => (
            <CalendarFeedPanel
              key={view.scope}
              view={view}
              subscribed={feeds.some((feed) => feed.scope === view.scope)}
              createVariant="secondary"
            />
          ))}
        </div>
      </StaffIntlProvider>

      <p className="mt-6 text-xs text-muted">
        {t("calendar.coverage", { past: FEED_PAST_DAYS, future: FEED_FUTURE_DAYS })}
      </p>
    </main>
  );
}
