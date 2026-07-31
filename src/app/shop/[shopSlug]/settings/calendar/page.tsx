import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  FEED_FUTURE_DAYS,
  FEED_PAST_DAYS,
  type FeedScope,
  listCalendarFeeds,
} from "@/features/calendar-sync";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { CalendarFeedPanel } from "./CalendarFeedPanel";
import type { CalendarFeedCopy, FeedScopeView } from "./feed-panel-types";

/**
 * Static metadata resolves before locale negotiation, so it stays English —
 * the same documented exemption every other page's title carries (docs ADR
 * 20260729-diver-copy-localization).
 */
export const metadata: Metadata = { title: "Calendar subscriptions — DiveDay" };

export default async function CalendarSubscriptionsPage() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Matches the sibling settings pages: a blank 200 tells the reader nothing.
  if (!shop) redirect("/");

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

  const copy: CalendarFeedCopy = {
    create: t("calendar.actions.create"),
    creating: t("calendar.actions.creating"),
    rotate: t("calendar.actions.rotate"),
    rotating: t("calendar.actions.rotating"),
    turnOff: t("calendar.actions.turnOff"),
    turningOff: t("calendar.actions.turningOff"),
    copy: t("calendar.actions.copy"),
    copied: t("calendar.actions.copied"),
    copyFailed: t("calendar.actions.copyFailed"),
    confirmRotate: t("calendar.actions.confirmRotate"),
    confirmTurnOff: t("calendar.actions.confirmTurnOff"),
    newLinkHeading: t("calendar.newLink.heading"),
    shownOnce: t("calendar.newLink.shownOnce"),
    webcalLabel: t("calendar.newLink.webcalLabel"),
    httpsLabel: t("calendar.newLink.httpsLabel"),
    webcalHint: t("calendar.newLink.webcalHint"),
    httpsHint: t("calendar.newLink.httpsHint"),
    rotateWarning: t("calendar.warning.rotate"),
    sharedWarning: t("calendar.warning.shared"),
    denied: t("calendar.notice.denied"),
    statusNone: t("calendar.status.none"),
    neverRead: t("calendar.status.neverRead"),
  };

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("calendar.eyebrow")}
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <Link
            href={`/shop/${session.user.shopSlug}/settings`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("settings.main.backToSettings")}
          </Link>
        }
      />

      <p className="mb-6 text-sm text-muted">{t("calendar.refreshNote")}</p>

      <div className="grid gap-4">
        {views.map((view) => (
          <CalendarFeedPanel
            key={view.scope}
            view={view}
            copy={copy}
            subscribed={feeds.some((feed) => feed.scope === view.scope)}
          />
        ))}
      </div>

      <p className="mt-6 text-xs text-muted">
        {t("calendar.coverage", { past: FEED_PAST_DAYS, future: FEED_FUTURE_DAYS })}
      </p>
    </main>
  );
}
