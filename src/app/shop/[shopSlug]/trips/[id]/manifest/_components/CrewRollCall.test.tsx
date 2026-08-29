// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
import { CrewRollCall } from "./CrewRollCall";

/**
 * **The crew half of the same two rules** slice 5a owes ADR
 * 20260827-the-departure-is-two-working-surfaces — and it needs its own file
 * rather than a shared one, because "written twice" is exactly how these two
 * lists came to disagree before (a green-checked "Not boarded ✓" beside a diver
 * who had not come back from dive one). A divemaster who did not surface is the
 * same claim about the same kind of body, so their row obeys the same
 * gestures as a diver's:
 *
 * - **decision 3** — the not-back path is not reachable in one tap from the
 *   list; it lives inside the person's own panel.
 * - **decision 4** — no danger tone at a checkpoint where nobody has recorded
 *   an exception.
 * - **ADR 20260815-offline-can-unsay-a-missing-diver** — over a stated
 *   missing-diver mark, asserting "aboard" is never the cheap direction and
 *   retracting is never the expensive one.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");

function crew(overrides: Partial<TripManifest["crew"][number]> = {}): TripManifest["crew"][number] {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    fullName: "Keiko Tanaka",
    roles: ["divemaster"],
    emergencyContactName: "Haru Tanaka",
    emergencyContactPhone: "+81-3-555-0103",
    buddyTeams: [],
    buddyAlert: null,
    ...overrides,
  } as TripManifest["crew"][number];
}

function notBackAt(): RollCallRecord {
  return {
    state: "not_boarded",
    occurredAt: new Date("2026-09-11T12:29:00.000Z"),
    recordedByName: "Sal Moretti",
  } as RollCallRecord;
}

function renderCrew({
  members,
  checkpoint = "after_dive_1",
}: {
  members: TripManifest["crew"];
  checkpoint?: RollCallCheckpoint;
}) {
  return render(
    <CrewRollCall
      crew={members}
      checkpoint={checkpoint}
      isDeparture={checkpoint === "departure"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale="en-US"
      timezone="America/New_York"
      crewRollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      crewRollCallButtonCopy={{ errorRefusal: "Try again", blockedMessage: "Blocked" }}
      buddyTeamLabel={() => null}
      t={t}
    />,
  );
}

function hiddenAtRest(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.classList.contains("hidden")) return true;
  }
  return false;
}

function dangerToned(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter(
    (element) =>
      /(^|[\s:/])(text|bg|border|ring|from|to|via)-danger(\b|-)/.test(element.className) &&
      !hiddenAtRest(element),
  );
}

function control(row: HTMLElement, name: string) {
  return [...row.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

describe("a crew row obeys the diver row's gestures", () => {
  it("carries the affirmative tap and hides the exception behind the person's panel", () => {
    renderCrew({ members: [crew()] });
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("button", { name: "Mark aboard" })).toBeVisible();
    const exception = control(row, "Mark not back aboard");
    expect(exception).toBeUndefined();
    expect(
      within(row).getByRole("button", { name: "Open details for Keiko Tanaka" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("renders nothing in danger tone with nothing recorded", () => {
    const { container } = renderCrew({ members: [crew()] });
    expect(dangerToned(container)).toHaveLength(0);
  });

  it("takes the row's tap away once a crew member is recorded not back", () => {
    const { container } = renderCrew({ members: [crew({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    // Both directions out of the alarm cost the same two gestures, and neither
    // is on the row: asserting a divemaster is aboard over a stated
    // missing-diver mark is the tap that turns the loudest row green.
    expect(within(row).queryByRole("button", { name: "Mark aboard" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Keiko Tanaka" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /^Mark back aboard/ })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Not back aboard" })).toBeVisible();
    // …and the alarm itself is on screen, earned by that record.
    expect(dangerToned(container).length).toBeGreaterThan(0);
  });
});
