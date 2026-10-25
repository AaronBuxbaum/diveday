// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallRecord, TripManifest } from "@/lib/manifests";
import { CrewRollCall } from "./CrewRollCall";
import { DiverRollCall } from "./DiverRollCall";
import { diver, diverContext } from "./diver-roll-call-test-fixtures";
import { PreDepartureCheckList, type PreDepartureCheckListCopy } from "./PreDepartureCheckList";

/**
 * **The packet's paper** (visual review 2026-10-24, B03, B55): the trip
 * packet composes the manifest as paper, and its screen view is then the
 * sheet. Adversarial on the three things a safety sheet must never do when it
 * is reorganized: lose a soul, lose a recorded mark or who made it, or lose a
 * medical alert's words on the print that carries them. And it renders no
 * control at all, so nothing on the packet's screen can be tapped into a
 * roll call.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");
const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";

function controls(container: HTMLElement) {
  return container.querySelectorAll("button, select, textarea, input, form, a, details, dialog");
}

function boarded(name: string): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: new Date("2026-07-21T11:02:00.000Z"),
    recordedByName: name,
  } as RollCallRecord;
}

describe("the manifest's divers on the packet's paper", () => {
  function renderPaper(divers: TripManifest["divers"]) {
    return render(
      <DiverRollCall
        context={diverContext({
          checkpoint: "departure",
          isDeparture: true,
          timezone: "America/New_York",
          divers,
          paper: true,
          printedMedicalAlerts: {
            texts: new Map([["b-1", ALERT]]),
            printedBy: "Dana Owner",
            printedAt: new Date("2026-07-21T11:15:00.000Z"),
          },
        })}
      />,
    );
  }

  it("keeps every soul, a soul with no name included, in manifest order", () => {
    const { container } = renderPaper([
      diver({ bookingId: "b-1", fullName: "Sana Malik", medicalAlert: true }),
      diver({ bookingId: "b-2", fullName: "" }),
      diver({ bookingId: "b-3", fullName: "Ana Ruiz", rollCall: boarded("Sal Moretti") }),
    ]);
    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/^01\s*Sana Malik/);
    expect(rows[1]).toHaveTextContent(/^02/);
    expect(rows[2]).toHaveTextContent(/^03\s*Ana Ruiz/);
  });

  it("keeps a recorded mark, its recorder and its time on the row", () => {
    const { container } = renderPaper([
      diver({ bookingId: "b-3", fullName: "Ana Ruiz", rollCall: boarded("Sal Moretti") }),
    ]);
    const [row] = within(container).getAllByRole("listitem");
    expect(row).toHaveTextContent("Boarded");
    expect(row).toHaveTextContent("Sal Moretti");
    expect(row).toHaveTextContent(/7:02/);
  });

  it("keeps a blocked diver visibly blocked", () => {
    const { container } = renderPaper([
      diver({
        bookingId: "b-4",
        fullName: "Priya Sharma",
        readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
      } as Partial<TripManifest["divers"][number]>),
    ]);
    const row = container.querySelector("#diver-row-b-4");
    expect(row).toHaveTextContent(/Blocked/);
    expect(row).toHaveClass("border-danger");
  });

  it("carries the printed medical alert's words under the diver, and the note once", () => {
    const { container } = renderPaper([
      diver({ bookingId: "b-1", fullName: "Sana Malik", medicalAlert: true }),
      diver({ bookingId: "b-2", fullName: "Ana Ruiz" }),
    ]);
    const rows = within(container).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(ALERT);
    expect(rows[1]).not.toHaveTextContent(ALERT);
    expect(within(container).getAllByText(t("manifest.medicalAlertsPrintedKeep"))).toHaveLength(1);
  });

  it("renders no control: no sheet behind a name, no mark to tap", () => {
    const { container } = renderPaper([
      diver({ bookingId: "b-1", fullName: "Sana Malik", medicalAlert: true }),
      diver({ bookingId: "b-3", fullName: "Ana Ruiz", rollCall: boarded("Sal Moretti") }),
    ]);
    expect(controls(container)).toHaveLength(0);
  });

  it("shows the printed facts on the packet's screen, which marks them print-only", () => {
    const { container } = renderPaper([diver({ bookingId: "b-1", fullName: "Sana Malik" })]);
    const printed = container.querySelectorAll("[data-print-only]");
    expect(printed.length).toBeGreaterThan(0);
    for (const block of printed) expect(block).toHaveClass("hidden", "print:block");
  });
});

describe("the crew on the packet's paper", () => {
  const member = (overrides: Partial<TripManifest["crew"][number]>) =>
    ({
      id: "00000000-0000-4000-8000-0000000000c1",
      fullName: "Keiko Tanaka",
      roles: ["divemaster"],
      standingRatings: [],
      emergencyContactName: "Haru Tanaka",
      emergencyContactPhone: "+81-3-555-0103",
      buddyTeams: [],
      buddyAlert: null,
      ...overrides,
    }) as TripManifest["crew"][number];

  function renderCrew(crew: TripManifest["crew"]) {
    return render(
      <CrewRollCall
        crew={crew}
        checkpoint="departure"
        isDeparture
        shopSlug="blue-mantis"
        tripId="00000000-0000-4000-8000-0000000000ff"
        locale="en-US"
        timezone="America/New_York"
        crewRollCallAction={vi.fn(async () => ({ ok: true }) as const)}
        crewRollCallButtonCopy={{ errorRefusal: "Try again", blockedMessage: "Blocked" }}
        buddyTeamLabel={() => null}
        paper
        t={t}
      />,
    );
  }

  it("keeps every crew member with the recorded mark and who made it, and no control or link", () => {
    const { container } = renderCrew([
      member({}),
      member({
        id: "00000000-0000-4000-8000-0000000000c2",
        fullName: "Sal Moretti",
        roles: ["captain"],
        rollCall: boarded("Yusra Idrissi"),
      }),
    ]);
    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Keiko Tanaka");
    expect(rows[1]).toHaveTextContent("Sal Moretti");
    expect(rows[1]).toHaveTextContent(/Boarded.*Yusra Idrissi/);
    expect(container).not.toHaveTextContent(t("manifest.manageCrewOnTrip"));
    expect(controls(container)).toHaveLength(0);
  });

  it("still says the crew is unnamed on a boat with none, without the link to add them", () => {
    const { container } = renderCrew([]);
    expect(container).toHaveTextContent(t("manifest.noCrew"));
    expect(controls(container)).toHaveLength(0);
  });
});

describe("the boat check on the packet's paper", () => {
  const copy = {
    heading: "Before you leave the dock",
    summary: "Before you leave the dock — 1 of 2 checked",
    errorRefusal: "That check did not save.",
    checkedLabel: "Checked",
    uncheckedLabel: "Not checked",
    confirmClear: "Tap again to clear",
    snagsHeading: "Open on this boat",
    snagFixed: "Fixed",
    snagStillThere: "Still there",
    snagSaving: "Saving…",
    noteProblem: "Note a problem",
    noteItemLabel: "Which item?",
    noteLabel: "What’s wrong?",
    noteSave: "Save note",
    noteRefused: "Write what’s wrong, up to 280 characters.",
  } satisfies PreDepartureCheckListCopy;

  it("prints every item with its state and every open snag, and no check to tap", () => {
    const { container } = render(
      <PreDepartureCheckList
        action={vi.fn()}
        atDeparture
        copy={copy}
        paper
        items={[
          {
            id: "oxygen",
            label: "Emergency oxygen kit aboard",
            checkedByLine: "Checked by the recorder · 7:12 AM",
            printLine: "Emergency oxygen kit aboard — Checked by the recorder · 7:12 AM",
          },
          {
            id: "radio",
            label: "Radio check done",
            printLine: "Radio check done — Not checked",
            snags: [
              {
                id: "s-1",
                line: "VHF radio: Mic cuts out",
                note: "Mic cuts out",
                notedBy: "Sal",
                printLine: "Open: Mic cuts out",
              },
            ],
          },
        ]}
        carried={[
          {
            id: "s-2",
            line: "Bilge alarm",
            note: "Bilge alarm",
            notedBy: "Keiko",
            printLine: "Open: Bilge alarm",
          },
        ]}
      />,
    );
    expect(container).toHaveTextContent("Emergency oxygen kit aboard — Checked by the recorder");
    expect(container).toHaveTextContent("Radio check done — Not checked");
    expect(container).toHaveTextContent("Open: Mic cuts out");
    expect(container).toHaveTextContent("Open: Bilge alarm");
    expect(controls(container)).toHaveLength(0);
  });
});
