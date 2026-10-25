// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { type WhoWantsInGroup, WhoWantsInPanel } from "./WhoWantsInPanel";
import type { WhoWantsInRow } from "./who-wants-in-rows";

// The held send reaches the router once a deal's outcome carries a notice.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

function row(id: string, name: string, over: Partial<WhoWantsInRow> = {}): WhoWantsInRow {
  return {
    interestId: id,
    name,
    email: `${id}@example.com`,
    facts: `${id}@example.com · Asked Sat, Aug 1`,
    certification: null,
    belowBar: false,
    offeredAt: null,
    ...over,
  };
}

const departure = (rows: WhoWantsInRow[]): WhoWantsInGroup => ({
  id: "departure",
  heading: "Asked for this departure",
  rows,
});

const discount = {
  toggle: "Add a discount to offers",
  hint: "Each offer below goes out with this discount.",
  amountAriaLabel: "Discount",
  kindAriaLabel: "Discount type",
  currencySymbol: "$",
};

function renderPanel(
  groups: WhoWantsInGroup[],
  props: { canOffer?: boolean; discount?: typeof discount | null } = {},
) {
  return render(
    <WhoWantsInPanel
      groups={groups}
      tripId="trip-1"
      shopSlug="blue-mantis"
      shopName="Blue Mantis"
      tripTitle="Wreck Trip"
      tripWhen="Sat 15 Aug"
      seatsOpen={3}
      canOffer={props.canOffer ?? true}
      discount={props.discount ?? null}
      locale="en-US"
    />,
  );
}

describe("WhoWantsInPanel", () => {
  it("renders nothing while no group has a row (principle 9)", () => {
    const { container } = renderPanel([departure([])]);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    expect(renderPanel([]).container).toBeEmptyDOMElement();
  });

  it("is #who-wants-in, counts every row, and says nobody holds a seat", () => {
    const { container } = renderPanel([
      departure([row("a", "Nora Quinn"), row("b", "Rafa Ortiz")]),
    ]);
    expect(container.querySelector("#who-wants-in")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Who wants in · 2" })).toBeVisible();
    expect(screen.getByText(/3 seats open/)).toBeVisible();
    expect(screen.getByText(/Nobody here holds a seat/)).toBeVisible();
  });

  it("draws a group only when it has rows, so a later group is just another prop", () => {
    renderPanel([
      departure([row("a", "Nora Quinn")]),
      { id: "date", heading: "Asked for this date", rows: [] },
      { id: "anytime", heading: "Around these dates", rows: [row("z", "Fay Ng")] },
    ]);
    expect(screen.getByRole("heading", { name: "Asked for this departure" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Asked for this date" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Around these dates" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Who wants in · 2" })).toBeVisible();
  });

  it("ranks nobody: a plain list in asked order with no position badge", () => {
    const { container } = renderPanel([
      departure([row("a", "Nora Quinn"), row("b", "Rafa Ortiz")]),
    ]);
    expect(container.querySelector("ol")).toBeNull();
    const names = [...container.querySelectorAll("li p.font-medium")].map((n) => n.textContent);
    expect(names).toEqual(["Nora Quinn", "Rafa Ortiz"]);
    const rankLike = [...container.querySelectorAll("li span")].filter((n) =>
      /^\d{1,2}$/.test(n.textContent?.trim() ?? ""),
    );
    expect(rankLike).toEqual([]);
  });

  it("ends every row in its own Offer a seat, below the bar included (A14)", () => {
    renderPanel([departure([row("a", "Nora Quinn", { belowBar: true }), row("b", "Rafa Ortiz")])]);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const nora = screen.getByRole("button", { name: "Offer Nora Quinn a seat" });
    const rafa = screen.getByRole("button", { name: "Offer Rafa Ortiz a seat" });
    // The mark informs; the offer stays available (ADR 20260814-self-declared-cards).
    expect(nora).toBeEnabled();
    expect(rafa).toBeEnabled();
    const ids = (button: HTMLElement) =>
      new FormData(button.closest("form") as HTMLFormElement).getAll("interestId");
    expect(ids(nora)).toEqual(["a"]);
    expect(ids(rafa)).toEqual(["b"]);
    // Each button sits in its own person's row.
    expect(nora.closest("li")).toHaveTextContent("Nora Quinn");
  });

  it("prints what the diver can dive on its own line, warning-toned while unverified", () => {
    renderPanel([
      departure([
        row("a", "Nora Quinn", {
          certification: {
            text: "Open Water — unverified · below this departure’s minimum",
            unchecked: true,
          },
          belowBar: true,
        }),
      ]),
    ]);
    expect(screen.getByText(/below this departure’s minimum/)).toHaveClass("text-warning-strong");
  });

  it("says which rows were already offered, and when", () => {
    renderPanel([
      departure([
        row("a", "Nora Quinn", { offeredAt: new Date(nowDate().getTime() - 2 * 3_600_000) }),
        row("b", "Rafa Ortiz"),
      ]),
    ]);
    expect(screen.getByText(/1 already offered/)).toBeVisible();
    expect(screen.getByText(/offered 2h ago/)).toBeVisible();
  });

  it("keeps the names and draws no button when nobody can be offered (owner, 2026-10-06)", () => {
    renderPanel([departure([row("a", "Nora Quinn")])], { canOffer: false });
    expect(screen.getByText("Nora Quinn")).toBeVisible();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("places the carry control inside the panel", () => {
    render(
      <WhoWantsInPanel
        groups={[departure([row("a", "Nora Quinn")])]}
        tripId="trip-1"
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        tripTitle="Wreck Trip"
        tripWhen="Sat 15 Aug"
        seatsOpen={0}
        canOffer
        locale="en-US"
        carry={<button type="button">Carry who’s waiting</button>}
      />,
    );
    const panel = document.getElementById("who-wants-in");
    expect(
      within(panel as HTMLElement).getByRole("button", { name: "Carry who’s waiting" }),
    ).toBeVisible();
  });

  it("draws the date and anytime groups under their own headings, in one count", () => {
    renderPanel([
      departure([row("a", "Nora Quinn")]),
      { id: "date", heading: "Asked for this date", rows: [row("d", "Eli Moss")] },
      { id: "anytime", heading: "Around these dates", rows: [row("z", "Fay Ng")] },
    ]);
    expect(screen.getByRole("heading", { name: "Who wants in · 3" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Asked for this date" })).toBeVisible();
    // One Offer per person, whichever group they are in.
    expect(screen.getAllByRole("button", { name: /^Offer .+ a seat$/ })).toHaveLength(3);
  });

  it("keeps rows past the preview cap behind Show N more, still counted and offerable", () => {
    renderPanel([
      {
        id: "anytime",
        heading: "Around these dates",
        rows: [row("a", "Fay Ng")],
        more: [row("b", "Gus Ode"), row("c", "Hana Lu")],
      },
    ]);
    expect(screen.getByRole("heading", { name: "Who wants in · 3" })).toBeVisible();
    const summary = screen.getByText("Show 2 more");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(
      within(details).getAllByRole("button", { name: /^Offer .+ a seat$/, hidden: true }),
    ).toHaveLength(2);
  });

  it("draws the discount only when it is handed the words, which is for mayDiscount roles", () => {
    renderPanel([departure([row("a", "Nora Quinn")])]);
    expect(screen.queryByText("Add a discount to offers")).toBeNull();
    cleanup();

    const { container } = renderPanel([departure([row("a", "Nora Quinn")])], { discount });
    // Closed by default: nothing is posted, so an ordinary offer carries no discount.
    const disclosure = container.querySelector("details[data-offer-discount]");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("Add a discount to offers")).toBeVisible();
    expect(screen.getByText("Each offer below goes out with this discount.")).not.toBeVisible();
    const form = screen
      .getByRole("button", { name: "Offer Nora Quinn a seat" })
      .closest("form") as HTMLFormElement;
    expect(new FormData(form).has("discount")).toBe(false);
  });
});
