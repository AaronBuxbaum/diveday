import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The counter-rental ticket is a Server Component over one read, so these
 * read its source rather than render it, as the trip slip's test does. The
 * slip itself is rendered in `RentalSlip.test.tsx`.
 */
const SOURCE = routeSource(import.meta.dirname, "page.tsx");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** The page's one reader (issue #2757): where the ticket's reads now live. */
const READER = readFileSync(join(process.cwd(), "src/db/counter-rental-ticket-page.ts"), "utf8");

describe("the counter-rental ticket", () => {
  /**
   * Aaron, 2026-10-08 (ADR 20260815-minimal-gear-register, amended that day):
   * the ticket ends with the shop's own terms and a "Received by" line, the
   * same foot as the trip slip — a receipt for gear, never a release (CR-015).
   * Since 2026-10-09 it also says what was charged, and that money is read
   * from the order the rental is linked to, never computed on the page.
   */
  it("ends with the shared terms and received-by foot, and reads money only from the order", () => {
    expect(CODE).toContain("<RentalSlip");
    expect(CODE).toContain("terms={shop.rentalTerms}");
    expect(READER).toContain("getOrder(db, shop.id, ticket.orderId)");
    expect(CODE).toContain("<RentalTicketPayment");
    expect(CODE).not.toMatch(/formatMoney|Cents\b|amount/i);
  });

  /**
   * Issue #2261, H-20261008-counter-rental-waiver-informs: the person's waiver is said on screen with the link to
   * send, never on the slip they carry away, and nothing on the ticket waits
   * on it.
   */
  it("says the person's waiver on screen only, with the send beside it", () => {
    const screen = CODE.indexOf("screen={");
    const line = CODE.slice(CODE.indexOf("<CounterRentalWaiverLine"), CODE.indexOf("<RentalSlip"));
    expect(screen).toBeGreaterThan(-1);
    expect(CODE.indexOf("<CounterRentalWaiverLine")).toBeGreaterThan(screen);
    expect(line).toContain("personId={ticket.personId}");
    // The send is a counter send from this ticket (issue #2346).
    expect(line).toContain("ticketId={ticket.ticketId}");
  });

  /**
   * **Paper is one face** (issue #2745): the slip is a sheet behind
   * `SheetDocument`, and the counter's acts sit above it on the screen alone,
   * so nothing on this page is hidden from paper by a class.
   */
  it("is a sheet with the counter's acts above it, and no screen-vs-print fork", () => {
    expect(CODE).toContain("<SheetDocument");
    const slip = CODE.indexOf("<RentalSlip");
    for (const act of ["<TankGasCorrections", "<GearReturnPane", "checkOutCounterRentalAction"]) {
      expect(CODE.indexOf(act), act).toBeGreaterThan(-1);
      expect(CODE.indexOf(act), act).toBeLessThan(slip);
    }
    // Reached from Rent out, not a Print: the dialog waits for the button.
    expect(CODE).toContain("autoPrint={false}");
    expect(CODE).not.toMatch(/print:|StaffPage|EyebrowWayUp|PrintButton/);
  });
});
