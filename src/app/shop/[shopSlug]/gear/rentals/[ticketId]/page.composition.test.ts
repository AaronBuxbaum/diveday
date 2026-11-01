import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The counter-rental ticket is a Server Component over one read, so these
 * read its source rather than render it, as the trip slip's test does.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the counter-rental ticket", () => {
  /**
   * Aaron, 2026-10-08 (ADR 20260815-minimal-gear-register, amended that day):
   * the ticket ends with the shop's own terms and a "Received by" line, the
   * same foot as the trip slip — a receipt for gear, never a release (CR-015).
   * Since 2026-10-09 it also says what was charged, and that money is read
   * from the order the rental is linked to, never computed on the page.
   */
  it("ends with the shared terms and received-by foot, and reads money only from the order", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("<RentalTicketReceipt terms={shop.rentalTerms} t={t} />");
    expect(code).toContain("getOrder(db, shop.id, ticket.orderId)");
    expect(code).toContain("<RentalTicketPayment");
    expect(code).not.toMatch(/formatMoney|Cents\b|amount/i);
  });

  /**
   * Issue #2261, H-20261008-counter-rental-waiver-informs: the person's waiver is said on screen with the link to
   * send, never on the slip they carry away, and nothing on the ticket waits
   * on it.
   */
  it("says the person's waiver on screen only, with the send beside it", () => {
    const line = SOURCE.slice(
      SOURCE.indexOf("<CounterRentalWaiverLine"),
      SOURCE.indexOf('aria-labelledby="ticket-units-heading"'),
    );
    expect(line).toContain("print:hidden");
    expect(line).toContain("personId={ticket.personId}");
    // The send is a counter send from this ticket (issue #2346).
    expect(line).toContain("ticketId={ticket.ticketId}");
  });
});
