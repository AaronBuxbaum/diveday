// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPanel, type AddPanelBuilder } from "./AddPanel";
import type { BuilderCopy, BuilderMoreOptions } from "./builder-types";

afterEach(cleanup);

/** Every word is its own key, so a test names the control it means. */
const COPY = new Proxy({} as BuilderCopy, { get: (_, key) => String(key) });

const MORE: BuilderMoreOptions = {
  weekdayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  minDays: 1,
  maxDays: 7,
  diveFields: new Proxy({} as BuilderMoreOptions["diveFields"], {
    get: (_, key) => String(key),
  }),
};

/** The board's shared builder and one panel's own props, as one flat bag to override. */
type PanelProps = AddPanelBuilder & Omit<Parameters<typeof AddPanel>[0], "builder">;

function renderPanel(over: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    locale: "en-US",
    addDraft: null,
    draftActions: { save: async () => {}, discard: async () => {} },
    dateIso: "2026-10-10",
    options: { courses: [], diveSites: [{ id: "site-1", title: "Molasses Reef" }] },
    price: { step: "0.01", max: 100_000, placeholder: "$0.00" },
    copy: COPY,
    more: MORE,
    initialCourse: null,
    startExpanded: false,
    onAdd: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  const { dateIso, initialCourse, initialSite, requestPlan, startExpanded, onCancel, ...builder } =
    props;
  return {
    props,
    ...render(
      <AddPanel
        builder={builder}
        dateIso={dateIso}
        initialCourse={initialCourse}
        initialSite={initialSite}
        requestPlan={requestPlan}
        startExpanded={startExpanded}
        onCancel={onCancel}
      />,
    ),
  };
}

describe("AddPanel", () => {
  it("draws the one create form, dated to the day it was opened from", () => {
    const { container } = renderPanel();
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(container.querySelector('input[name="date"]')?.getAttribute("value")).toBe("2026-10-10");
    expect(screen.getByRole("option", { name: "Molasses Reef" })).toBeTruthy();
  });

  it("shows a selected priced course total instead of a separate trip price field", () => {
    const { container } = renderPanel({
      startExpanded: true,
      options: {
        courses: [
          {
            id: "course-1",
            title: "Open Water",
            agency: "padi",
            priceLabel: "$250.00 per diver, the course’s price",
          },
        ],
        diveSites: [],
      },
      initialCourse: {
        id: "course-1",
        title: "Open Water",
        requirement: "",
        priceLabel: "$250.00 per diver, the course’s price",
      },
    });
    expect(screen.getByText("$250.00 per diver, the course’s price")).toBeTruthy();
    const price = container.querySelector<HTMLInputElement>('input[name="priceDollars"]');
    expect(price?.hidden).toBe(true);
    expect(price?.disabled).toBe(true);
  });

  it("keeps the typed fallback fee when switching from an unpriced course to a priced one and back", () => {
    const { container } = renderPanel({
      startExpanded: true,
      options: {
        courses: [
          { id: "unpriced", title: "Unpriced", agency: "padi", priceLabel: null },
          {
            id: "priced",
            title: "Priced",
            agency: "padi",
            priceLabel: "$250.00 per diver, the course’s price",
          },
        ],
        diveSites: [],
      },
    });
    const price = container.querySelector<HTMLInputElement>('input[name="priceDollars"]');
    const course = container.querySelector<HTMLSelectElement>('select[name="courseId"]');
    if (!price || !course) throw new Error("expected the price and course controls");

    fireEvent.change(price, { target: { value: "125" } });
    fireEvent.change(course, { target: { value: "unpriced" } });
    fireEvent.change(course, { target: { value: "priced" } });
    expect(price.hidden).toBe(true);
    expect(price.disabled).toBe(true);
    expect(price.value).toBe("125");
    fireEvent.change(course, { target: { value: "unpriced" } });
    expect(container.querySelector('input[name="priceDollars"]')).toBe(price);
    expect(price.hidden).toBe(false);
    expect(price.disabled).toBe(false);
    expect(price.value).toBe("125");
  });

  it("warns when the seats exceed the selected boat and leaves the form enabled", () => {
    const copy = new Proxy({} as BuilderCopy, {
      get: (_, key) =>
        key === "boatCapacityWarning" ? "The boat has {count} seats." : String(key),
    });
    renderPanel({
      copy,
      options: {
        courses: [],
        diveSites: [],
        hasBoatDiving: true,
        boats: [{ id: "b1", name: "Reef", capacity: 6 }],
      },
    });
    fireEvent.change(screen.getByLabelText(/boatSelectLabel/), { target: { value: "b1" } });
    fireEvent.change(screen.getByLabelText("seats"), { target: { value: "8" } });
    expect(screen.getByText("The boat has 6 seats.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "putOnBoard" })).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("seats"), { target: { value: "6" } });
    expect(screen.queryByText("The boat has 6 seats.")).toBeNull();
  });

  it("hands Cancel back to the board", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
