import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { ShopNotice } from "@/components/ShopPageHeader";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import { type GiftGiverView, giverGiftView } from "@/db/gifts";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import {
  formatDateTimeTz,
  formatMoneyCents,
  formatShortDate,
  formatTimeRangeTz,
} from "@/lib/format";
import { verifyGiftToken } from "@/lib/gift-links";
import type { ShopCurrency } from "@/lib/money";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { similarDepartures } from "@/lib/similar-departures";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("gift.metaTitle"),
    // A bearer page like every other: never indexed, and no structured data
    // (docs/engineering/capability-telemetry-runbook.md).
    robots: { index: false, follow: false },
  };
}

// `instant = true`: the token verify, the read and `requestLocale()` all sit
// inside this segment's `loading.tsx` boundary, so the frame paints without
// waiting on the request. Nothing here is cacheable or shared between bearers.
export const instant = true;

/** One fact, on the row grammar the thread already speaks. */
function GiftRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center border-t border-border py-3 text-base last:border-b">
      {children}
    </li>
  );
}

/**
 * **`/gift/[token]` — the giver's own page** (ADR 20260908-one-hand, decision 6,
 * lever W; owner's call (l)).
 *
 * A gift has two people, and this is the one who is not diving. What a giver
 * may know is four things — claimed, waiver signed, aboard, and the money — and
 * this page is written so that widening that is a deliberate act rather than an
 * accident: `giverGiftView` returns exactly those facts and `src/db/gifts.test.ts`
 * asserts its shape by key. The receiver's certification, their medical
 * answers, their address, their sizes, anything they later tell the shop: none
 * of it is read here, and none of it is reachable from here.
 *
 * **It reads, and does nothing else.** No form, no action, and — deliberately
 * — not even a re-mint of the receiver's claim link: the link is in the mail
 * the giver already has, and a page that minted a fresh bearer credential on
 * every GET would make holding *this* URL as good as holding that one, for the
 * whole window in which the seat can still change hands. A giver whose mail is
 * gone is a conversation with the shop, and the counter's own row is written
 * for exactly that morning.
 *
 * **The token is signed rather than stored, and that is what makes the page
 * work at all.** Claiming a seat revokes every `booking_capabilities` row on
 * the booking — correctly, because each was authority over the placeholder
 * identity — so a capability-backed giver link would die at the exact moment
 * the giver most wants it (`src/lib/gift-links.ts`).
 *
 * **On a blow-out it carries the money sentence and one door.** The refund goes
 * back to the card that paid, which is the giver's, because the capture being
 * reversed is the one their own checkout made; the door is the same seat on the
 * next matching departure.
 */
export default async function GiftPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  // Nothing has resolved yet, so there is no shop locale to fall back to —
  // negotiate from the reader's own device alone.
  const anonT = diverTranslator(await requestLocale());
  const bookingId = verifyGiftToken(token);
  if (!bookingId) return <Unavailable t={anonT} />;

  const db = await getDb();
  const now = nowDate();
  const view = await giverGiftView(db, bookingId, now);
  // One answer for a junk token, an expired one, a seat that was never a gift,
  // and a departure taken off the board: a bearer learns the same nothing from
  // all four.
  if (!view) return <Unavailable t={anonT} />;

  const locale = await requestLocale(view.defaultLocale);
  const t = diverTranslator(locale);
  const zone = view.timezone;
  const money = (cents: number) =>
    formatMoneyCents(cents, (view.payment?.currency ?? "USD") as ShopCurrency, locale);
  const paidCents = view.payment?.amountCents ?? null;
  const paid = paidCents !== null && paidCents > 0;
  const refunded = view.payment?.status === "refunded";

  return (
    <ThreadShell
      shopName={view.shopName}
      title={t("gift.heading", { name: view.receiverName })}
      meta={
        <p className="mt-1 text-base text-muted">
          {t("gift.when", {
            date: formatShortDate(view.startsAt, locale, zone),
            time: formatTimeRangeTz(view.startsAt, view.endsAt, locale, zone),
          })}
        </p>
      }
    >
      {/* The departure was called off. The money leads, because it is the one
          thing the giver cannot see for themselves, and it says only what the
          payment row shows: a reversal that has landed, or a debt the shop owes
          and will settle. */}
      {view.departureCancelled ? (
        <ShopNotice tone="warning" role="status" className="mt-6">
          <span className="font-semibold">{t("gift.cancelledHeading")}</span>{" "}
          {!paid
            ? t("gift.cancelledUnpaid")
            : refunded
              ? t("gift.cancelledRefunded", { amount: money(paidCents) })
              : t("gift.cancelledRefundOwed", {
                  shop: view.shopName,
                  amount: money(paidCents),
                })}
        </ShopNotice>
      ) : null}

      <SectionCard padding="lg" className="mt-8">
        {view.message ? (
          <p className="text-lg">{t("gift.line", { message: view.message })}</p>
        ) : null}
        <ul className={view.message ? "mt-4" : ""}>
          <GiftRow>
            {view.claimedAt
              ? t("gift.claimed", { when: formatDateTimeTz(view.claimedAt, locale, zone) })
              : t("gift.claimedPending")}
          </GiftRow>
          <GiftRow>
            {view.waiverSignedAt
              ? t("gift.waiverSigned", {
                  when: formatDateTimeTz(view.waiverSignedAt, locale, zone),
                })
              : t("gift.waiverPending")}
          </GiftRow>
          <GiftRow>
            {view.aboard
              ? t("gift.aboard", { when: formatDateTimeTz(view.startsAt, locale, zone) })
              : t("gift.aboardPending")}
          </GiftRow>
          <GiftRow>
            {paid
              ? t(refunded ? "gift.receiptRefunded" : "gift.receipt", { amount: money(paidCents) })
              : t("gift.receiptAtShop")}
          </GiftRow>
        </ul>
        {/* The one sentence this page owes its reader: where those three rows
            stop. A giver who can see part of somebody else's day should be told
            what the rest of it is not. */}
        <p className="mt-4 text-sm text-muted">
          {t("gift.privacyNote", { name: view.receiverName })}
        </p>
      </SectionCard>

      {view.departureCancelled ? <GiveAgain db={db} view={view} t={t} now={now} /> : null}
    </ThreadShell>
  );
}

/**
 * **The one door on a called-off departure**: give the same seat on the next
 * one. `?gift=1` opens that trip's form already on the gift, so the giver is
 * never asked to find the choice a second time.
 *
 * The next *matching* departure, through the same `similarDepartures` the trip
 * page offers a full boat — same course, else same site, soonest first, and
 * only departures a diver can actually get onto. When the board has nothing
 * that matches, the schedule is the honest door.
 */
async function GiveAgain({
  db,
  view,
  t,
  now,
}: {
  db: AppDb;
  view: GiftGiverView;
  t: DiverTranslator;
  now: Date;
}) {
  const board = (
    await pagedUpcomingTripsWithCounts(db, view.shopId, {
      now,
      limit: 50,
      hasSpace: true,
      publicOnly: true,
    })
  ).trips;
  const [next] = similarDepartures({
    full: { tripId: view.tripId, courseId: view.courseId, diveSiteId: view.diveSiteId },
    candidates: board.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      startsAt: candidate.startsAt,
      courseId: candidate.courseId,
      diveSiteId: candidate.diveSiteId,
    })),
    limit: 1,
  });
  const href = next
    ? `${publicTripPath(view.shopSlug, next.tripId)}?gift=1`
    : publicSchedulePath(view.shopSlug);
  return (
    <div className="mt-8">
      <Link href={href} className={buttonClass()}>
        {t("gift.giveAgain")}
      </Link>
    </div>
  );
}

/** The bare door: a token that resolves to nothing, naming nobody. */
function Unavailable({ t }: { t: DiverTranslator }) {
  return (
    <EntryDone
      glyph="expired"
      title={t("gift.unavailableHeading")}
      text={t("gift.unavailableBody")}
    />
  );
}
