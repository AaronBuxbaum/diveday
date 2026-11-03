import type { ReactNode } from "react";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { ShopSheet } from "../../print/_components/ShopSheet";
import { RentalTicketReceipt } from "./RentalTicketReceipt";

/** One unit as the slip prints it: its tag, then what it is. */
export type RentalSlipUnit = { id: string; label: string; detail: string };

/**
 * **A rental ticket on the shop's paper** (issue #2745), shared by the trip
 * slip (`trips/[id]/prep?diver=`) and the counter ticket
 * (`gear/rentals/[ticketId]`): who has the gear, the unit tags, the one date
 * that matters, then the shared foot (`RentalTicketReceipt`).
 *
 * The page a counter reviews is the page the person walks off with, so
 * nothing here is a control: the counter's acts sit above the sheet, on the
 * screen alone (`SheetDocument`'s `screen`).
 */
export function RentalSlip({
  shop,
  shopSlug,
  printed,
  holder,
  line,
  units,
  dueBack,
  terms,
  t,
  foot,
  children,
}: {
  shop: { name: string; brandColor: string | null };
  shopSlug: string;
  printed: string;
  /** Who has the gear: the sheet's heading. */
  holder: string;
  /** The rental's dates, or the departure it goes out on. */
  line: string;
  units: readonly RentalSlipUnit[];
  /** "Back by …". */
  dueBack: string;
  /** The shop's own rental terms, verbatim. */
  terms: string | null;
  t: StaffTranslator;
  /** Who to call, under the signature lines. */
  foot?: ReactNode;
  /** What the slip says between the units and the date: a counter rental's gas and bill. */
  children?: ReactNode;
}) {
  return (
    <ShopSheet
      paper={PACKET_PAPER}
      shop={shop}
      shopSlug={shopSlug}
      name={t("gear.ticket.eyebrow")}
      printed={printed}
    >
      <div id="rental-ticket">
        <header className="border-b border-border pb-6">
          <h1 className={SHELL_TITLE_CLASS}>{holder}</h1>
          <p className="mt-1 text-muted">{line}</p>
        </header>

        <section aria-labelledby="ticket-units-heading" className="mt-8">
          <h2 id="ticket-units-heading" className={SECTION_TITLE_CLASS}>
            {t("gear.ticket.unitsHeading")}
          </h2>
          {/* One column for the tags, so every kind starts at one x (K-505): two
              columns sized by the widest tag, each row a subgrid. */}
          <ul className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border rounded-panel border border-border">
            {units.map((unit) => (
              <li
                key={unit.id}
                className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3"
              >
                <span className="font-mono text-lg font-medium">{unit.label}</span>
                <span className="text-muted">{unit.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {children}

        <p className="mt-6 text-lg">{dueBack}</p>
        <RentalTicketReceipt terms={terms} t={t} />
        {foot ? (
          <p className="mt-8 border-t border-border pt-4 text-sm text-muted">{foot}</p>
        ) : null}
      </div>
    </ShopSheet>
  );
}
