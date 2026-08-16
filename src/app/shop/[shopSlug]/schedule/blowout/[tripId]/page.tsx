import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { type BlowoutDiverState, getTripBlowout } from "@/db/blowouts";
import { getDb } from "@/db/client";
import type { PaymentStatus } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getTripRoster, getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { callBlowoutAction, resumeBlowoutAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where the shop segment's own `loading.tsx` is what
// paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Weather blow-out — DiveDay",
};

const NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  called: { tone: "success", key: "blowout.notices.called" },
  resumed: { tone: "success", key: "blowout.notices.resumed" },
  departed: { tone: "danger", key: "blowout.notices.departed" },
  error: { tone: "danger", key: "blowout.notices.error" },
};

const PAYMENT_KEY: Record<PaymentStatus, StaffMessageKey> = {
  unpaid: "divers.shared.paymentStatus.unpaid",
  deposit_paid: "divers.shared.paymentStatus.depositPaid",
  paid: "divers.shared.paymentStatus.paid",
  waived: "divers.shared.paymentStatus.waived",
  refunded: "divers.shared.paymentStatus.refunded",
};

const MESSAGE_BADGE: Record<
  BlowoutDiverState["messageStatus"],
  { tone: BadgeTone; key: StaffMessageKey }
> = {
  sent: { tone: "success", key: "blowout.record.messageSent" },
  queued: { tone: "warning", key: "blowout.record.messageQueued" },
  pending: { tone: "warning", key: "blowout.record.messagePending" },
  sending: { tone: "warning", key: "blowout.record.messageSending" },
  failed: { tone: "danger", key: "blowout.record.messageFailed" },
  no_email: { tone: "neutral", key: "blowout.record.messageNoEmail" },
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
  const [session, { shopSlug, tripId }, { notice }, db] = await Promise.all([
    requireStaffSession(),
    params,
    searchParams,
    getDb(),
  ]);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const [locale, trip, blowout] = await Promise.all([
    requestLocale(shop.defaultLocale),
    getTripWithBooked(db, shop.id, tripId),
    getTripBlowout(db, shop.id, tripId),
  ]);
  if (!trip) notFound();
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, NOTICES);
  const tripPath = shopPath(shopSlug, "trips", tripId);

  const header = (
    <ShopPageHeader
      eyebrow={t("blowout.eyebrow")}
      title={blowout ? t("blowout.record.title") : t("blowout.confirm.title")}
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
      actions={
        <Link href={tripPath} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("blowout.confirm.backToTrip")}
        </Link>
      }
    />
  );

  if (!blowout) {
    const departed = trip.startsAt <= nowDate();
    const roster = await getTripRoster(db, shop.id, tripId);
    return (
      <>
        <FlashParams params={["notice"]} />
        {header}
        <div className="mt-6">
          {banner ? (
            <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
          ) : null}
        </div>
        <SectionCard as="div" padding="lg" className="max-w-2xl">
          <p className="text-sm">{t("blowout.confirm.lead", { tripTitle: trip.title })}</p>
          <p className="mt-3 text-sm text-muted">{t("blowout.confirm.moneyNote")}</p>
          {roster.length === 0 ? (
            // Nested inside the confirm card, so no icon.
            <EmptyState icon={false} className="mt-5">
              <p className="text-sm text-muted">{t("blowout.confirm.noDivers")}</p>
            </EmptyState>
          ) : (
            <div className="mt-5">
              <h2 className="text-sm font-semibold">
                {t("blowout.confirm.diversHeading", { count: roster.length })}
              </h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {roster.map((row) => (
                  <li key={row.booking.id} className="flex flex-wrap items-center gap-2">
                    <span>{row.person.fullName}</span>
                    {row.person.email ? null : (
                      <Badge tone="neutral" size="sm">
                        {t("blowout.confirm.noEmail")}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {departed ? (
            <p className="mt-6 text-sm font-medium text-danger">{t("blowout.confirm.departed")}</p>
          ) : (
            <form action={callBlowoutAction.bind(null, shopSlug, tripId)} className="mt-6">
              <SubmitButton
                pendingLabel={t("blowout.confirm.calling")}
                className={buttonClass({ variant: "danger" })}
              >
                {t("blowout.confirm.button")}
              </SubmitButton>
            </form>
          )}
        </SectionCard>
      </>
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
    <>
      <FlashParams params={["notice"]} />
      {header}
      <div className="mt-6">
        {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <ShopStat
          label={t("blowout.record.notified")}
          value={`${sent}/${divers.length}`}
          detail={t("blowout.record.notifiedDetail", { sent, total: divers.length })}
          tone={sent === divers.length ? "success" : "warning"}
        />
        <ShopStat
          label={t("blowout.record.rebooked")}
          value={rebooked}
          detail={t("blowout.record.rebookedDetail")}
          tone={rebooked > 0 ? "success" : "default"}
        />
        <ShopStat
          label={t("blowout.record.unresolved")}
          value={unresolved}
          detail={
            unresolved === 0
              ? t("blowout.record.allResolvedDetail")
              : t("blowout.record.unresolvedDetail")
          }
          tone={unresolved === 0 ? "success" : "warning"}
        />
      </div>

      {divers.length === 0 ? (
        <EmptyState className="mt-6">
          <p className="mx-auto max-w-md text-sm text-muted">{t("blowout.record.empty")}</p>
        </EmptyState>
      ) : (
        <Table shellClassName="mt-6">
          <THead>
            <Th>{t("blowout.record.table.diver")}</Th>
            <Th>{t("blowout.record.table.message")}</Th>
            <Th hideBelow="sm">{t("blowout.record.table.money")}</Th>
            <Th hideBelow="md">{t("blowout.record.table.offers")}</Th>
            <Th>{t("blowout.record.table.status")}</Th>
          </THead>
          <TBody>
            {divers.map((diver) => {
              const message = MESSAGE_BADGE[diver.messageStatus];
              return (
                <tr key={diver.id}>
                  <Td>
                    <Link
                      href={shopPath(shopSlug, "divers", diver.personId)}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {diver.fullName}
                    </Link>
                    {diver.messageStatus === "no_email" && diver.phone ? (
                      <div className="text-xs text-muted">
                        {t("blowout.record.callThem", { phone: diver.phone })}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={message.tone} size="sm">
                      {t(message.key)}
                    </Badge>
                  </Td>
                  <Td muted hideBelow="sm">
                    {diver.paymentStatus
                      ? t(PAYMENT_KEY[diver.paymentStatus])
                      : t("blowout.record.noPayment")}
                  </Td>
                  <Td muted hideBelow="md">
                    {diver.offeredTrips.length === 0
                      ? t("blowout.record.noOffers")
                      : diver.offeredTrips
                          .map(
                            (offer) =>
                              `${offer.title} — ${formatShortDate(offer.startsAt, locale, shop.timezone)}`,
                          )
                          .join(" · ")}
                  </Td>
                  <Td>
                    {diver.rebooked ? (
                      <Badge tone="success" size="sm">
                        {t("blowout.record.rebookedBadge")}
                      </Badge>
                    ) : (
                      <Badge tone="warning" size="sm">
                        {t("blowout.record.unresolvedBadge")}
                      </Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
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
    </>
  );
}
