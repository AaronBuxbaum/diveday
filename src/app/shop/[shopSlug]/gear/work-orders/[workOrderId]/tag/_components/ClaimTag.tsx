import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** One piece left with the shop: what it is, then its make and serial. */
export type ClaimTagPiece = {
  id: string;
  name: string;
  detail: string;
  /** The register's own tag rather than a kind of gear: set in mono, as the tag is printed. */
  tag?: boolean;
};

/**
 * **What the claim tag says** (ADR 20261008-gear-work-orders), inside the
 * shop's sheet: the ticket's number, what we have, what you told us, and when
 * to come back. Pure: the page reads, this prints, and nothing here is a
 * control.
 */
export function ClaimTag({
  t,
  subject,
  number,
  receivedOn,
  pieces,
  problem,
  promised,
  phone,
}: {
  t: StaffTranslator;
  /** Whose gear it is, or the unit's tag when nobody is named. */
  subject: string;
  number: number;
  receivedOn: string;
  pieces: readonly ClaimTagPiece[];
  problem: string;
  /** The promised date, formatted, or nothing when none was promised. */
  promised: string | null;
  phone: string | null;
}) {
  return (
    <div id="work-order-tag">
      <header className="border-b border-border pb-6">
        <h1 className={SHELL_TITLE_CLASS}>{subject}</h1>
        <p className="mt-1 text-muted">
          {/* The ticket number is what the diver reads down the phone, so it
              leads the line. */}
          <span className="font-medium text-foreground tabular-nums">
            {t("workOrders.number", { number })}
          </span>
          {" · "}
          {t("workOrders.detail.receivedOn", { date: receivedOn })}
        </p>
      </header>

      <section aria-labelledby="claim-tag-pieces-heading" className="mt-8">
        <h2 id="claim-tag-pieces-heading" className={SECTION_TITLE_CLASS}>
          {t("workOrders.tag.piecesHeading")}
        </h2>
        <ul className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border rounded-panel border border-border">
          {pieces.map((piece) => (
            <li
              key={piece.id}
              className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3"
            >
              <span className={`font-medium text-lg ${piece.tag ? "font-mono" : ""}`.trim()}>
                {piece.name}
              </span>
              <span className="text-muted">{piece.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="claim-tag-problem-heading" className="mt-8">
        <h2 id="claim-tag-problem-heading" className={SECTION_TITLE_CLASS}>
          {t("workOrders.tag.problemHeading")}
        </h2>
        <p className="mt-3 whitespace-pre-line">{problem}</p>
      </section>

      {promised ? (
        <p className="mt-6 text-lg">{t("workOrders.tag.promised", { date: promised })}</p>
      ) : null}
      {/* The shop's own name is on the band; the foot is the number to call. */}
      {phone ? (
        <p className="mt-8 border-t border-border pt-4 text-muted text-sm">
          {t("workOrders.tag.phone", { phone })}
        </p>
      ) : null}
    </div>
  );
}
