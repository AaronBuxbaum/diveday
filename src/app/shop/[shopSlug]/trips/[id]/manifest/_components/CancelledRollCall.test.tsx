// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripManifest } from "@/lib/manifests";
import { CancelledRollCallBanner } from "./CancelledRollCallBanner";
import { CrewRollCall } from "./CrewRollCall";
import { DiverRollCall } from "./DiverRollCall";
import { boardedAt, diver, diverContext, TRANSLATORS, t } from "./diver-roll-call-test-fixtures";

/**
 * **A cancelled departure nobody counted on reads closed** (#2285). Every
 * roll-call write on it is refused (`rollCallOpenOnTrip`), so the page draws no
 * control that could only end in a refusal: no mark on the row, no exception
 * or back-aboard control in the person's sheet, diver or crew. The names and
 * what is recorded stay readable. One already counting heads keeps every
 * control, and says why.
 */

afterEach(cleanup);

/** Every roll-call submit on screen: each `RollCallButton` posts a status. */
function rollCallForms(): Element[] {
  return [...document.querySelectorAll('input[type="hidden"][name="status"]')];
}

const crewMember = {
  id: "00000000-0000-4000-8000-0000000000c1",
  fullName: "Keiko Tanaka",
  roles: ["divemaster"],
  standingRatings: [],
  emergencyContactName: "Haru Tanaka",
  emergencyContactPhone: "+81-3-555-0103",
  buddyTeams: [],
  buddyAlert: null,
} as unknown as TripManifest["crew"][number];

function renderCrew(rollCallClosed: boolean, checkpoint: "departure" | "after_dive_1") {
  return render(
    <CrewRollCall
      crew={[crewMember]}
      checkpoint={checkpoint}
      isDeparture={checkpoint === "departure"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale="en-US"
      timezone="America/New_York"
      crewRollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      crewRollCallButtonCopy={{ errorRefusal: "Try again", blockedMessage: "Blocked" }}
      buddyTeamLabel={() => null}
      rollCallClosed={rollCallClosed}
      t={t}
    />,
  );
}

describe("the diver roll call of a cancelled departure nobody counted on", () => {
  for (const checkpoint of ["departure", "after_dive_1"] as const) {
    it(`draws no roll-call control on the row or in the sheet (${checkpoint})`, () => {
      render(
        <DiverRollCall
          context={diverContext({
            divers: [diver()],
            checkpoint,
            isDeparture: checkpoint === "departure",
            rollCallClosed: true,
          })}
        />,
      );
      expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
      expect(rollCallForms()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
      expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /Mark/ })).toBeNull();
      expect(rollCallForms()).toHaveLength(0);
    });
  }

  it("keeps every control while the count is open", () => {
    render(<DiverRollCall context={diverContext({ divers: [diver()], rollCallClosed: false })} />);
    expect(screen.getByRole("button", { name: "Mark boarded" })).toBeInTheDocument();
  });

  it("still shows what was recorded, without the tap", () => {
    render(
      <DiverRollCall
        context={diverContext({ divers: [diver({ rollCall: boardedAt() })], rollCallClosed: true })}
      />,
    );
    expect(rollCallForms()).toHaveLength(0);
    expect(screen.getAllByText(/Keiko Tanaka/).length).toBeGreaterThan(0);
  });
});

describe("the crew roll call of a cancelled departure nobody counted on", () => {
  for (const checkpoint of ["departure", "after_dive_1"] as const) {
    it(`draws no roll-call control on the row or in the sheet (${checkpoint})`, () => {
      renderCrew(true, checkpoint);
      expect(screen.getByText("Keiko Tanaka")).toBeInTheDocument();
      expect(rollCallForms()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Open details for Keiko Tanaka" }));
      expect(rollCallForms()).toHaveLength(0);
    });
  }

  it("keeps the tap while the count is open", () => {
    renderCrew(false, "after_dive_1");
    expect(screen.getByRole("button", { name: "Mark aboard" })).toBeInTheDocument();
  });
});

describe("CancelledRollCallBanner", () => {
  for (const [locale, words] of Object.entries(TRANSLATORS)) {
    it(`says the roll call is closed when nobody was counted (${locale})`, () => {
      render(<CancelledRollCallBanner state="closed" t={words} />);
      expect(screen.getByRole("status")).toHaveTextContent(
        words("manifest.cancelledRollCallClosed"),
      );
    });

    it(`says the count stays open once it had begun (${locale})`, () => {
      render(<CancelledRollCallBanner state="still_counting" t={words} />);
      expect(screen.getByRole("status")).toHaveTextContent(
        words("manifest.cancelledRollCallStillCounting"),
      );
    });
  }

  it("draws nothing for a departure that is not cancelled", () => {
    const { container } = render(<CancelledRollCallBanner state={null} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
