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
    expect(sectionCardClass()).toBe(
      "rounded-2xl border border-border bg-surface shadow-sm p-4 sm:p-5",
    );
  });

  it("drops the shadow for a card contained by another, and the padding for a shell", () => {
    expect(sectionCardClass({ elevated: false })).not.toContain("shadow-sm");
    expect(sectionCardClass({ padding: "none" })).not.toMatch(/\bp-\d/);
    expect(sectionCardClass({ padding: "lg" })).toContain("p-5 sm:p-6");
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
    expect(card).toHaveClass("rounded-2xl", "border", "border-border", "bg-surface", "shadow-sm");
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
});
