// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutedDive } from "@/db/schema";
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
  enteredAt: "Entered the water",
  exitedAt: "Exited the water",
  visibility: "Visibility",
  current: "Current",
  notRecordedDepth: "Depth was not recorded",
  observedSpecies: "Seen on this dive",
  observedSpeciesHint: "Divers read this on their recap.",
  observedSpeciesNone: "Nothing to note",
  planChangeReason: "Why the plan changed",
  planChangeReasonOptions: {
    current: "Current",
    weather: "Weather",
    visibility: "Visibility",
    crew_call: "The crew’s call",
  },
  planChangeNote: "Note for the shop",
  planChangeNoteHint: "Divers never see this.",
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
) {
  return render(
    <ExecutedDiveLog
      planned={[
        {
          diveNumber: 1,
          diveSite: { id: "site-1", name: "Molasses Reef" },
          diveLabel: "Dive 1",
          plannedSiteLabel: "Planned site: Molasses Reef",
          summaryLine,
        },
      ]}
      liveDiveSites={[{ id: "site-1", name: "Molasses Reef" }]}
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
describe("the species picker", () => {
  function speciesOptions() {
    const select = document.querySelector(
      'select[name="observedSpeciesSlug"]',
    ) as HTMLSelectElement | null;
    if (!select) throw new Error("species picker is not mounted");
    return [...select.options].map((option) => option.value);
  }

  it("offers every species DiveDay carries, with this site's own faces first", () => {
    renderLog("Dive 1 — not recorded yet");

    // "Nothing to note" leads, because most dives are most dives.
    expect(speciesOptions()[0]).toBe("");
    // The site's guide next…
    expect(speciesOptions()[1]).toBe("blue-tang");
    // …and the animal nobody promises in a briefing is still reachable, which
    // is the whole correction.
    expect(speciesOptions()).toContain("spotted-eagle-ray");
  });

  it("draws the speciesShown marker beside the picker, so the save writes what it posts", () => {
    renderLog("Dive 1 — not recorded yet");

    const marker = document.querySelector<HTMLInputElement>('input[name="speciesShown"]');
    expect(marker?.type).toBe("hidden");
    expect(marker?.value).toBe("1");
  });

  it("keeps a chosen species when the crew changes the site", async () => {
    // A sighting is a claim about a moment, not about a row in the site
    // library, so re-picking the site reorders the list and drops nothing.
    renderLog("Dive 1 — not recorded yet");
    const picker = document.querySelector(
      'select[name="observedSpeciesSlug"]',
    ) as HTMLSelectElement;
    await userEvent.selectOptions(picker, "spotted-eagle-ray");
    expect(picker.value).toBe("spotted-eagle-ray");

    await userEvent.selectOptions(
      document.querySelector('select[name="actualSiteId"]') as HTMLSelectElement,
      "",
    );
    expect(
      (document.querySelector('select[name="observedSpeciesSlug"]') as HTMLSelectElement).value,
    ).toBe("spotted-eagle-ray");
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
      const depth = screen.getByLabelText("Maximum depth (m)");
      expect((depth as HTMLInputElement).value).toBe(shown);
      await userEvent.type(screen.getByLabelText("Visibility"), "Clear");
      const posted = new FormData(form);
      expect(posted.get("maxDepthMeters")).toBe(String(meters));
      expect(posted.get("depthUnit")).toBe("meters");
      expect(new FormData(form).get("maxDepthMeters")).toBe(String(meters));
    },
  );

  it("posts an intentional edit with the unit the crew used", async () => {
    const form = depthForm(18.4404, "feet");
    const depth = screen.getByLabelText("Maximum depth (m)");
    await userEvent.clear(depth);
    await userEvent.type(depth, "62.5");
    const posted = new FormData(form);
    expect(posted.get("maxDepthMeters")).toBe("62.5");
    expect(posted.get("depthUnit")).toBe("feet");
  });

  it("honors an intentional edit to the same displayed tenth", async () => {
    const form = depthForm(20.44, "meters");
    const depth = screen.getByLabelText("Maximum depth (m)");
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
      {...props}
      labels={{ ...labels, maxDepth: "Maximum depth (feet)" }}
      depthUnit="feet"
    />,
  );
  view.rerender(
    <ExecutedDiveLog
      {...props}
      labels={{ ...labels, maxDepth: "Maximum depth (meters)" }}
      depthUnit="meters"
    />,
  );
  const field = screen.getByLabelText("Maximum depth (feet)");
  await userEvent.type(field, "60");
  const data = new FormData(view.container.querySelector("form") as HTMLFormElement);
  expect(data.get("depthUnit")).toBe("feet");
  expect(data.get("maxDepthMeters")).toBe("60");
  expect(field.getAttribute("max")).toBe("984");
});
