// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PulseFacts, shownPulseFacts } from "./PulseFacts";

afterEach(cleanup);

const label = (count: number) => `Needs you · ${count}`;

describe("PulseFacts (UX audit item 23)", () => {
  it("renders nothing when nothing needs anyone", () => {
    const { container } = render(<PulseFacts facts={[]} foldLabel={label} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a single work fact as its own link", () => {
    render(
      <PulseFacts
        facts={[{ text: "1 order is awaiting payment", href: "/o" }]}
        foldLabel={label}
      />,
    );
    expect(screen.getByRole("link", { name: "1 order is awaiting payment" })).toBeVisible();
    expect(screen.queryByText(/Needs you/)).toBeNull();
  });

  it("folds two work facts into one closed line that opens to the same doors", () => {
    const { container } = render(
      <PulseFacts
        facts={[
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    const fold = container.querySelector("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
    expect(screen.getByText("Needs you · 2")).toBeInTheDocument();
    expect(fold?.querySelectorAll("a")).toHaveLength(2);
  });

  it("never folds a fact that holds the boat up", () => {
    render(
      <PulseFacts
        facts={[
          { text: "Needs an instructor", href: "?view=details#crew", tone: "danger" },
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    const hazard = screen.getByRole("link", { name: "Needs an instructor" });
    expect(hazard.closest("details")).toBeNull();
  });

  it("stands a warning fact on its own line, outside the fold, in warning ink", () => {
    const { container } = render(
      <PulseFacts
        facts={[
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "2 people want nitrox with no verified card", href: "/nitrox", tone: "warning" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    const warning = screen.getByRole("link", {
      name: "2 people want nitrox with no verified card",
    });
    expect(warning.closest("details")).toBeNull();
    expect(warning.className).toContain("text-warning-strong");
    expect(warning.className).not.toContain("text-danger");
    // The two neutral facts still fold into one line of their own.
    expect(screen.getByText(label(2))).toBeInTheDocument();
    expect(container.querySelectorAll("details a")).toHaveLength(2);
  });

  it("never counts a warning fact among the things to sort", () => {
    render(
      <PulseFacts
        facts={[
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "2 people want nitrox with no verified card", href: "/nitrox", tone: "warning" },
        ]}
        foldLabel={label}
      />,
    );
    expect(screen.queryByText(/Needs you/)).toBeNull();
    expect(screen.getByRole("link", { name: "4 divers are missing rental sizes" })).toBeVisible();
  });
});

describe("shownPulseFacts", () => {
  const roster = { text: "1 blocked", href: "/shop/x/trips/t#roster", tone: "danger" as const };
  const sizes = { text: "Sizes to take", href: "/shop/x/trips/t/gear" };

  it("shows nothing on a finished departure, whose tab is its record", () => {
    expect(shownPulseFacts([roster, sizes], { desk: null, finished: true })).toEqual([]);
  });

  it("drops the roster door while the desk's count says it", () => {
    expect(
      shownPulseFacts([roster, sizes], {
        desk: { arrival: { instrument: () => null } },
        finished: false,
      }),
    ).toEqual([sizes]);
    expect(shownPulseFacts([roster, sizes], { desk: null, finished: false })).toEqual([
      roster,
      sizes,
    ]);
  });
});

describe("the opened Needs you strip (visual review A46)", () => {
  const contact = (name: string) => ({
    text: `${name} · No emergency contact`,
    href: `/divers/${name}`,
    chip: { kind: "Contact", icon: "divers" as const, tone: "neutral" as const },
  });

  it("draws one chip per kind, counted, and keeps every door one tap away", () => {
    const { container } = render(
      <PulseFacts
        facts={[
          contact("Nadia"),
          { ...contact("Mara"), href: "/divers/Mara" },
          {
            text: "1 order awaiting payment",
            href: "/orders",
            chip: { kind: "Payment", tone: "neutral" },
          },
          {
            text: "Diego · Missing a rental size",
            href: "/prep",
            chip: { kind: "Prep", tone: "neutral" },
          },
          {
            text: "Not asked about kit: Lena",
            href: "/prep",
            chip: { kind: "Prep", tone: "neutral" },
          },
        ]}
        foldLabel={label}
        rosterHref="/trip#roster"
      />,
    );
    expect(screen.getByText("Needs you · 5")).toBeInTheDocument();
    const chips = [...container.querySelectorAll("details li a")];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Contact · 2",
      "1 order awaiting payment",
      "Prep · 2",
    ]);
    // Two divers' records: the roster holds both rows. Two prep rows on one list: that list.
    expect(chips.map((chip) => chip.getAttribute("href"))).toEqual([
      "/trip#roster",
      "/orders",
      "/prep",
    ]);
  });

  it("leaves a fact with no kind as its own chip in its own words", () => {
    const { container } = render(
      <PulseFacts
        facts={[
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    expect([...container.querySelectorAll("details li a")].map((a) => a.textContent)).toEqual([
      "4 divers are missing rental sizes",
      "1 order is awaiting payment",
    ]);
  });
});
