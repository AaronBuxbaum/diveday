// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";

// The demo door is a Server Action; rendering the pair needs only its
// reference, not the session and database behind it.
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));

const { ClosingCta, GuideHero, SourcesFootnote } = await import("./guide");

afterEach(cleanup);

const TAP_TARGET = tapTargetLinkClass.split(" ");

/**
 * **The external-link arrow travels with the last word** (K-232).
 *
 * The footnote rendered `{label} ↗` with an ordinary space, so on a phone a
 * label that filled its first line put the 8px arrow alone on a second: the
 * pixel probe found six such lines across the EVE, FareHarbor and Rezdy
 * guides at 390.
 */
describe("the sources footnote", () => {
  it("glues the arrow to the label with a no-break space", () => {
    render(
      <SourcesFootnote
        locale="en-US"
        sources={[
          { label: "FareHarbor Help — downloading a manifest", url: "https://example.com" },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /downloading a manifest/ });
    expect(link.textContent).toBe("FareHarbor Help — downloading a manifest\u00A0↗");
  });

  it("runs its links as 44px targets at a 44px pitch", () => {
    render(
      <SourcesFootnote
        locale="en-US"
        sources={[
          { label: "EVE — exporting a report", url: "https://example.com/a" },
          { label: "EVE — the customer list", url: "https://example.com/b" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveClass(...TAP_TARGET);
    // The targets are the spacing: a gap on top of them would open the list
    // past the 44px each row already is.
    expect(links[0].closest("ul")?.className).not.toMatch(/(?:^|\s)(?:gap|space-y)-(?!0\b)/);
  });
});

/**
 * **The guide's own text links are 44px targets** (K-192).
 *
 * The pixel probe measured "← All switching guides" at 147.9×17 and "Other
 * switching guides →" at 168.8×20 on every guide at 390: text-height words,
 * a third of the floor (principles.md §2).
 */
describe("the guide's back links", () => {
  it("gives the hero's back link a 44px target on a line its text's height", () => {
    render(<GuideHero locale="en-US" source="switching-eve" eyebrow="E" title="T" lede="L" />);
    const link = screen.getByRole("link", { name: "← All switching guides" });
    expect(link).toHaveClass(...TAP_TARGET);
    // The line keeps the 14px text's own 20px, so the eyebrow below does not
    // move; the target bleeds 12px either side into the hero's padding and the
    // eyebrow's `mt-6`, clear of both.
    expect(link.parentElement).toHaveClass("flex", "h-5", "items-center");
  });

  it("gives the closing band's way back a 44px target", () => {
    renderClosing();
    expect(screen.getByRole("link", { name: "Other switching guides →" })).toHaveClass(
      ...TAP_TARGET,
    );
  });
});

function renderClosing() {
  return render(
    <ClosingCta
      locale="en-US"
      source="switching-eve-close"
      title="Ready?"
      body="Walk the demo first."
      backLabel="Other switching guides →"
    />,
  );
}

/**
 * **One rule at every band join, the concierge's included** (K-200).
 *
 * The closing band always follows `SwitchingConcierge`, and both were bare
 * `py-16 lg:py-20` boxes, so the two paddings stacked into 164px of nothing
 * under the concierge panel (135 at 390) where every other join on the page is
 * 80 | rule | 80. The band is now full-bleed and ruled on top, the shape
 * `SourcesFootnote` and `MovePath` have.
 */
describe("the closing band", () => {
  it("is a full-bleed section ruled on top, holding the column's box", () => {
    const { container } = renderClosing();
    const band = container.firstElementChild;
    expect(band?.tagName).toBe("SECTION");
    expect(band).toHaveClass("border-t", "border-border");
    expect(band?.className).not.toMatch(/max-w-|(?:^|\s)p[xy]?-/);
    expect(band?.firstElementChild).toHaveClass(
      "mx-auto",
      "max-w-4xl",
      "px-6",
      "py-16",
      "lg:py-20",
    );
  });
});
