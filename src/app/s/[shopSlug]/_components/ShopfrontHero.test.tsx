// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { ShopfrontHero } from "./ShopfrontHero";

/**
 * The hero's pins for ADR 20260827-clearwater-surface-language, decision 8.
 * Most of them are silences: what the hero renders when the shop has written
 * nothing is the whole point, because day zero is a shipping shape and a hero
 * full of DiveDay filler is what this replaced.
 */
const t = diverTranslator("en-US");
const es = diverTranslator("es-ES");

afterEach(cleanup);

const NO_REVIEWS = { count: 0, average: null, suppressedCount: 0 };

/** What a sighted reader sees on a line — the star row's spoken label is not part of it. */
function visibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll(".sr-only")) hidden.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("the hero renders only what the shop authored", () => {
  it("is a name and nothing else on day zero", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={NO_REVIEWS}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Blue Mantis Divers");
    // No tagline line, no rating line, no conservation line — and above all no
    // DiveDay sentence standing in for any of them.
    expect(screen.queryAllByRole("paragraph")).toHaveLength(0);
    expect(screen.queryByText(/reviews/i)).not.toBeInTheDocument();
  });

  it("renders the tagline only when the shop wrote one", () => {
    const { rerender } = render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline="Small-boat reef and wreck diving out of Key Largo."
        aggregate={NO_REVIEWS}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );
    expect(
      screen.getByText("Small-boat reef and wreck diving out of Key Largo."),
    ).toBeInTheDocument();

    rerender(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={NO_REVIEWS}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );
    expect(
      screen.queryByText("Small-boat reef and wreck diving out of Key Largo."),
    ).not.toBeInTheDocument();
  });

  it("says the rating exactly as the design words it, once divers have left one", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={{ count: 83, average: 4.3, suppressedCount: 0 }}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );

    expect(visibleText(screen.getByRole("paragraph"))).toBe("4.3 · 83 reviews");
  });

  it("formats the figure for the reader's own locale", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={{ count: 83, average: 4.3, suppressedCount: 0 }}
        commitments={[]}
        locale="es-ES"
        t={es}
      />,
    );

    expect(visibleText(screen.getByRole("paragraph"))).toContain("4,3");
  });
});

describe("the accent is the stars, and it is data ink", () => {
  it("fills the stars in --accent, as drawn marks rather than a glyph", () => {
    const { container } = render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={{ count: 83, average: 4.3, suppressedCount: 0 }}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );

    expect(container.querySelector(".text-accent")).not.toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(5);
    expect(container.textContent).not.toContain("★");
  });

  it("spends no accent at all on a shop with no reviews", () => {
    const { container } = render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline="Small-boat reef and wreck diving out of Key Largo."
        aggregate={NO_REVIEWS}
        commitments={["green_fins_member"]}
        locale="en-US"
        t={t}
      />,
    );

    expect(container.querySelector(".text-accent")).toBeNull();
    expect(container.querySelector(".bg-accent")).toBeNull();
  });
});

describe("the conservation line", () => {
  it("joins every commitment the shop chose, behind one drawn glyph", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={NO_REVIEWS}
        commitments={["green_fins_member", "no_touch_policy", "coral_nursery_support"]}
        locale="en-US"
        t={t}
      />,
    );

    expect(visibleText(screen.getByRole("paragraph"))).toBe(
      "Green Fins member · No-touch reef policy · Coral nursery support " +
        "Stated by the shop, not verified by DiveDay.",
    );
  });

  it("keeps the claims guard — it is never deleted and never softened", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={NO_REVIEWS}
        commitments={["green_fins_member"]}
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText("Stated by the shop, not verified by DiveDay.")).toBeInTheDocument();
  });

  it("renders nothing at all when the shop has ticked nothing", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={NO_REVIEWS}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.queryByText(/Stated by the shop/)).not.toBeInTheDocument();
  });
});

/**
 * Harbor (ADR 20260901-diveday-reimagined, decision 2): the shop's display face
 * labels the name and nothing that carries a fact.
 */
describe("the shop's face", () => {
  it("dresses the name in the display face and leaves the rating in Geist", () => {
    const { container } = render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline={null}
        aggregate={{ average: 4.3, count: 83, suppressedCount: 0 }}
        commitments={[]}
        locale="en-US"
        t={t}
      />,
    );
    expect(container.querySelector("h1")).toHaveClass("font-brand-display");
    const faced = [...container.querySelectorAll(".font-brand-display")];
    expect(faced).toHaveLength(1);
    expect(faced[0]?.tagName).toBe("H1");
  });

  it("puts the name on the cover photograph when the shop has one, and the wall beneath", () => {
    render(
      <ShopfrontHero
        name="Blue Mantis Divers"
        tagline="Two tanks before lunch."
        aggregate={null}
        commitments={[]}
        heroImage={{ url: "/dive-sites/reef.jpg", alt: "Elkhorn coral" }}
        badges={["padi_5_star"]}
        establishedYear={1998}
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByAltText("Elkhorn coral")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Blue Mantis Divers");
    expect(screen.getByText("Since 1998")).toBeInTheDocument();
    expect(screen.getByText("PADI 5 Star Dive Center")).toBeInTheDocument();
  });
});
