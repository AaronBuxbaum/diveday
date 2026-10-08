import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The slip is a Server Component over three reads, so these read its source
 * rather than render it, the way `trips/[id]/page.composition.test.ts` reads
 * the departure's.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the rental slip's unit rows", () => {
  /**
   * **One column for the tags, so every unit's kind starts at one x** (K-505).
   * Each row was its own `flex-wrap` line, so the kind started wherever that
   * row's tag ended. The seed's three tags on this slip are all six monospace
   * characters and hid it; "Boots #1" is eight, and put its kind about 22px
   * right of the kind above it. A two-column grid sized by the widest tag,
   * with every row a subgrid of it, lines the kinds up whatever the tags say.
   */
  it("lay the tag and the kind on two columns every row shares", () => {
    const list = SOURCE.slice(SOURCE.indexOf("<ul"), SOURCE.indexOf("</ul>"));
    expect(list).toContain("grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3");
    const row = list.match(/<li[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(row.split(" ")).toEqual(
      expect.arrayContaining(["col-span-2", "grid", "grid-cols-subgrid", "items-baseline"]),
    );
    expect(row).not.toMatch(/(?:^|\s)(?:flex|flex-wrap|gap-x-\S+)(?:\s|$)/);
  });
});

describe("the rental slip's foot", () => {
  /**
   * Aaron, 2026-10-08 (ADR 20260815-minimal-gear-register, amended that day):
   * the slip ends with the shop's own rental terms and a "Received by" line,
   * the foot it shares with the counter ticket. A receipt for gear, never a
   * release (CR-015), and no money: billing lives on orders.
   */
  it("ends with the shared terms and received-by foot, and carries no money", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("<RentalTicketReceipt terms={shop.rentalTerms} t={t} />");
    expect(code).not.toMatch(/formatMoney|Cents\b|amount/i);
  });
});
