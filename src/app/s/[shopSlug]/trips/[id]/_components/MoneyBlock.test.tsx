// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { MoneyBlock, type MoneyBlockContext } from "./MoneyBlock";

/**
 * The block's whole job is a rule, not a layout: **one figure at or above
 * `text-lg`, and silence where there is nothing to say.** Both halves are
 * pinned here (ADR 20260827-the-divers-thread, decision 2).
 */

afterEach(cleanup);

function props(overrides: Partial<MoneyBlockContext> = {}): MoneyBlockContext {
  return {
    fareCents: 9_500,
    partySize: 1,
    gearCents: 0,
    courseFeeCents: null,
    eLearningFeeCents: null,
    passThroughFeeLine: null,
    passThroughTotalCents: 0,
    taxLine: "none" as const,
    dueNow: "checkout" as const,
    depositCents: null,
    balanceDueAt: null,
    currency: "usd" as const,
    locale: "en-US",
    timeZone: "America/New_York",
    ...overrides,
  };
}

/** Every figure the block renders at or above the total's own size. */
function loudFigures() {
  return [...document.querySelectorAll(".text-lg, .text-xl, .text-2xl, .text-3xl")].map(
    (node) => node.textContent,
  );
}

describe("MoneyBlock — one figure", () => {
  it("states exactly one figure at total scale when the diver pays now", () => {
    renderDiver(<MoneyBlock context={props({ partySize: 2, gearCents: 4_500 })} />);

    expect(screen.getByText("Due now")).toBeInTheDocument();
    expect(loudFigures()).toEqual(["$235"]);
  });

  it("states exactly one figure at total scale when the shop is paid at the counter", () => {
    renderDiver(<MoneyBlock context={props({ partySize: 3, dueNow: "at_shop" })} />);

    expect(screen.getByText("Due at the shop")).toBeInTheDocument();
    expect(screen.queryByText("Due now")).not.toBeInTheDocument();
    expect(loudFigures()).toEqual(["$285"]);
  });

  it("renders nothing at all for an unpriced departure", () => {
    // Never a "$0" under a Book button: a trip with no price has no money
    // story, and a zero reads as either a bug or a promise.
    const { container } = renderDiver(
      <MoneyBlock context={props({ dueNow: "none", fareCents: 0 })} />,
    );
    expect(container.querySelector("dl")).toBeNull();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("MoneyBlock — the lines that do not render", () => {
  it("hides the gear line when nothing was rented", () => {
    renderDiver(<MoneyBlock context={props({ gearCents: 0 })} />);
    expect(screen.queryByText("Rental gear")).not.toBeInTheDocument();
  });

  it("shows the gear line once something is", () => {
    renderDiver(<MoneyBlock context={props({ gearCents: 4_500 })} />);
    expect(screen.getByText("Rental gear")).toBeInTheDocument();
    expect(screen.getByText("$45")).toBeInTheDocument();
  });

  it("hides the course-fee and e-learning lines on an ordinary charter", () => {
    renderDiver(<MoneyBlock context={props({ partySize: 2 })} />);
    expect(screen.queryByText("Course fee")).not.toBeInTheDocument();
    expect(screen.queryByText("E-learning")).not.toBeInTheDocument();
    // …and states the fare instead, which the two of them would otherwise
    // double.
    expect(screen.getByText("$95 × 2 divers")).toBeInTheDocument();
  });

  /**
   * Visual review 2026-10-24, B20: one diver and nothing else to add, the
   * fare line said the pay line's figure twice ("$95 × 1 diver $95", then
   * "Due now $95"). The pay line says it once, in the hero's format.
   */
  it("states a lone diver's fare once, on the pay line", () => {
    renderDiver(<MoneyBlock context={props()} />);
    expect(screen.queryByText(/× 1 diver/)).not.toBeInTheDocument();
    expect(screen.getAllByText("$95")).toHaveLength(1);
  });

  it("keeps the fare line once anything else is added to it", () => {
    renderDiver(<MoneyBlock context={props({ gearCents: 4_500 })} />);
    expect(screen.getByText("$95 × 1 diver")).toBeInTheDocument();
    expect(screen.getByText("$140")).toBeInTheDocument();
  });

  it("keeps the minor units of an amount that has them", () => {
    renderDiver(<MoneyBlock context={props({ fareCents: 6_250 })} />);
    expect(screen.getByText("$62.50")).toBeInTheDocument();
  });

  it("replaces the fare line with the course's own two halves", () => {
    renderDiver(
      <MoneyBlock context={props({ courseFeeCents: 40_000, eLearningFeeCents: 9_000 })} />,
    );
    expect(screen.getByText("Course fee")).toBeInTheDocument();
    expect(screen.getByText("E-learning")).toBeInTheDocument();
    expect(screen.queryByText(/× 1 diver/)).not.toBeInTheDocument();
  });

  it("hides the e-learning line for a course that does not sell one", () => {
    renderDiver(
      <MoneyBlock context={props({ courseFeeCents: 40_000, eLearningFeeCents: null })} />,
    );
    expect(screen.getByText("Course fee")).toBeInTheDocument();
    expect(screen.queryByText("E-learning")).not.toBeInTheDocument();
  });

  it("hides the third-party fee line when the shop charges none", () => {
    renderDiver(<MoneyBlock context={props({ passThroughFeeLine: null })} />);
    expect(screen.queryByText(/third-party charge/)).not.toBeInTheDocument();
  });

  it("says nothing about tax unless Stripe adds it at checkout", () => {
    renderDiver(<MoneyBlock context={props({ taxLine: "none" })} />);
    expect(screen.queryByText("Tax")).not.toBeInTheDocument();

    cleanup();
    renderDiver(<MoneyBlock context={props({ taxLine: "checkout" })} />);
    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("added at checkout")).toBeInTheDocument();
  });
});

/**
 * **The last line sits midway between its two hairlines.**
 *
 * The caller opens the block with a rule and 16px (`border-t pt-4`), and the
 * total closes it with a rule of its own. The lines stack at `gap-2`, so with
 * nothing else the last line had 16px of air above it and 8px below, and the
 * pixel probe measured its ink 4px under the band's centre on the public trip.
 * The total's rule takes the other 8px itself, and 16px under it, the rhythm
 * of every other rule in the booking card.
 */
describe("MoneyBlock — the total's rule", () => {
  it("stands 16px under the last line and 16px over the total", () => {
    renderDiver(<MoneyBlock context={props({ partySize: 2 })} />);
    const total = screen.getByText("Due now").parentElement;
    expect(total?.parentElement).toHaveClass("gap-2");
    expect(total).toHaveClass("mt-2", "border-t", "border-border", "pt-4");
    expect(total).not.toHaveClass("pt-3");
  });
});

describe("MoneyBlock — the deposit split", () => {
  it("charges the deposit now and names when the remainder is owed", () => {
    renderDiver(
      <MoneyBlock
        context={{
          ...props({
            partySize: 2,
            depositCents: 3_000,
            balanceDueAt: new Date("2026-08-29T15:00:00Z"),
          }),
        }}
      />,
    );

    // $30 × 2 now…
    expect(loudFigures()).toEqual(["$60"]);
    // …and $65 × 2 at the dock, on the departure's own day.
    expect(screen.getByText(/\$130 at the dock on Sat, Aug 29/)).toBeInTheDocument();
  });

  it("never renders a deposit line on a booking nobody is paying for yet", () => {
    // A book-now-pay-later seat takes no money at all today, so splitting a
    // payment into a deposit and a balance invents a transaction.
    renderDiver(
      <MoneyBlock
        context={{
          ...props({
            dueNow: "at_shop",
            depositCents: 3_000,
            balanceDueAt: new Date("2026-08-29T15:00:00Z"),
          }),
        }}
      />,
    );

    expect(screen.queryByText(/at the dock on/)).not.toBeInTheDocument();
    expect(loudFigures()).toEqual(["$95"]);
  });
});

describe("MoneyBlock — how the desk takes money (ideas item 21)", () => {
  it("says it under a figure due at the shop, as a definition of it", () => {
    renderDiver(<MoneyBlock context={props({ dueNow: "at_shop", deskPayment: "card" })} />);
    const line = screen.getByText("Pay by card when you arrive.");
    expect(line.tagName).toBe("DD");
    // A `<dl>`'s groups may hold only `<dt>`/`<dd>` (axe `definition-list`).
    for (const group of document.querySelectorAll("dl > div")) {
      for (const child of group.children) expect(["DT", "DD"]).toContain(child.tagName);
    }
  });

  it("says it under a deposit's balance too, which is paid on arrival", () => {
    renderDiver(
      <MoneyBlock
        context={props({
          dueNow: "checkout",
          depositCents: 3_000,
          balanceDueAt: new Date("2026-08-29T15:00:00Z"),
          deskPayment: "card_and_cash",
        })}
      />,
    );
    expect(screen.getByText(/at the dock on Sat, Aug 29/).textContent).toMatch(
      / Pay by card or cash when you arrive\.$/,
    );
  });

  it("says nothing when the diver pays now", () => {
    renderDiver(<MoneyBlock context={props({ dueNow: "checkout", deskPayment: "card" })} />);
    expect(screen.queryByText("Pay by card when you arrive.")).toBeNull();
  });
});
