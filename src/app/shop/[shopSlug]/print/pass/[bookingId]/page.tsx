import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPassBooking } from "@/db/print-pass";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { packsLogbook } from "@/lib/diver-planning";
import { formatDateWithYear, formatTime } from "@/lib/format";
import { meetingPointOfRows } from "@/lib/meeting-point";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { PAPER_PASS_PAPER, passCodePayload, storefrontAddress } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { PaperSheet, SheetMark } from "../../_components/PaperSheet";
import { SheetCode } from "../../_components/SheetCode";
import { SheetDocument } from "../../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Paper pass — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The paper pass** (A6, printed at the counter from one booking) — ADR
 * 20260908-one-hand, decision 6, lever X.
 *
 * The pass (lever M) for a diver without a phone: where to be (the meeting
 * point, its address, landmark and parking), when, on which hull, what to bring, and a code the counter can read off paper exactly as it
 * reads one off glass.
 *
 * **The code carries the booking's id and nothing else** (`passCodePayload`).
 * Not a URL, not a name, not the shop: a booking id is not a capability — the
 * counter resolves it inside the session's own shop — so a pass left on a boat
 * seat hands a finder nothing, and the code can never become a second, quieter
 * spelling of a waiver link.
 *
 * **And nothing about the diver but their name.** No readiness, no waiver
 * state, no medical answer, no money. This is a document that leaves the
 * building in a stranger's pocket.
 */
export default async function PaperPassPage({
  params,
}: {
  params: Promise<{ shopSlug: string; bookingId: string }>;
}) {
  const { shopSlug, bookingId: rawBookingId } = await params;
  // Narrowed before the read: an unparseable literal raises in Postgres rather
  // than missing, so without this a mistyped URL is a 500 where a 404 belongs.
  const bookingId = uuidParam(rawBookingId);
  if (!bookingId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
  const booking = await getPassBooking(db, shop.id, bookingId);
  if (!booking) notFound();

  // **Two languages on one page** (fifth-loop ideas, item 49): the paper is
  // the diver's, so it speaks the language they read, or the shop's when they
  // never said; the screen around it (back, print) is the staffer's.
  const readerLocale = await requestLocale(shop.defaultLocale);
  const readerT = staffTranslator(readerLocale);
  const locale = recipientLocale(booking.diverLocale, shop.defaultLocale);
  const t = staffTranslator(locale);
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  // The shop's own dock call, which is when a diver should *be there* — not
  // when a counter opens. The same figure the confirmation email states.
  const dockCallAt = new Date(booking.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  // Where to go, as the trip page and the confirmation say it (ux review
  // 2026-10-11, item 27): the departure's meeting point, or the shop itself,
  // with the landmark and the parking note a diver without a phone needs most.
  const where = meetingPointOfRows(shop, booking);
  // The shop's list, then the logbook when it suggests one (`packsLogbook`;
  // the pass reads no cards, so a try-dive's pass leaves it off).
  const bring = packsLogbook({
    shopSuggests: shop.packingLogbook,
    introCourseSession: booking.introCourse,
    holdsCertification: false,
  })
    ? [...shop.packingList, t("print.sheet.pass.logbook")]
    : shop.packingList;

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "trips", booking.tripId)}
      paper={PAPER_PASS_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={readerT("trips.tabs.divers")}
      printLabel={readerT("print.sheet.door")}
    >
      <PaperSheet
        paper={PAPER_PASS_PAPER}
        lang={locale === readerLocale ? undefined : locale}
        tone={{ band: theme.primary, bandInk: theme.primaryForeground }}
        band={
          <>
            <SheetMark name={shop.name} size="sm" />
            <span className="font-brand-display text-xs font-bold">{shop.name}</span>
          </>
        }
        foldLeft={t("print.sheet.printed", {
          date: formatDateWithYear(nowDate(), locale, shop.timezone),
        })}
        foldRight={storefrontAddress(shopSlug, publicAppUrl())}
      >
        <p className="paper-sheet-muted text-[0.625rem] font-bold tracking-[0.12em] uppercase">
          {t("print.sheet.pass.eyebrow")}
        </p>
        <h1 className="font-brand-display mt-1 text-xl leading-tight font-extrabold">
          {booking.tripTitle}
        </h1>
        <p className="font-brand-display text-xl leading-tight font-extrabold">
          {formatDateWithYear(booking.startsAt, locale, shop.timezone)} ·{" "}
          {formatTime(booking.startsAt, locale, shop.timezone)}
        </p>
        <p className="mt-3 text-sm font-semibold">{booking.diverName}</p>
        {booking.boatName ? <p className="paper-sheet-muted text-xs">{booking.boatName}</p> : null}
        <p className="paper-sheet-muted text-xs">
          {t("print.sheet.pass.beAtDock", {
            time: formatTime(dockCallAt, locale, shop.timezone),
          })}
        </p>
        <div className="mt-2 text-xs leading-snug">
          <p className="paper-sheet-muted text-[0.625rem] font-bold tracking-[0.12em] uppercase">
            {t("print.sheet.pass.whereHeading")}
          </p>
          <p className="font-semibold">{where.label}</p>
          {where.address ? <p>{where.address}</p> : null}
          {where.landmark ? (
            <p className="paper-sheet-muted">
              {t("print.sheet.pass.landmark", { landmark: where.landmark })}
            </p>
          ) : null}
          {where.parking ? (
            <p className="paper-sheet-muted">
              {t("print.sheet.pass.parking", { parking: where.parking })}
            </p>
          ) : null}
        </div>
        {bring.length > 0 ? (
          <p className="paper-sheet-muted mt-2 text-xs">
            {t("print.sheet.pass.bringHeading")}: {bring.join(", ")}
          </p>
        ) : null}
        {/* `gap-4`, 3.4mm at the print root: the code's quiet zone, four of
            its 0.8mm modules, overhangs its box (`SheetCode`) and must stay
            clear of the words beside it. */}
        <div className="mt-4 flex items-center gap-4">
          <SheetCode
            value={passCodePayload(booking.bookingId)}
            label={t("print.sheet.pass.eyebrow")}
            size={24}
            className="shrink-0"
          />
          <span className="paper-sheet-muted text-xs leading-snug">
            {t("print.sheet.pass.show")} {t("print.sheet.pass.code")}
          </span>
        </div>
      </PaperSheet>
    </SheetDocument>
  );
}
