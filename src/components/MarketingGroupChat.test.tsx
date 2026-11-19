// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GroupChatLabels, MarketingGroupChat } from "./MarketingGroupChat";

const LINES = Array.from({ length: 16 }, (_, index) => `line ${index + 1}`);

const labels: GroupChatLabels = {
  group: "Crew",
  members: "Sal, Keiko, Marcus, and you",
  stamp: "Tuesday",
  names: { sal: "Sal", keiko: "Keiko", marcus: "Marcus" },
  typing: { sal: "Sal is typing", keiko: "Keiko is typing", marcus: "Marcus is typing" },
  avatars: { sal: null, keiko: null, marcus: null },
  lines: LINES,
  photos: { tom: <span>photo of Tom</span>, tomasz: null, boat: null },
  card: {
    title: "Tomorrow",
    readyBefore: "8 of 9",
    readyAfter: "9 of 9",
    needsYou: "Needs you",
    diver: "Tom",
    avatar: null,
    unsigned: "Not signed",
    nudge: "Nudge",
    sent: "Sent",
    signed: "Signed",
  },
  composer: "Message",
  replay: "Play again",
  note: "note",
};

/** One timer per moment, so each moment is advanced in its own act; no moment lasts longer than this. */
const MOMENT_MS = 4000;
const nextMoment = () => act(() => void vi.advanceTimersByTime(MOMENT_MS));

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
    expect(html).toContain("line 16");
    expect(html).not.toContain("8 of 9");
  });

  it("stays finished for a reader who asked for reduced motion", () => {
    stubBrowser({ reducedMotion: true });
    render(<MarketingGroupChat labels={labels} />);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.queryByText("Sal is typing")).toBeNull();
  });

  it("rewinds, lands each line after its sender's dots, and sends the nudge itself if nobody does", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    expect(screen.getByText("line 1")).toBeTruthy();
    expect(screen.queryByText("line 2")).toBeNull();
    expect(screen.getByText("Sal is typing")).toBeTruthy();

    nextMoment();
    expect(screen.getByText("line 2")).toBeTruthy();
    // The fourth line is a photo with its caption.
    nextMoment();
    expect(screen.queryByText("photo of Tom")).toBeNull();
    nextMoment();
    expect(screen.getByText("photo of Tom")).toBeTruthy();

    for (let moment = 0; moment < 20; moment += 1) nextMoment();
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("line 16")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nudge" })).toBeNull();
  });

  it("lets the visitor send the nudge, and plays again from the first line", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    // Twelve lines land after the first before the owner's answer brings the list.
    for (let moment = 0; moment < 12; moment += 1) nextMoment();
    expect(screen.getByText("8 of 9")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    expect(screen.getByText("Sent")).toBeTruthy();
    nextMoment();
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("Signed")).toBeTruthy();

    for (let moment = 0; moment < 4; moment += 1) nextMoment();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.queryByText("line 2")).toBeNull();
    expect(screen.queryByText("9 of 9")).toBeNull();
  });
});
