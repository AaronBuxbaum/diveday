import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { canPersonCallDayBlowout, canPersonRefund } from "@/db/authz";
import { getTripRoster, getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { BlowoutConfirmation } from "./_components/BlowoutConfirmation";
import { HeldRefundsCard } from "./_components/HeldRefundsCard";
import { RecoveryGroups } from "./_components/RecoveryGroups";
import { blowoutTitleKey, readBlowout } from "./_lib/title";
import { callBlowoutAction, releaseBlowoutRefundsAction, resumeBlowoutAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

/**
 * Runtime metadata on an instant route. It reads the record only behind
 * `requireShopSurface`, as the page does: a title read before the tenant gate
 * would tell a stranger whether a guessed departure was called off (the lesson
 * of issue 1569). The page's own request reads keep the route dynamic, so the
 * title streams with the body and the static shell still paints first.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
}): Promise<Metadata> {
  const { shopSlug, tripId } = await params;
  if (!uuidParam(tripId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const [locale, blowout] = await Promise.all([
    requestLocale(shop.defaultLocale),
    readBlowout(db, shop.id, tripId),
  ]);
  return { title: `${staffTranslator(locale)(blowoutTitleKey(blowout))} — DiveDay` };
}

const NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  called: { tone: "success", key: "blowout.notices.called" },
  resumed: { tone: "success", key: "blowout.notices.resumed" },
  departed: { tone: "danger", key: "blowout.notices.departed" },
  error: { tone: "danger", key: "blowout.notices.error" },
  "refunds-released": { tone: "success", key: "blowout.notices.refundsReleased" },
  "refund-not-authorized": { tone: "danger", key: "blowout.notices.refundNotAuthorized" },
};

/**
 * The blow-out page, in one of two modes on the same URL. Before the call it
 * is the confirmation — the one deliberate step between the captain's word
 * and cancelling real bookings (guardrail: one tap, one confirm, never
 * zero). After the call it is the cascade record: who was messaged, who has
 * rebooked, who is still unresolved — the surface the blow-out morning is
 * worked from until that last column empties.
 */
export default async function BlowoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ shopSlug, tripId }, { notice }] = await Promise.all([params, searchParams]);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const [locale, trip, blowout, canCallDay, mayRefund] = await Promise.all([
    requestLocale(shop.defaultLocale),
    getTripWithBooked(db, shop.id, tripId),
    readBlowout(db, shop.id, tripId),
    canPersonCallDayBlowout(db, shop.id, session.user.personId),
    canPersonRefund(db, shop.id, session.user.personId),
  ]);
  if (!trip) notFound();
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, NOTICES);
  const tripPath = shopPath(shopSlug, "trips", tripId);

  const header = (
    <ShopPageHeader
      // The way up is the departure this is about, in the word its own tab
      // uses — the page used to spend its eyebrow on a second copy of its own
      // name ("Weather blow-out", above an `<h1>` already reading "Call a
      // blow-out?") and put the only link back to the trip in the actions slot
      // as a secondary button, where it competed with the one act on the page
      // (principle 10, issue #823).
      eyebrow={t("trips.surfaces.trip")}
      eyebrowHref={tripPath}
      title={t(blowoutTitleKey(blowout))}
      meta={
        <div className="flex flex-col gap-1 text-sm text-muted">
          <span className="font-medium text-foreground">{trip.title}</span>
          <span>
            {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
          </span>
          {blowout ? (
            <span>
              {t("blowout.record.calledBy", {
                name: blowout.calledByName ?? "—",
                when: formatDateTimeTz(blowout.calledAt, locale, shop.timezone),
              })}
            </span>
          ) : null}
        </div>
      }
    />
  );

  if (!blowout) {
    const departed = trip.startsAt <= nowDate();
    const roster = await getTripRoster(db, shop.id, tripId);
    return (
      <BlowoutConfirmation
        header={header}
        notice={
          banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null
        }
        trip={trip}
        departed={departed}
        mayRefund={mayRefund}
        dayHref={
          !departed && canCallDay
            ? shopPath(
                shopSlug,
                "schedule",
                "blowout",
                "day",
                calendarDateInTimezone(trip.startsAt, shop.timezone),
              )
            : null
        }
        roster={roster}
        call={callBlowoutAction.bind(null, shopSlug, tripId)}
        t={t}
      />
    );
  }

  const divers = blowout.divers;
  const sent = divers.filter((diver) => diver.messageStatus === "sent").length;
  const rebooked = divers.filter((diver) => diver.rebooked).length;
  const unresolved = divers.length - rebooked;
  // `sending` is normally transient, but a crashed pass can strand it — the
  // retry control reclaims those rows too (see resumeTripBlowout).
  const retryable = divers.some(
    (diver) =>
      diver.messageStatus === "failed" ||
      diver.messageStatus === "pending" ||
      diver.messageStatus === "sending",
  );

  return (
    <StaffPage width="full">
      <FlashParams params={["notice"]} />
      {header}
      <div className="mt-6">
        {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}
      </div>
      <HeldRefundsCard
        count={divers.filter((diver) => isCapturedPaymentStatus(diver.paymentStatus)).length}
        mayRefund={mayRefund}
        releaseAction={releaseBlowoutRefundsAction.bind(null, shopSlug, tripId)}
        t={t}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <ShopStat
          label={t("blowout.record.notified")}
          value={`${sent}/${divers.length}`}
          tone={sent === divers.length ? "success" : "warning"}
        />
        <ShopStat
          label={t("blowout.record.rebooked")}
          value={rebooked}
          detail={t("blowout.record.rebookedDetail")}
          tone={rebooked > 0 ? "success" : "default"}
        />
        <a
          href={unresolved > 0 ? "#unresolved-recovery" : "#rebooked-recovery"}
          className="rounded-lg"
        >
          <ShopStat
            label={t("blowout.record.unresolved")}
            value={unresolved}
            detail={
              unresolved === 0
                ? t("blowout.record.allResolvedDetail")
                : t("blowout.record.unresolvedDetail")
            }
            tone={unresolved === 0 ? "success" : "warning"}
          />{" "}
        </a>
      </div>

      {divers.length === 0 ? (
        <EmptyState title={t("blowout.record.empty")} className="mt-6" />
      ) : (
        <RecoveryGroups
          divers={divers}
          shopSlug={shopSlug}
          locale={locale}
          timezone={shop.timezone}
          t={t}
        />
      )}

      {retryable ? (
        <form action={resumeBlowoutAction.bind(null, shopSlug, tripId)} className="mt-6">
          <SubmitButton
            pendingLabel={t("blowout.record.resending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("blowout.record.resend")}
          </SubmitButton>
        </form>
      ) : null}
    </StaffPage>
  );
}
