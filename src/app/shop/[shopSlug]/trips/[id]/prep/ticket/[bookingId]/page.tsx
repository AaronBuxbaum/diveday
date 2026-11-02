import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { EYEBROW_CLASS, EyebrowBackLink } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { listTripGearAssignments } from "@/db/gear";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getTripWithBooked } from "@/db/trips";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { RentalTicketReceipt } from "../../../../../gear/_components/RentalTicketReceipt";

export const instant = true;

export const metadata: Metadata = {
  title: "Rental ticket — DiveDay",
};

/**
 * One diver's rental slip: what they have and when it is due back, for the
 * counter to print and hand over (ADR 20260815-minimal-gear-register).
 *
 * The trip slip is read-only and carries no bill: a list of unit tags and one
 * date, then the shared foot (`RentalTicketReceipt`, which owns the terms,
 * signature and gear-receipt-not-waiver contract). Billing lives on orders, so
 * a counter ticket shows money and this one never does. Ungated beyond staff
 * like the rest of the register (H-06, amended on H-14's row 2026-08-20):
 * handing gear over is day work.
 */
export default async function RentalTicketPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string; bookingId: string }>;
}) {
  const { shopSlug, id: rawTripId, bookingId: rawBookingId } = await params;
  // Both uuids are narrowed before any read: an unparseable literal raises in
  // Postgres, so a mistyped URL would be a 500 rather than this page's 404.
  const tripId = uuidParam(rawTripId);
  const bookingId = uuidParam(rawBookingId);
  if (!tripId || !bookingId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
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
  // A slip with nothing on it is a wrong one: the prep page's door only appears
  // once a unit is assigned, so empty means it was released in another tab.
  if (assignments.length === 0) notFound();

  const dueBack = assignments.reduce(
    (latest, assignment) => (assignment.reservedUntil > latest ? assignment.reservedUntil : latest),
    assignments[0]?.reservedUntil ?? "",
  );
  // Back to where the counter tapped in: the departure's assignments section
  // (dive-domain review 20260920).
  const backTo = `${shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}`;

  return (
    <div id="rental-ticket">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          {/* On screen the eyebrow is the way back to the packing list (principle
              10, issue #823); on paper it names the slip, which has no
              navigation. */}
          <EyebrowBackLink href={backTo} className="print:hidden">
            {t("trips.surfaces.trip")}
          </EyebrowBackLink>
          <p className={`hidden ${EYEBROW_CLASS} print:block`}>{t("gear.ticket.eyebrow")}</p>
          <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{diver.fullName}</h1>
          <p className="mt-1 text-muted">
            {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </header>

      <section aria-labelledby="ticket-units-heading" className="mt-8">
        <h2 id="ticket-units-heading" className={SECTION_TITLE_CLASS}>
          {t("gear.ticket.unitsHeading")}
        </h2>
        {/* One column for the tags, so every kind starts at one x (K-505): two
            columns sized by the widest tag, each row a subgrid. */}
        <ul
          className={sectionCardClass({
            padding: "none",
            className:
              "mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border overflow-hidden",
          })}
        >
          {assignments.map((assignment) => (
            <li
              key={assignment.reservationId}
              className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3 sm:px-5"
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
      <RentalTicketReceipt terms={shop.rentalTerms} t={t} />
      <p className="mt-8 border-t border-border pt-4 text-sm text-muted">{shop.name}</p>
    </div>
  );
}
