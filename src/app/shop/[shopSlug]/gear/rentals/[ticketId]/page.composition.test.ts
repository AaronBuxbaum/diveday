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
   * The trip slip's deliberate absences (ADR 20260815-minimal-gear-register,
   * amendment 2026-10-08): no signature line, because the one shop-wide waiver
   * is the only signed page (CR-015), and no money, because billing lives on
   * the order the ticket links to.
   */
  it("carries no signature line and no money", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/signature|formatMoney|Cents\b|amount/i);
  });

  it("hides every act and the order link from the paper", () => {
    const header = SOURCE.slice(SOURCE.indexOf("<header"), SOURCE.indexOf("</header>"));
    expect(header).toMatch(/flex shrink-0 flex-wrap items-center gap-3 print:hidden/);
    expect(header.indexOf("counterRentals.ticket.order")).toBeGreaterThan(
      header.indexOf("gap-3 print:hidden"),
    );
    const acts = SOURCE.slice(SOURCE.indexOf("onWall.length > 0 || out.length > 0"));
    expect(acts).toMatch(/<section className="mt-6 flex flex-col gap-4 print:hidden">/);
  });

  it("lays the tag and the kind on columns every row shares, as the slip does (K-505)", () => {
    const list = SOURCE.slice(SOURCE.indexOf("<ul"), SOURCE.indexOf("</ul>"));
    expect(list).toContain("grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3");
    expect(list).toContain("grid-cols-subgrid");
  });

  it("prints the shop's phone in the footer, the number the person calls", () => {
    const footer = SOURCE.slice(SOURCE.lastIndexOf("border-t border-border pt-4"));
    expect(footer).toContain("shop.contactPhone");
  });

  it("asks the dives on the return, optional, inside the return's own form", () => {
    const pane = SOURCE.slice(
      SOURCE.indexOf("<GearReturnPane"),
      SOURCE.indexOf("</GearReturnPane>"),
    );
    expect(pane).toContain('name="dives"');
    expect(pane).not.toMatch(/name="dives"[^>]*required/);
  });

  it("does not call a flagged return back on the wall", () => {
    expect(SOURCE).toContain('"returned-flagged"');
  });
});
