// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCard } from "./card";

afterEach(cleanup);

describe("SectionCard", () => {
  it("renders the title as a real heading, at the level the caller names", () => {
    render(<SectionCard title="Backups">body</SectionCard>);
    expect(screen.getByRole("heading", { level: 2, name: "Backups" })).toHaveClass(
      "text-2xl",
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
});

describe("naming the region", () => {
  it("uses the native aria-label attribute for an untitled region", () => {
    render(<SectionCard aria-label="Weekly email digest">body</SectionCard>);

    expect(screen.getByRole("region", { name: "Weekly email digest" })).toHaveAttribute(
      "aria-label",
      "Weekly email digest",
    );
  });

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
