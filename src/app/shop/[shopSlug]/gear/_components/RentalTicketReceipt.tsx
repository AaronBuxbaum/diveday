import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The foot of every rental ticket**, shared by the trip slip
 * (`trips/[id]/prep/ticket/[bookingId]`) and the counter ticket
 * (`gear/rentals/[ticketId]`): the shop's own rental terms when it has written
 * any, then "Received by", printed-name and date lines (Aaron, 2026-10-08; ADR
 * 20260815-minimal-gear-register, amended 2026-10-08).
 *
 * **A receipt for gear, never a waiver.** The signature says the person took
 * these units and agrees to nothing DiveDay wrote. The terms are the shop's
 * words verbatim (`shops.rental_terms`), never a default of ours, and the one
 * shop-wide waiver stays the only liability page (CR-015). No money either:
 * billing lives on the order. Drawn inside the ticket's sheet (`RentalSlip`),
 * so the counter sees on screen what will print.
 */
export function RentalTicketReceipt({ terms, t }: { terms: string | null; t: StaffTranslator }) {
  return (
    <section aria-labelledby={terms ? "ticket-terms-heading" : undefined} className="mt-8">
      {terms ? (
        <>
          <h2 id="ticket-terms-heading" className={SECTION_TITLE_CLASS}>
            {t("gear.ticket.termsHeading")}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm" data-rental-terms>
            {terms}
          </p>
        </>
      ) : null}
      {/* Three blanks to write on, the widest for the signature. One row
          whatever the screen width: the ticket is a sheet of paper (issue
          #2745), as wide on a phone as on the printer, never a reflowed page. */}
      <div className="mt-10 grid grid-cols-[2fr_2fr_1fr] gap-8">
        <WriteOnLine label={t("gear.ticket.receivedBy")} />
        <WriteOnLine label={t("gear.ticket.printedName")} />
        <WriteOnLine label={t("gear.ticket.date")} />
      </div>
    </section>
  );
}

function WriteOnLine({ label }: { label: string }) {
  return (
    <div>
      <div aria-hidden="true" className="h-10 border-b border-foreground" />
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}
