// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { type WhoWantsInGroup, WhoWantsInPanel } from "./WhoWantsInPanel";
import type { WhoWantsInRow } from "./who-wants-in-rows";

// The held send reaches the router once a deal's outcome carries a notice.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

function row(id: string, name: string, over: Partial<WhoWantsInRow> = {}): WhoWantsInRow {
  return {
    leadId: id,
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
  toggle: "With a discount",
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

  it("gives each row a tick that joins the offer form, below the bar included", () => {
    renderPanel([departure([row("a", "Nora Quinn", { belowBar: true }), row("b", "Rafa Ortiz")])]);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.getAttribute("form"))).toEqual(["offer-seat", "offer-seat"]);
    expect(boxes.map((box) => (box as HTMLInputElement).value)).toEqual(["a", "b"]);
    // The mark informs; the tick stays available (ADR 20260814-self-declared-cards).
    expect(boxes[0]).toBeEnabled();
    expect(boxes[0]).toHaveAttribute("data-below-bar", "true");
    expect(boxes[1]).not.toHaveAttribute("data-below-bar");
    expect(screen.getByRole("button", { name: "Offer a seat" })).toBeDisabled();
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

  it("keeps the names and draws no tick or button when nobody can be offered (owner, 2026-10-06)", () => {
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
    // One Offer for all three groups.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Offer a seat" })).toHaveLength(1);
  });

  it("keeps rows past the preview cap behind Show N more, still counted and tickable", () => {
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
    expect(within(details).getAllByRole("checkbox", { hidden: true })).toHaveLength(2);
    // Every box, shown or not, joins the one offer form.
    expect(
      screen.getAllByRole("checkbox", { hidden: true }).map((box) => box.getAttribute("form")),
    ).toEqual(["offer-seat", "offer-seat", "offer-seat"]);
  });

  it("draws the discount only when it is handed the words, which is for mayDiscount roles", () => {
    renderPanel([departure([row("a", "Nora Quinn")])]);
    expect(screen.queryByLabelText("With a discount")).toBeNull();
    cleanup();

    renderPanel([departure([row("a", "Nora Quinn")])], { discount });
    // Off by default: nothing is posted, so an ordinary offer carries no discount.
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByLabelText("With a discount"));
    expect(screen.getByRole("spinbutton", { name: "Discount" })).toHaveAttribute(
      "name",
      "discount",
    );
    expect(screen.getByRole("combobox", { name: "Discount type" })).toHaveAttribute(
      "name",
      "discountKind",
    );
    fireEvent.click(screen.getByLabelText("With a discount"));
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("never ticks a row under the bar from the bulk tick, and still lets a hand tick it", () => {
    renderPanel([
      departure([
        row("a", "Nora Quinn", { belowBar: true }),
        row("b", "Rafa Ortiz"),
        row("c", "Cleo Park"),
      ]),
    ]);
    const box = (name: string) =>
      screen.getByRole("checkbox", { name: `Offer ${name} a seat` }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Tick everyone who fits" }));
    expect(box("Rafa Ortiz").checked).toBe(true);
    expect(box("Cleo Park").checked).toBe(true);
    expect(box("Nora Quinn").checked).toBe(false);
    fireEvent.click(box("Nora Quinn"));
    expect(box("Nora Quinn").checked).toBe(true);
  });

  it("draws no bulk tick for a single row that fits", () => {
    renderPanel([departure([row("a", "Nora Quinn")])]);
    expect(screen.queryByRole("button", { name: "Tick everyone who fits" })).toBeNull();
  });
});
