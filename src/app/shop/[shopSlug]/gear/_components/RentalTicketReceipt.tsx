import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The foot of every rental ticket**: the shop's own rental terms when it has
 * written any, then a "Received by" line, a printed-name line and a date line
 * (Aaron, 2026-10-08; ADR 20260815-minimal-gear-register, amended 2026-10-08).
 *
 * Both tickets render it — the trip slip at `trips/[id]/prep/ticket/[bookingId]`
 * and the counter ticket at `gear/rentals/[ticketId]` — so the two papers a
 * diver walks off with end the same way.
 *
 * **A receipt for gear, never a waiver.** The signature says the person took
 * these units; it agrees to nothing DiveDay wrote. The terms are the shop's
 * words verbatim (`shops.rental_terms`), never a default of ours, and the one
 * shop-wide waiver stays the only liability page (CR-015). No money either:
 * billing lives on the order.
 *
 * On screen as well as on paper, so the counter sees what will print.
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
      {/* Three blanks to write on, the widest for the signature. They stay on
          one row on paper whatever the screen width, because a printed ticket
          is a page, not a phone. */}
      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-[2fr_2fr_1fr] print:grid-cols-[2fr_2fr_1fr]">
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
