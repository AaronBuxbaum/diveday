// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CrewedSessionSummary } from "@/db/today";
import { YourSessions } from "./YourSessions";

afterEach(cleanup);

const session = (over: Partial<CrewedSessionSummary> = {}): CrewedSessionSummary => ({
  tripId: "s1",
  title: "Scuba Refresher — half day",
  courseTitle: null,
  startsAt: new Date("2026-10-18T13:00:00.000Z"),
  booked: 2,
  ready: 2,
  blocked: 0,
  ...over,
});

function draw(sessions: CrewedSessionSummary[], locale = "en-US") {
  return render(
    <YourSessions
      sessions={sessions}
      shopSlug="blue-mantis"
      timeZone="America/New_York"
      locale={locale}
    />,
  );
}

/**
 * **The reader's own session on a day they said they are away** (fourth
 * review, item 12): "2 students · 2 ready · 0 blocked" read as all well on a
 * Sunday the instructor would not be there.
 */
describe("YourSessions", () => {
  it("says the reader is away on that session's days, in warning ink", () => {
    draw([
      session({
        away: [
          { id: "b", personId: "p", startsOn: "2026-10-17", endsOn: "2026-10-18", note: null },
        ],
      }),
    ]);
    const line = screen.getByText(/^You said you’re away/);
    expect(line.textContent?.replace(/\s/g, " ")).toBe(
      "You said you’re away Sat, Oct 17 – Sun, Oct 18.",
    );
    expect(line).toHaveClass("text-warning-strong");
  });

  it("says it in Spanish for a Spanish reader", () => {
    draw(
      [
        session({
          away: [
            { id: "b", personId: "p", startsOn: "2026-10-18", endsOn: "2026-10-18", note: null },
          ],
        }),
      ],
      "es-ES",
    );
    expect(screen.getByText(/^Avisaste que estás ausente/)).toBeTruthy();
  });

  it("says nothing about days away on a session the reader is there for", () => {
    draw([session(), session({ tripId: "s2", away: [] })]);
    expect(screen.queryByText(/away/)).toBeNull();
  });

  it("renders nothing for a reader who teaches nothing this week", () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });
});
