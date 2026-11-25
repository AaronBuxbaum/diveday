// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutedDive } from "@/db/schema";
import { DEFAULT_FLY_SAFE_HOURS, flySafeFrom } from "@/lib/fly-safe";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";
import { type ExecutedDiveLabels, ExecutedDiveLog } from "./ExecutedDiveLog";

/**
 * **Issue #1055 — the executed-dive record stays on the boat, collapsed.**
 *
 * ADR 20260827-the-departure-is-two-working-surfaces calls the manifest an
 * instrument, and this was the largest form in the trip namespace standing
 * fully open at every after-dive checkpoint: roughly a third of a 2,700px
 * phone, between the roll call and the buddy panel, on the screen where a crew
 * is counting bodies.
 *
 * The answer was **collapse**, not **move ashore**: the surface interval is
 * when a divemaster still has the numbers in their head and the shop has no
 * signal. So what is pinned here is the pair that makes that true — the form
 * is behind a tap, and the state it carries is still stated without one.
 *
 * Deliberately not a screenshot. What matters is that a crew can read the
 * dive's state at rest and reach the form in one gesture; the layout is free
 * to move.
 */

afterEach(cleanup);

const labels: ExecutedDiveLabels = {
  heading: "What happened underwater",
  actualSite: "Actual site",
  unknown: "Not recorded",
  maxDepth: "Maximum depth (m)",
  diveDate: "Dive date",
  changeDiveDate: "Change dive date",
  enteredAt: "Entered the water",
  exitedAt: "Exited the water",
  visibility: "Visibility",
  current: "Current",
  notRecordedDepth: "Depth was not recorded",
  observedSpecies: "Seen on this dive",
  observedSpeciesHint: "Divers read this on their recap.",
  observedSpeciesNone: "Nothing to note",
  speciesAddTyped: "Add “{name}”",
  speciesPlaceholder: "Something else? Search species",
  planChangeReason: "Why the plan changed",
  planChangeReasonOptions: {
    current: "Current",
    weather: "Weather",
    visibility: "Visibility",
    crew_call: "The crew’s call",
  },
  planChangeNote: "Note for the shop",
  planChangeNoteHint: "Divers never see this.",
  optional: "(optional)",
  save: "Save dive record",
  saved: "Dive record saved.",
  refusals: {
    times_transposed: "The exit time must be after the entry time.",
    depth_out_of_range: "That depth is outside what this form accepts.",
    dive_number_out_of_range: "This departure does not plan a dive with that number.",
    unknown_site: "That dive site is not one of this shop’s live sites.",
    unknown_trip: "This departure is no longer on the board.",
    unknown_recorder: "Your staff record was not found.",
    invalid_time: "One of the times could not be read.",
    invalid: "Nothing was saved.",
    wrong_dive: "This form is for a different dive.",
    plan_change_note_without_reason: "Choose why the plan changed, then save the note.",
    plan_change_note_too_long: "That note is too long.",
  },
};

function renderLog(
  summaryLine: string,
  executed: ExecutedDiveLogRow[] = [],
  sightingsOn = true,
  depthUnit: "meters" | "feet" = "meters",
  multiDay = false,
  tripStartTime = "",
) {
  return render(
    <ExecutedDiveLog
      tripDate="2026-08-01"
      multiDay={multiDay}
      tripStartTime={tripStartTime}
      planned={[
        {
          diveNumber: 1,
          diveSite: { id: "site-1", name: "Molasses Reef" },
          diveLabel: "Dive 1",
          plannedSiteLabel: "Planned site: Molasses Reef",
          summaryLine,
        },
      ]}
      liveDiveSites={[
        { id: "site-1", name: "Molasses Reef" },
        { id: "site-2", name: "French Reef" },
      ]}
      catalogSpecies={[
        { slug: "blue-tang", name: "Blue tang" },
        { slug: "spotted-eagle-ray", name: "Spotted eagle ray" },
      ]}
      speciesBySite={{ "site-1": [{ slug: "blue-tang", name: "Blue tang" }] }}
      executed={executed}
      action={vi.fn(async () => ({ status: "saved" }) as never)}
      labels={labels}
      timeZone="America/New_York"
      depthUnit={depthUnit}
      checkpoint="after_dive_1"
      sightingsOn={sightingsOn}
    />,
  );
}

type ExecutedDiveLogRow = {
  executed: ExecutedDive;
  actualSite: { id: string; name: string } | null;
};

// Paper carries the summary line on the Boat tab's sheet (`BoatTabSheet.test.tsx`).
describe("the executed-dive record is collapsed", () => {
  it("shows the summary line at rest and keeps the form behind a tap", () => {
    const { container } = renderLog("Dive 1 — not recorded yet");

    const disclosure = container.querySelector("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    // The state a crew reads without opening anything.
    expect(container.querySelector("summary")?.textContent).toContain("Dive 1 — not recorded yet");

    // The form is inside the disclosure, so a closed row claims no screen and
    // contributes nothing to print.
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(disclosure?.contains(form as Node)).toBe(true);
  });

  it("opens itself when a “Log this dive” link lands on its hash", () => {
    window.location.hash = "#executed-dive";
    try {
      const { container } = renderLog("Dive 1 — not recorded yet");
      expect(container.querySelector("details")?.open).toBe(true);
    } finally {
      window.location.hash = "";
    }
  });

  it("uses the departure date with time-only entry and exit fields", async () => {
    renderLog("Dive 1 — not recorded yet");
    const entry = screen.getByLabelText("Entered the water (optional)");
    const exit = screen.getByLabelText("Exited the water (optional)");
    await userEvent.type(entry, "23:40");
    await userEvent.type(exit, "00:20");
    expect(document.querySelector<HTMLInputElement>('input[name="enteredAt"]')?.value).toBe(
      "2026-08-01T23:40",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-02T00:20",
    );
  });

  it("asks for the actual date on a multi-day trip and keeps it on time edits", async () => {
    renderLog("Dive 1 — not recorded yet", [], true, "meters", true);
    const date = screen.getByLabelText("Dive date (optional)");
    const entry = screen.getByLabelText("Entered the water (optional)");
    const exit = screen.getByLabelText("Exited the water (optional)");
    expect(date).toHaveProperty("value", "");
    await userEvent.type(date, "2026-08-03");
    await userEvent.type(entry, "09:00");
    await userEvent.type(exit, "09:50");
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-03T09:50",
    );
    await userEvent.clear(exit);
    await userEvent.type(exit, "09:55");
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-03T09:55",
    );
    const value = document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value ?? "";
    const [day, time] = value.split("T");
    const wall = parseWallTime(day, time);
    if (!wall) throw new Error("missing exit time");
    const exitAt = wallTimeToUtc(wall, "America/New_York");
    const advice = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: exitAt }],
      plannedDives: 1,
      endsAt: new Date("2026-08-03T15:00:00Z"),
      divedRecently: false,
      now: new Date("2026-08-03T16:00:00Z"),
      hours: DEFAULT_FLY_SAFE_HOURS,
    });
    expect(advice?.from).toEqual(new Date("2026-08-04T07:55:00Z"));
  });

  it("infers the next day when a same-day boat runs past midnight", async () => {
    renderLog("Dive 1", [], true, "meters", false, "17:30");
    await userEvent.type(screen.getByLabelText("Entered the water (optional)"), "00:10");
    await userEvent.type(screen.getByLabelText("Exited the water (optional)"), "00:50");
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-02T00:50",
    );
  });

  it("infers midnight for a dive lasting about an hour", async () => {
    renderLog("Dive 1");
    await userEvent.type(screen.getByLabelText("Entered the water (optional)"), "22:59");
    await userEvent.type(screen.getByLabelText("Exited the water (optional)"), "00:00");
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-02T00:00",
    );
  });

  it("keeps a saved later dive date when changing its time", async () => {
    const logged = {
      executed: {
        diveNumber: 1,
        enteredAt: new Date("2026-08-03T13:00:00Z"),
        exitedAt: new Date("2026-08-03T13:50:00Z"),
        maxDepthMeters: null,
        observedConditions: null,
        notRecorded: [],
        observedSpeciesSlug: null,
        planChangeReason: null,
        planChangeNote: null,
      } as unknown as ExecutedDive,
      actualSite: { id: "site-1", name: "Molasses Reef" },
    };
    renderLog("Dive 1", [logged], true, "meters", true);
    const exit = screen.getByLabelText("Exited the water (optional)");
    await userEvent.clear(exit);
    await userEvent.type(exit, "09:55");
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-03T09:55",
    );
  });

  it("preserves a recorded overnight exit even when the dive lasted over two hours", () => {
    const logged = {
      executed: {
        diveNumber: 1,
        enteredAt: new Date("2026-08-02T00:30:00Z"),
        exitedAt: new Date("2026-08-02T04:30:00Z"),
        maxDepthMeters: null,
        observedConditions: null,
        notRecorded: [],
        observedSpeciesSlug: null,
        planChangeReason: null,
        planChangeNote: null,
      } as unknown as ExecutedDive,
      actualSite: { id: "site-1", name: "Molasses Reef" },
    };
    renderLog("Dive 1", [logged]);
    expect(document.querySelector<HTMLInputElement>('input[name="exitedAt"]')?.value).toBe(
      "2026-08-02T00:30",
    );
  });

  it("preserves a saved plan-change explanation when the plan now matches", () => {
    const logged = {
      executed: {
        diveNumber: 1,
        enteredAt: null,
        exitedAt: null,
        maxDepthMeters: null,
        observedConditions: null,
        notRecorded: [],
        observedSpeciesSlug: null,
        planChangeReason: "weather",
        planChangeNote: "Wind picked up",
      } as unknown as ExecutedDive,
      actualSite: { id: "site-1", name: "Molasses Reef" },
    };
    renderLog("Dive 1", [logged]);
    expect(screen.queryByText("Why the plan changed")).toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[name="planChangeReason"]')?.value).toBe(
      "weather",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="planChangeNote"]')?.value).toBe(
      "Wind picked up",
    );
  });

  it("clears a change explanation when staff correct the site to the plan", async () => {
    const logged = {
      executed: {
        diveNumber: 1,
        enteredAt: null,
        exitedAt: null,
        maxDepthMeters: null,
        observedConditions: null,
        notRecorded: [],
        observedSpeciesSlug: null,
        planChangeReason: "weather",
        planChangeNote: "Wind picked up",
      } as unknown as ExecutedDive,
      actualSite: { id: "site-2", name: "French Reef" },
    };
    renderLog("Dive 1", [logged]);
    const site = screen.getByLabelText("Actual site (optional)");
    await userEvent.clear(site);
    await userEvent.type(site, "Molasses Reef");
    expect(document.querySelector<HTMLInputElement>('input[name="planChangeReason"]')?.value).toBe(
      "",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="planChangeNote"]')?.value).toBe(
      "",
    );
  });

  it("renders only the dive the crew is standing at", () => {
    renderLog("Dive 1 — not recorded yet");
    // One checkpoint, one dive: `after_dive_1` shows dive 1 and nothing else.
    expect(screen.getAllByText(/Dive 1/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Dive 2/)).toBeNull();
  });
});

/**
 * **The catalog is the domain; the site's guide is the ordering** (issue #1190,
 * corrected by a dive-domain review on 2026-09-04).
 *
 * The first version bounded the picker *to* the site's field guide, which had
 * it exactly backwards: a guide is at most eight faces a shop names because
 * that reef shows them reliably, so the eagle ray and the nurse shark are in
 * the catalog and on nobody's eight. The bounded picker admitted the blue tang
 * and refused the thing anyone would climb the ladder talking about.
 *
 * This pins both halves — the memorable one is reachable, and the ordinary one
 * is still first — because the two are one `filter` apart and a refactor that
 * dropped the ordering would be invisible in a diff.
 */
const entries = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[name="observedSpeciesEntries"]')].map(
    (element) => JSON.parse(element.value),
  );

describe("the species picker", () => {
  it("offers the site's species as chips, and the rest of the catalog by search", async () => {
    renderLog("Dive 1 — not recorded yet");
    const chip = screen.getByRole("button", { name: "Blue tang" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Spotted eagle ray" })).toBeNull();

    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(screen.getByPlaceholderText("Something else? Search species"), "eagle");
    await userEvent.click(screen.getByRole("button", { name: "Spotted eagle ray" }));
    expect(entries()).toEqual([
      { slug: "blue-tang", name: null },
      { slug: "spotted-eagle-ray", name: null },
    ]);

    // A second tap takes a sighting back.
    await userEvent.click(chip);
    expect(entries()).toEqual([{ slug: "spotted-eagle-ray", name: null }]);
  });

  it("has no Add button: a pick is added on the tap", () => {
    renderLog("Dive 1 — not recorded yet");
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("only asks why when the actual site differs from the plan", async () => {
    renderLog("Dive 1 — not recorded yet");
    expect(screen.queryByText("Why the plan changed")).toBeNull();
    await userEvent.clear(screen.getByLabelText("Actual site (optional)"));
    expect(screen.getByText("Why the plan changed")).toBeTruthy();
  });

  it("draws the speciesShown marker beside the picker, so the save writes what it posts", () => {
    renderLog("Dive 1 — not recorded yet");

    const marker = document.querySelector<HTMLInputElement>('input[name="speciesShown"]');
    expect(marker?.type).toBe("hidden");
    expect(marker?.value).toBe("1");
  });

  it("keeps catalog and free-text species when the site changes", async () => {
    renderLog("Dive 1 — not recorded yet");
    const picker = screen.getByPlaceholderText("Something else? Search species");
    await userEvent.type(picker, "Spotted eagle ray{Enter}");
    await userEvent.type(picker, "Tiny shrimp");
    await userEvent.click(screen.getByRole("button", { name: "Add “Tiny shrimp”" }));
    await userEvent.clear(screen.getByLabelText("Actual site (optional)"));
    expect(entries()).toEqual([
      { slug: "spotted-eagle-ray", name: null },
      { slug: null, name: "Tiny shrimp" },
    ]);
  });
});

/**
 * **Sightings switched off** (ADR 20261005-optional-shop-features): the dive
 * log draws no species field and no `speciesShown` marker, and the save keeps
 * the species logged before because the marker is absent.
 */
describe("the dive log with sightings switched off", () => {
  it("hides the species picker and posts neither a species nor the marker", () => {
    const logged = {
      executed: {
        diveNumber: 1,
        actualSiteId: "site-1",
        enteredAt: null,
        exitedAt: null,
        maxDepthMeters: null,
        observedConditions: null,
        notRecorded: [],
        observedSpeciesSlug: "spotted-eagle-ray",
        planChangeReason: null,
        planChangeNote: null,
      } as unknown as ExecutedDive,
      actualSite: { id: "site-1", name: "Molasses Reef" },
    };
    renderLog("Dive 1 — Molasses Reef", [logged], false);

    expect(document.querySelector('select[name="observedSpeciesSlug"]')).toBeNull();
    expect(screen.queryByText("Seen on this dive")).toBeNull();
    expect(document.querySelector('[name="observedSpeciesSlug"]')).toBeNull();
    expect(document.querySelector('[name="speciesShown"]')).toBeNull();
  });
});

describe("recorded depth evidence", () => {
  function depthForm(meters: number | null, unit: "meters" | "feet") {
    const row = {
      executed: {
        diveNumber: 1,
        maxDepthMeters: meters,
        notRecorded: [],
      } as unknown as ExecutedDive,
      actualSite: null,
    };
    const { container } = renderLog("Dive 1", [row], true, unit);
    return container.querySelector("form") as HTMLFormElement;
  }

  it.each([
    [20.4, "meters", "20.4"],
    [18.4404, "feet", "60.5"],
  ] as const)(
    "keeps %s meters exactly when editing only another field (%s)",
    async (meters, unit, shown) => {
      const form = depthForm(meters, unit);
      const depth = screen.getByLabelText("Maximum depth (m) (optional)");
      expect((depth as HTMLInputElement).value).toBe(shown);
      await userEvent.type(screen.getByLabelText("Visibility (optional)"), "Clear");
      const posted = new FormData(form);
      expect(posted.get("maxDepthMeters")).toBe(String(meters));
      expect(posted.get("depthUnit")).toBe("meters");
      expect(new FormData(form).get("maxDepthMeters")).toBe(String(meters));
    },
  );

  it("posts an intentional edit with the unit the crew used", async () => {
    const form = depthForm(18.4404, "feet");
    const depth = screen.getByLabelText("Maximum depth (m) (optional)");
    await userEvent.clear(depth);
    await userEvent.type(depth, "62.5");
    const posted = new FormData(form);
    expect(posted.get("maxDepthMeters")).toBe("62.5");
    expect(posted.get("depthUnit")).toBe("feet");
  });

  it("honors an intentional edit to the same displayed tenth", async () => {
    const form = depthForm(20.44, "meters");
    const depth = screen.getByLabelText("Maximum depth (m) (optional)");
    expect((depth as HTMLInputElement).value).toBe("20.4");
    expect(new FormData(form).get("maxDepthMeters")).toBe("20.44");
    await userEvent.clear(depth);
    await userEvent.type(depth, "20.4");
    expect(new FormData(form).get("maxDepthMeters")).toBe("20.4");
  });

  it("keeps an unrecorded depth blank", () => {
    const form = depthForm(null, "feet");
    expect(new FormData(form).get("maxDepthMeters")).toBe("");
  });
});

it("keeps the shown unit with an open edit across a preference refresh", async () => {
  const props = {
    planned: [
      {
        diveNumber: 1,
        diveSite: null,
        diveLabel: "Dive 1",
        plannedSiteLabel: "Planned",
        summaryLine: "Dive 1",
      },
    ],
    liveDiveSites: [],
    catalogSpecies: [],
    speciesBySite: {},
    executed: [],
    action: vi.fn(async () => ({ status: "ok" as const })),
    timeZone: "UTC",
    checkpoint: "after_dive_1" as const,
  };
  const view = render(
    <ExecutedDiveLog
      tripDate="2026-08-01"
      {...props}
      labels={{ ...labels, maxDepth: "Maximum depth (feet)" }}
      depthUnit="feet"
    />,
  );
  view.rerender(
    <ExecutedDiveLog
      tripDate="2026-08-01"
      {...props}
      labels={{ ...labels, maxDepth: "Maximum depth (meters)" }}
      depthUnit="meters"
    />,
  );
  const field = screen.getByLabelText("Maximum depth (feet) (optional)");
  await userEvent.type(field, "60");
  const data = new FormData(view.container.querySelector("form") as HTMLFormElement);
  expect(data.get("depthUnit")).toBe("feet");
  expect(data.get("maxDepthMeters")).toBe("60");
  expect(field.getAttribute("max")).toBe("984");
});
