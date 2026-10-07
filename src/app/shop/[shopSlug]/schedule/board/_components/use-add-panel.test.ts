// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BuilderOptions } from "./builder-types";
import { useAddPanel } from "./use-add-panel";

type Input = Parameters<typeof useAddPanel>[0];

const base: Input = {
  locale: "en-US",
  addDraft: null,
  dateIso: "2026-10-10",
  options: null,
  initialCourse: null,
  startExpanded: false,
};

const shoreOnly: BuilderOptions = {
  courses: [],
  diveSites: [],
  hasBoatDiving: false,
  hasShoreDiving: true,
};

describe("useAddPanel", () => {
  it("opens on boat until the options land, then on the first mode the shop runs", () => {
    const { result, rerender } = renderHook((input: Input) => useAddPanel(input), {
      initialProps: base,
    });
    expect(result.current.diveMode).toBe("boat");
    rerender({ ...base, options: shoreOnly });
    expect(result.current.offeredModes).toEqual(["shore"]);
    expect(result.current.diveMode).toBe("shore");
  });

  it("seeds the dive plan from the quick row on the first expansion, and only then", () => {
    const { result } = renderHook(() => useAddPanel(base));
    expect(result.current.diveSeed).toBeNull();
    act(() => {
      result.current.setPlannedDives(3);
      result.current.setDiveSiteId("site-1");
    });
    act(() => result.current.toggleExpanded());
    expect(result.current.expanded).toBe(true);
    expect(result.current.diveSeed).toEqual({ count: 3, siteId: "site-1" });

    act(() => result.current.toggleExpanded());
    act(() => result.current.setPlannedDives(1));
    act(() => result.current.toggleExpanded());
    expect(result.current.diveSeed).toEqual({ count: 3, siteId: "site-1" });
  });

  it("sizes the departure to a request plan's suggestion", () => {
    const { result } = renderHook(() =>
      useAddPanel({
        ...base,
        requestPlan: {
          estimatedDivers: 9,
          suggestedCapacity: 10,
          suggestedDivemasters: 2,
          diversPerDivemaster: 6,
          requests: [],
        },
      }),
    );
    expect(result.current.capacity).toBe(10);
  });

  it("asks for the weekday's pattern only on a panel opened plainly", async () => {
    const loadPattern = vi.fn(async () => null);
    renderHook(() => useAddPanel({ ...base, loadPattern }));
    await waitFor(() => expect(loadPattern).toHaveBeenCalledWith("2026-10-10"));

    const courseLoad = vi.fn(async () => null);
    renderHook(() =>
      useAddPanel({
        ...base,
        loadPattern: courseLoad,
        initialCourse: { id: "c", title: "Open Water", requirement: "" },
      }),
    );
    expect(courseLoad).not.toHaveBeenCalled();
  });

  it("asks nothing about the tide until a site is chosen", () => {
    const loadTideWindow = vi.fn(async () => "High tide 9:12 AM");
    const { result } = renderHook(() => useAddPanel({ ...base, loadTideWindow }));
    expect(loadTideWindow).not.toHaveBeenCalled();
    expect(result.current.tideLine).toBeNull();
  });
});
