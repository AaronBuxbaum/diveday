// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCard, sectionCardClass } from "./card";

afterEach(cleanup);

/**
 * The card's contract is mostly visual, but the parts a screenshot cannot
 * prove are here: there is exactly one radius and it is not configurable, the
 * heading is a real heading at the right level, and the shell string a
 * `loading.tsx` skeleton wears is the same one the card wears — a skeleton
 * that drifts from its page is a layout jump on every navigation.
 */
describe("sectionCardClass", () => {
  it("is one radius, and the ShopStat/Table spelling", () => {
    expect(sectionCardClass()).toBe("rounded-2xl border border-border bg-surface p-4 sm:p-5");
  });

  it("drops the padding for a shell", () => {
    expect(sectionCardClass({ padding: "none" })).not.toMatch(/\bp-\d/);
    expect(sectionCardClass({ padding: "lg" })).toContain("p-5 sm:p-6");
  });

  /**
   * **Elevation is earned** — ADR 20260827-clearwater-surface-language,
   * decision 1. A panel at rest is a fill and a hairline; a shadow says the
   * thing floats above the page, which is true of a menu, a sheet, a dialog
   * and a toast and of nothing else. Asserted as "no shadow utility at all"
   * rather than as "not `shadow-sm`", because the failure this guards against
   * is somebody reaching for a *quieter* shadow rather than reaching for the
   * same one again.
   */
  it("emits no shadow token, at any padding or with any className", () => {
    for (const padding of ["none", "md", "lg"] as const) {
      expect(sectionCardClass({ padding }), padding).not.toMatch(/\bshadow(-|$)/);
    }
    expect(sectionCardClass({ className: "scroll-mt-24" })).not.toMatch(/\bshadow(-|$)/);
  });

  /**
   * The prop is gone, not merely defaulted off. It existed so a card nested in
   * another card could stop stacking surface on surface; with no shadow at
   * rest there is nothing to stack, and leaving it accepted would let a call
   * site keep asking for an elevation it will never get.
   */
  it("takes no `elevated` option — the escape hatch is inert, not just off", () => {
    // `pnpm typecheck` refuses the prop at a call site; this is the runtime
    // half, for the JS a `.mjs` script or a stale build could still hand it.
    const forced = (sectionCardClass as (options: Record<string, unknown>) => string)({
      elevated: true,
    });
    expect(forced).toBe(sectionCardClass());
  });
});

describe("SectionCard", () => {
  it("wears one radius, whatever the call site asks for", () => {
    const { container } = render(
      <SectionCard className="scroll-mt-24">
        <p>Body</p>
      </SectionCard>,
    );
    const card = container.querySelector("section");
    expect(card).toHaveClass("rounded-2xl", "border", "border-border", "bg-surface");
    expect(card?.className).not.toMatch(/\bshadow(-|$)/);
    // The drift this component exists to end: no call site can reintroduce a
    // second radius through the escape hatch.
    expect(card?.className).not.toMatch(/rounded-(lg|xl|3xl)\b/);
    expect(card).toHaveClass("scroll-mt-24");
  });

  it("renders the title as a real heading, at the level the caller names", () => {
    render(<SectionCard title="Backups">body</SectionCard>);
    expect(screen.getByRole("heading", { level: 2, name: "Backups" })).toHaveClass(
      "text-lg",
      "font-semibold",
    );
    cleanup();
    render(
      <SectionCard title="Delivery history" titleAs="h3">
        body
      </SectionCard>,
    );
    // A card nested under a group's own h2 steps down, so the two do not shout
    // at the same volume.
    expect(screen.getByRole("heading", { level: 3, name: "Delivery history" })).toHaveClass(
      "text-base",
    );
  });

  it("owns the gap under its header, so no call site opens its body with a margin", () => {
    const { container } = render(
      <SectionCard title="Test message" description="Send one to your own phone.">
        <form data-testid="body" />
      </SectionCard>,
    );
    expect(screen.getByTestId("body").parentElement).toHaveClass("mt-4");
    // ...and carries no outer margin of its own: rhythm belongs to the page.
    expect(container.querySelector("section")?.className).not.toMatch(/\bm[tby]?-\d/);
  });

  it("renders no header wrapper at all when it has no heading", () => {
    const { container } = render(
      <SectionCard as="li" id="staff-1">
        <p>Ana Reyes</p>
      </SectionCard>,
    );
    const card = container.querySelector("li");
    expect(card).toHaveAttribute("id", "staff-1");
    // The body is the card's own child, not wrapped in a spacer that would put
    // 16px of nothing at the top of every row in a roster.
    expect(card?.firstElementChild?.tagName).toBe("P");
  });

  it("puts actions beside the heading", () => {
    render(
      <SectionCard title="Connected" actions={<span>Verified</span>}>
        body
      </SectionCard>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Connected" });
    const header = heading.parentElement?.parentElement;
    expect(header).toHaveClass("justify-between");
    expect(header).toContainElement(screen.getByText("Verified"));
  });
});

describe("naming the region", () => {
  it("labels a titled card with its own heading", () => {
    // The hand-rolled panels this replaces paired a written `aria-labelledby`
    // with a written heading id, and mostly did not bother. Deriving it means
    // the label cannot drift from the title.
    const { container } = render(<SectionCard title="Backups">body</SectionCard>);
    const section = container.querySelector("section");
    const heading = container.querySelector("h2");
    expect(heading?.id).toBeTruthy();
    expect(section?.getAttribute("aria-labelledby")).toBe(heading?.id);
  });

  it("gives two cards sharing a heading distinct ids", () => {
    // Two "Notes" cards on one page is legitimate, which is why the id comes
    // from useId rather than from a slug of the title.
    const { container } = render(
      <>
        <SectionCard title="Notes">one</SectionCard>
        <SectionCard title="Notes">two</SectionCard>
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("h2"));
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  it("does not label an untitled card, or a list item", () => {
    // Nothing to point at; and an `li` is named by its content, so labelling
    // it would announce the heading twice.
    const { container } = render(<SectionCard>body</SectionCard>);
    expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false);

    const list = render(
      <SectionCard as="li" title="Rosa Delgado">
        row
      </SectionCard>,
    );
    expect(list.container.querySelector("li")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("preserves aria-label when passed explicitly", () => {
    const { container: kebabContainer } = render(
      <SectionCard aria-label="Conservation commitments">body</SectionCard>,
    );
    expect(kebabContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );

    const { container: camelContainer } = render(
      <SectionCard ariaLabel="Conservation commitments">body</SectionCard>,
    );
    expect(camelContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );
  });
});
