// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PulseFacts, shownPulseFacts } from "./PulseFacts";

afterEach(cleanup);

const label = (count: number) => `${count} things to sort`;

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
    expect(screen.queryByText(/to sort/)).toBeNull();
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
    expect(screen.getByText("2 things to sort")).toBeInTheDocument();
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
