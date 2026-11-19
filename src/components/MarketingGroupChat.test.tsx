// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GroupChatLabels, MarketingGroupChat } from "./MarketingGroupChat";

const labels: GroupChatLabels = {
  region: "chat",
  group: "Crew",
  members: "Dana, Rob, Mia, and you",
  stamp: "Tuesday",
  names: { dana: "Dana", rob: "Rob", mia: "Mia" },
  typing: { dana: "Dana is typing", rob: "Rob is typing", mia: "Mia is typing" },
  lines: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
  card: {
    title: "Tomorrow",
    readyBefore: "8 of 9",
    readyAfter: "9 of 9",
    needsYou: "Needs you",
    diver: "Tom",
    unsigned: "Not signed",
    nudge: "Nudge",
    sent: "Sent",
    signed: "Signed",
  },
  composer: "Message",
  replay: "Play again",
  note: "note",
};

/** jsdom has neither; the chat asks both before it moves. */
function stubBrowser({ reducedMotion }: { reducedMotion: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reducedMotion })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly seen: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.seen([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the homepage group chat", () => {
  it("is sent finished, so a reader without script sees the list at nine of nine", () => {
    const html = renderToString(<MarketingGroupChat labels={labels} />);
    expect(html).toContain("9 of 9");
    expect(html).toContain("ten");
    expect(html).not.toContain("8 of 9");
  });

  it("stays finished for a reader who asked for reduced motion", () => {
    stubBrowser({ reducedMotion: true });
    render(<MarketingGroupChat labels={labels} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.queryByText("Rob is typing")).toBeNull();
  });

  it("rewinds, lands each line after its sender's dots, and takes the nudge itself if nobody does", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.queryByText("two")).toBeNull();
    expect(screen.getByText("Rob is typing")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(1300));
    expect(screen.getByText("two")).toBeTruthy();

    // One timer per moment, so each is advanced in its own act.
    for (let moment = 0; moment < 12; moment += 1) act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("ten")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nudge" })).toBeNull();
  });

  it("lets the visitor send the nudge, and plays again from the first line", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    for (let moment = 0; moment < 6; moment += 1) act(() => void vi.advanceTimersByTime(1900));
    expect(screen.getByText("8 of 9")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    expect(screen.getByText("Sent")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1700));
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("Signed")).toBeTruthy();

    for (let moment = 0; moment < 4; moment += 1) act(() => void vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.queryByText("two")).toBeNull();
    expect(screen.queryByText("9 of 9")).toBeNull();
  });
});
