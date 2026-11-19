// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GroupChatLabels, MarketingGroupChat } from "./MarketingGroupChat";

const LINES = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);

const labels: GroupChatLabels = {
  group: "Crew",
  members: "Sal, Keiko, Marcus, and you",
  stamp: "Tuesday",
  names: { sal: "Sal", keiko: "Keiko", marcus: "Marcus" },
  typing: { sal: "Sal is typing", keiko: "Keiko is typing", marcus: "Marcus is typing" },
  avatars: { sal: null, keiko: null, marcus: null },
  lines: LINES,
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

/** The moment on screen and how long it lasts, as the chat states them. */
function moment() {
  const root = document.querySelector("[data-chat-frame]");
  return {
    frame: Number(root?.getAttribute("data-chat-frame")),
    ms: Number(root?.getAttribute("data-chat-ms")),
    end: root?.hasAttribute("data-chat-end") ?? false,
  };
}

/** Run the clock for exactly the current moment, so the chat moves one moment on. */
const nextMoment = () => act(() => void vi.advanceTimersByTime(moment().ms));

/** What a visitor sees in one moment: who is typing and how many lines are up. */
const seen = () => ({
  typing: screen.queryByText(/is typing$/)?.textContent ?? null,
  lines: LINES.filter((line) => screen.queryByText(line, { exact: true })).length,
});

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
    expect(html).toContain("line 20");
    expect(html).not.toContain("8 of 9");
  });

  it("stays finished for a reader who asked for reduced motion", () => {
    stubBrowser({ reducedMotion: true });
    render(<MarketingGroupChat labels={labels} />);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.queryByText("Sal is typing")).toBeNull();
  });

  it("rewinds, then plays the scene in uneven beats and sends the nudge itself if nobody does", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    expect(screen.getByText("line 1")).toBeTruthy();
    expect(screen.queryByText("line 2")).toBeNull();

    const beats: { ms: number; typing: string | null; lines: number }[] = [];
    while (!moment().end) {
      beats.push({ ms: moment().ms, ...seen() });
      nextMoment();
    }
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("line 20")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nudge" })).toBeNull();

    // About half a minute, nudge included.
    const total = beats.reduce((sum, beat) => sum + beat.ms, 0);
    expect(total).toBeGreaterThanOrEqual(27_000);
    expect(total).toBeLessThanOrEqual(35_000);
    // Not one rhythm: the moments range from a blink to a long silence.
    const lengths = beats.map((beat) => beat.ms);
    expect(new Set(lengths).size).toBeGreaterThanOrEqual(10);
    expect(Math.min(...lengths)).toBeLessThanOrEqual(300);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(2000);
    // Somebody starts typing, stops, and starts again before their line lands.
    const fakeOut = beats.some(
      (beat, index) =>
        beat.typing &&
        beats[index + 1]?.typing === null &&
        beats[index + 1]?.lines === beat.lines &&
        beats[index + 2]?.typing === beat.typing,
    );
    expect(fakeOut).toBe(true);
    // And some lines land with no dots at all.
    const instant = beats.filter(
      (beat, index) => beat.typing === null && (beats[index + 1]?.lines ?? 20) > beat.lines,
    );
    expect(instant.length).toBeGreaterThanOrEqual(3);
  });

  it("lets the visitor send the nudge, and plays again from the first line", () => {
    stubBrowser({ reducedMotion: false });
    render(<MarketingGroupChat labels={labels} />);
    while (!screen.queryByText("8 of 9")) nextMoment();
    expect(screen.getByText("line 17")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    expect(screen.getByText("Sent")).toBeTruthy();
    nextMoment();
    expect(screen.getByText("9 of 9")).toBeTruthy();
    expect(screen.getByText("Signed")).toBeTruthy();

    while (!moment().end) nextMoment();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.queryByText("line 2")).toBeNull();
    expect(screen.queryByText("9 of 9")).toBeNull();
  });
});
