import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { listTripGearAssignments } from "@/db/gear";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

export const instant = true;

export const metadata: Metadata = {
  title: "Rental ticket — DiveDay",
};

/**
 * One diver's rental slip, for the counter to print and hand over.
 *
 * ADR 20260815-minimal-gear-register scoped this and the first slice
 * deliberately left it out; the departure-level packet on the prep page covers
 * what a crew needs at the boat, and this covers the other half — the person
 * walking away with three tagged units who will be asked, at the end of the
 * day, to bring exactly those back.
 *
 * **What it must not look like.** Not a waiver: one shop-wide waiver is an
 * invariant (CR-015) and a second signed-looking slip is the fastest way to
 * blur it, so there is no signature line and nothing to agree to. Not a
 * receipt: billing lives on orders, and printing a rental with no money on it
 * beside one that has money on it teaches a staffer to look for a total here.
 * What is left is the only thing a slip is for — *what you have, and when it
 * is due back* — which is why the page is a list of unit tags and one date.
 *
 * Read-only, no mutations, and ungated like the rest of the register (H-06,
 * amended on H-14's row 2026-08-20): handing gear over is day work.
 */
export default async function RentalTicketPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string; bookingId: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: rawTripId, bookingId: rawBookingId } = await params;
  // Two caller-controlled uuids, both narrowed before any read: an unparseable
  // literal raises in Postgres rather than missing, so without this a mistyped
  // URL is a 500 where this page's own notFound() belongs.
  const tripId = uuidParam(rawTripId);
  const bookingId = uuidParam(rawBookingId);
  if (!tripId || !bookingId) notFound();

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // Tenancy is the session's shop, never the slug. A trip belonging to another
  // shop — or a booking belonging to another trip — resolves to nothing here
  // rather than printing one shop's diver on another's paper.
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const divers = await listTripPrepDivers(db, shop.id, tripId);
  const diver = divers.find((row) => row.bookingId === bookingId);
  if (!diver) notFound();

  const assignments = (await listTripGearAssignments(db, shop.id, tripId)).get(bookingId) ?? [];
  // A slip with nothing on it is not a shorter slip, it is a wrong one — the
  // door on the prep page only appears once a unit is assigned, so arriving
  // here empty means the assignment was released in another tab.
  if (assignments.length === 0) notFound();

  const dueBack = assignments.reduce(
    (latest, assignment) => (assignment.reservedUntil > latest ? assignment.reservedUntil : latest),
    assignments[0]?.reservedUntil ?? "",
  );
  const backTo = `${shopPath(shopSlug, "trips", tripId, "prep")}#assignments-heading`;

  return (
    <div id="rental-ticket">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
            {t("gear.ticket.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{diver.fullName}</h1>
          <p className="mt-1 text-muted">
            {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
          <Link href={backTo} className={buttonClass({ variant: "ghost" })}>
            {t("gear.ticket.backToPrep")}
          </Link>
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </header>

      <section aria-labelledby="ticket-units-heading" className="mt-8">
        <h2 id="ticket-units-heading" className="text-lg font-semibold">
          {t("gear.ticket.unitsHeading")}
        </h2>
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-3 divide-y divide-border overflow-hidden",
          })}
        >
          {assignments.map((assignment) => (
            <li
              key={assignment.reservationId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
            >
              <span className="font-mono text-lg font-medium">{assignment.label}</span>
              <span className="text-muted">
                {gearItemKindLabel(t, assignment.kind)}
                {assignment.size ? ` · ${assignment.size}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-lg">
        {t("gear.ticket.dueBack", {
          date: formatCalendarDate(dueBack, locale),
        })}
      </p>
      <p className="mt-8 border-t border-border pt-4 text-sm text-muted">{shop.name}</p>
    </div>
  );
}
