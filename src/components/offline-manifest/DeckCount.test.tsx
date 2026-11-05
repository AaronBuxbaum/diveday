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
    recordedAt: "2026-07-21T12:30:00.000Z",
    recordedByName: "Keiko Tanaka",
  },
  {
    checkpoint: "after_dive_1",
    counted: 11,
    recordedAt: "2026-07-21T13:00:00.000Z",
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
  it("asks for a recount, with no current count, when the marks moved after it", () => {
    render(
      <OfflineDeckCount
        counts={[{ ...counts[1], stale: true }]}
        checkpoint="after_dive_1"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText(/before the last mark\. Count again\./)).toBeTruthy();
    expect(screen.queryByText(/Read only/)).toBeNull();
  });

  it("names the date of a count from an earlier day", () => {
    render(
      <OfflineDeckCount
        counts={[{ ...counts[0], recordedAt: "2000-01-01T12:30:00.000Z" }]}
        checkpoint="departure"
        timeZone="America/New_York"
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText(/Jan 1/)).toBeTruthy();
  });

  it("shows the count at this checkpoint, read only, with who and when", () => {
    show("after_dive_1");
    expect(screen.getByText(/Deck count 11 at 9:00\sAM, Sal Moretti/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("shows a count of zero rather than treating it as nothing", () => {
    show("departure");
    expect(screen.getByText(/Deck count 0 at 8:30\sAM, Keiko Tanaka/)).toBeTruthy();
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
