// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import RentalTicketLoading from "./loading";

afterEach(cleanup);

/**
 * The slip is a Server Component over three reads, so its header row is read
 * from its source, the way `trips/[id]/page.composition.test.ts` reads the
 * departure's.
 */
const PAGE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const PAGE_HEADER = PAGE.match(/<header className="([^"]+)"/)?.[1];

/**
 * **The slip's skeleton has the slip's header row** (K-282). It drew the name
 * block alone, while the page's header is a wrapping row that puts the 48px
 * Print button beside the name on a desk and under it on a phone: at 390 the
 * header's rule dropped 84px when the slip arrived, and the unit list with it.
 */
describe("the rental ticket's skeleton", () => {
  it("is the page's header row, with the print button's bar in it", () => {
    const header = render(<RentalTicketLoading />).container.firstElementChild?.firstElementChild;
    expect(PAGE_HEADER).toMatch(/\bflex-wrap\b/);
    expect(header?.className).toBe(PAGE_HEADER);
    const [text, printButton] = Array.from(header?.children ?? []);
    expect(text.children.length).toBeGreaterThan(0);
    // `PrintButton` is `buttonClass`'s default size: a 48px box.
    expect(buttonClass({ variant: "secondary" }).split(" ")).toContain("min-h-12");
    expect(printButton).toHaveClass("h-12", "rounded-lg");
  });

  it("spaces the name block as the page does: eyebrow, then the name and the trip line 4px apart", () => {
    const header = render(<RentalTicketLoading />).container.firstElementChild?.firstElementChild;
    const [eyebrow, name, tripLine] = Array.from(header?.firstElementChild?.children ?? []);
    expect(eyebrow).toHaveClass("h-4");
    expect(PAGE).toMatch(/<h1 className=\{`mt-1 \$\{SHELL_TITLE_CLASS\}`\}>/);
    expect(name).toHaveClass("mt-1", "h-lh", ...SHELL_TITLE_CLASS.split(" "));
    expect(PAGE).toContain('<p className="mt-1 text-muted">');
    // The trip line: two 24px lines on a phone, one from `sm`.
    expect(tripLine).toHaveClass("mt-1");
    expect(tripLine.children).toHaveLength(2);
    for (const line of Array.from(tripLine.children)) expect(line).toHaveClass("h-6");
    expect(tripLine.children[1]).toHaveClass("sm:hidden");
  });

  it("stands in for the list's heading and the due-back line at their own line boxes", () => {
    const body = render(<RentalTicketLoading />).container.firstElementChild;
    const [, heading, , dueBack] = Array.from(body?.children ?? []);
    expect(heading).toHaveClass("mt-8", "h-lh", ...SECTION_TITLE_CLASS.split(" "));
    expect(PAGE).toContain('<p className="mt-6 text-lg">');
    expect(dueBack).toHaveClass("mt-6", "h-lh", "text-lg");
  });
});
