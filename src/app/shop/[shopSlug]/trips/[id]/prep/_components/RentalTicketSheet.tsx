import { notFound } from "next/navigation";
import { requireShopSurface } from "@/features/session";
import { getRentalTicket } from "@/features/trip-prep";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { RentalSlip } from "../../../../gear/_components/RentalSlip";
import { SheetDocument } from "../../../../print/_components/SheetDocument";
import { sheetPrinted } from "../../../../print/_components/ShopSheet";

/**
 * One diver's rental slip, the packing list printed for one booking (`?diver=<bookingId>`): what they have and when it is due back, for the
 * counter to print and hand over (ADR 20260815-minimal-gear-register), as one
 * sheet of the shop's paper (`RentalSlip`, issue #2745).
 *
 * The trip slip is read-only and carries no bill: a list of unit tags and one
 * date, then the shared foot (`RentalTicketReceipt`, which owns the terms,
 * signature and gear-receipt-not-waiver contract). Billing lives on orders, so
 * a counter ticket shows money and this one never does. Ungated beyond staff
 * like the rest of the register (H-20260724-initial-gear-policy-sizing, amended on H-20260724-staff-role-reach's row 2026-08-20):
 * handing gear over is day work.
 */
export async function RentalTicketSheet({
  shopSlug,
  tripId,
  bookingId,
}: {
  shopSlug: string;
  tripId: string;
  bookingId: string;
}) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // Tenancy is the session's shop, never the slug. A trip belonging to another
  // shop — or a booking belonging to another trip — resolves to nothing here
  // rather than printing one shop's diver on another's paper. A slip with
  // nothing on it is a wrong one: the prep page's door only appears once a unit
  // is assigned, so empty means it was released in another tab.
  const ticket = await getRentalTicket(db, shop.id, tripId, bookingId);
  if (!ticket) notFound();
  const { trip, diver, assignments } = ticket;

  const dueBack = assignments.reduce(
    (latest, assignment) => (assignment.reservedUntil > latest ? assignment.reservedUntil : latest),
    assignments[0]?.reservedUntil ?? "",
  );
  return (
    <SheetDocument
      backHref={`${shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}`}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.tabs.gear")}
      printLabel={t("print.sheet.door")}
      // The packing list's door says "Rental ticket", not Print.
      autoPrint={false}
    >
      <RentalSlip
        shop={shop}
        shopSlug={shopSlug}
        printed={sheetPrinted(t, nowDate(), locale, shop.timezone, session.user.name)}
        holder={diver.fullName}
        line={`${trip.title} · ${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}`}
        units={assignments.map((assignment) => ({
          id: assignment.reservationId,
          label: assignment.label,
          detail: [gearItemKindLabel(t, assignment.kind), assignment.size]
            .filter(Boolean)
            .join(" · "),
        }))}
        dueBack={t("gear.ticket.dueBack", { date: formatCalendarDate(dueBack, locale) })}
        terms={shop.rentalTerms}
        t={t}
      />
    </SheetDocument>
  );
}
