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

  it("hands Cancel back to the board", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
