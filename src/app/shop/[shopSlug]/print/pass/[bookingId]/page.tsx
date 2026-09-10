import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPassBooking } from "@/db/print-pass";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear, formatTime } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { passCodePayload, printSheetSpec, storefrontAddress } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
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
 * The pass (lever M) for a diver without a phone: where to be, when, on which
 * hull, what to bring, and a code the counter can read off paper exactly as it
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

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const spec = printSheetSpec("paper_pass");
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  const checkInAt = new Date(booking.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  const meetingPoint = [booking.meetingPointLabel, booking.meetingPointAddress]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");
  const where = [booking.boatName, meetingPoint].filter((part): part is string => Boolean(part));

  return (
    <SheetDocument
      shopSlug={shopSlug}
      paper={spec.paper}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("print.settings.title")}
      printLabel={t("print.settings.door")}
    >
      <PaperSheet
        paper={spec.paper}
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
        {where.length > 0 ? <p className="paper-sheet-muted text-xs">{where.join(" · ")}</p> : null}
        <p className="paper-sheet-muted text-xs">
          {t("print.sheet.pass.checkInFrom", {
            time: formatTime(checkInAt, locale, shop.timezone),
          })}
        </p>
        {shop.packingList.length > 0 ? (
          <p className="paper-sheet-muted mt-2 text-xs">
            {t("print.sheet.pass.bringHeading")}: {shop.packingList.join(", ")}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-3">
          <SheetCode
            value={passCodePayload(booking.bookingId)}
            label={t("print.sheet.pass.eyebrow")}
            className="w-[24mm] shrink-0"
          />
          <span className="paper-sheet-muted text-xs leading-snug">
            {t("print.sheet.pass.show")} {t("print.sheet.pass.code")}
          </span>
        </div>
      </PaperSheet>
    </SheetDocument>
  );
}
