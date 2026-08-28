// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { adviseRequests, type DepartureShape } from "@/lib/request-advisor";
import { addDepartureHref, RequestDayGroup, requestAdviceLines } from "./RequestDayGroup";

afterEach(cleanup);

const t = staffTranslator("en-US");

const MANTIS: DepartureShape = {
  hulls: [{ id: "b1", name: "Mantis II", capacity: 12 }],
  diversPerDivemaster: 6,
};

/** A day's worth of leads, as the advisor takes them. */
function party(...sizes: number[]) {
  return sizes.map((divers, index) => ({
    id: `r${index}`,
    divers,
    experienceLevel: "certified" as const,
    courseId: null,
  }));
}

/**
 * **The act the count exists for** (ADR 20260827-people-not-lists, decision 5).
 *
 * The group's one secondary opens the schedule builder on that day with the
 * full add form disclosed (ADR 20260806-one-trip-create-form) and the day's
 * leads carried forward as invitations. Losing any one of those three
 * parameters turns "four groups could make the 12th" back into a note
 * somewhere, and the loss is silent — the link still works, it just lands on
 * an empty form.
 */
describe("the add-a-departure link", () => {
  it("carries the day, the disclosed form and every lead in the group", () => {
    const href = addDepartureHref("blue-mantis", "2027-03-06", ["r1", "r2"]);
    const url = new URL(href, "https://diveday.test");
    expect(url.pathname).toBe("/shop/blue-mantis/schedule/board");
    expect(url.searchParams.get("add")).toBe("full");
    expect(url.searchParams.get("date")).toBe("2027-03-06");
    expect(url.searchParams.get("requests")).toBe("r1,r2");
  });

  it("is the one act on a day group, and renders with the href it was given", () => {
    render(
      <RequestDayGroup
        id="date-2027-03-06"
        label="Mar 6, 2027 — 2 groups · 5 divers"
        add={{
          href: addDepartureHref("blue-mantis", "2027-03-06", ["r1"]),
          label: "Add a departure",
        }}
      >
        <li>a request</li>
      </RequestDayGroup>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toContain("date=2027-03-06");
  });

  it("does not render on the undated tail — there is no day to put a boat on", () => {
    render(
      <RequestDayGroup id="no-date" label="No date named — 1 request">
        <li>a request</li>
      </RequestDayGroup>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "No date named — 1 request" }),
    ).toBeTruthy();
  });
});

/**
 * **The group header owns the shared facts, so the advice states only what the
 * label cannot.** The retired "Planning suggestion" card opened by counting the
 * divers and the requests — the two numbers now in the label one line above it.
 */
describe("the day's advice", () => {
  it("names the hull that fits and the crew the shop's own target implies", () => {
    const lines = requestAdviceLines(adviseRequests(party(3, 2), MANTIS), 6, t);
    expect(lines.map((line) => line.text)).toEqual([
      "Suggested boat: Mantis II (12 seats)",
      "Bring 1 divemaster — your 6:1 target.",
    ]);
    expect(lines.every((line) => line.tone === undefined)).toBe(true);
  });

  it("states a party no hull holds in words, not in colour alone", () => {
    const lines = requestAdviceLines(
      adviseRequests(party(6, 6), {
        hulls: [{ id: "b1", name: "Skiff", capacity: 4 }],
        diversPerDivemaster: 6,
      }),
      6,
      t,
    );
    const exceeded = lines.find((line) => line.tone === "warning");
    expect(exceeded?.text).toBe("Party size exceeds largest boat capacity.");
    expect(lines.some((line) => line.text.startsWith("Suggested boat"))).toBe(false);
  });

  it("names no boat for a shop that runs none, and still crews the day", () => {
    const lines = requestAdviceLines(
      adviseRequests(party(4), { hulls: null, diversPerDivemaster: 6 }),
      6,
      t,
    );
    expect(lines.map((line) => line.text)).toEqual(["Bring 1 divemaster — your 6:1 target."]);
  });

  it("renders the parts as one quiet line under the label", () => {
    const { container } = render(
      <RequestDayGroup
        id="date-2027-03-06"
        label="Mar 6, 2027 — 2 groups · 5 divers"
        advice={requestAdviceLines(adviseRequests(party(3, 2), MANTIS), 6, t)}
      >
        <li>a request</li>
      </RequestDayGroup>,
    );
    // One paragraph, not a stack of them: the parts read as a sentence about
    // the day rather than as a card's worth of bullet lines.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe(
      "Suggested boat: Mantis II (12 seats) · Bring 1 divemaster — your 6:1 target.",
    );
  });
});
