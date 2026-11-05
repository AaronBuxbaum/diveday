// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { OfflineDeckCount } from "./DeckCount";

afterEach(cleanup);

const t = staffTranslator("en-US");
const counts = [
  {
    checkpoint: "departure",
    counted: 0,
    recordedAt: "2026-09-11T12:30:00.000Z",
    recordedByName: "Keiko Tanaka",
  },
  {
    checkpoint: "after_dive_1",
    counted: 11,
    recordedAt: "2026-09-11T15:00:00.000Z",
    recordedByName: "Sal Moretti",
  },
];
const show = (checkpoint: string, list: typeof counts | null = counts) =>
  render(
    <OfflineDeckCount
      counts={list ?? undefined}
      checkpoint={checkpoint}
      timeZone="America/New_York"
      locale="en-US"
      t={t}
    />,
  );

describe("OfflineDeckCount", () => {
  it("shows the count at this checkpoint, read only, with who and when", () => {
    show("after_dive_1");
    expect(screen.getByText(/Deck count 11 at 11:00 AM, Sal Moretti/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("shows a count of zero rather than treating it as nothing", () => {
    show("departure");
    expect(screen.getByText(/Deck count 0 at 8:30 AM, Keiko Tanaka/)).toBeTruthy();
  });

  it("never carries another checkpoint's count over", () => {
    const { container } = show("after_dive_2");
    expect(container.textContent).toBe("");
  });

  it("renders nothing on a copy saved before the field existed", () => {
    const { container } = show("departure", null);
    expect(container.textContent).toBe("");
  });
});
