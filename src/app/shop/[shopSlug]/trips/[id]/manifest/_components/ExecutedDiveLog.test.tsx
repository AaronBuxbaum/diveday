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
    crew_call: "The crew's call",
  },
  planChangeNote: "Note for the shop",
  planChangeNoteHint: "Divers never see this.",
  save: "Save dive record",
  saved: "Dive record saved.",
  refusals: {
    times_transposed: "The exit time must be after the entry time.",
    depth_out_of_range: "That depth is outside what this form accepts.",
    dive_number_out_of_range: "This departure does not plan a dive with that number.",
    unknown_site: "That dive site is not one of this shop's live sites.",
    unknown_trip: "This departure is no longer on the board.",
    unknown_recorder: "Your staff record was not found.",
    invalid_time: "One of the times could not be read.",
    invalid: "Nothing was saved.",
    wrong_dive: "This form is for a different dive.",
    plan_change_note_without_reason: "Choose why the plan changed, then save the note.",
    plan_change_note_too_long: "That note is too long.",
  },
};

function renderLog(summaryLine: string, executed: ExecutedDiveLogRow[] = []) {
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
      depthUnit="meters"
      checkpoint="after_dive_1"
    />,
  );
}

type ExecutedDiveLogRow = {
  executed: ExecutedDive;
  actualSite: { id: string; name: string } | null;
};

describe("the executed-dive record is collapsed, and paper still carries it", () => {
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

  it("restates the summary outside the disclosure, where print can reach it", () => {
    const { container } = renderLog("Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47");

    const disclosure = container.querySelector("details");
    // A closed `<details>` prints nothing, and the packet's stylesheet hides
    // every input inside `.trip-print-bundle` anyway — so what paper carried
    // here was a blank form. The line outside is what it carries instead.
    const printed = [...container.querySelectorAll<HTMLElement>("p")].find(
      (node) => node.className.includes("print:block") && !disclosure?.contains(node),
    );
    expect(printed?.textContent).toBe("Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47");
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
