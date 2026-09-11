// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { SeatDiverPanel, type SeatDiverPanelCopy } from "./SeatDiverPanel";

// Both forms on this panel are bound `"use server"` actions; what they do is
// `src/db/seat-diver.ts`'s and `src/app/actions/seat-diver.ts`'s business, not
// this suite's. What is this suite's business is which fields reach them.
vi.mock("@/app/actions/seat-diver", () => ({
  seatExistingDiverAction: vi.fn(),
  seatNewDiverAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/check-in/walk-in/trip-1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const copy: SeatDiverPanelCopy = {
  findHeading: "Find the diver",
  findLabel: "Name, email or phone",
  findPlaceholder: "Search",
  noEmailOnFile: "No email on file",
  adding: "Adding…",
  addLabel: "Add",
  addPersonAriaLabel: (name) => `Add ${name}`,
  noMatchesHeading: "No matches",
  noMatches: "No returning diver matches.",
  noMatchesAction: "Add diver",
  confirmMatchesTitle:
    "Is this the same Nadia Ruis? Picking one reuses that diver’s record, and their certifications and waiver only count once someone confirms it’s the same person.",
  confirmMatchesLastDive: (at) => `Last dive day here: ${at.toISOString().slice(0, 10)}`,
  confirmMatchesNoDiveDay: "No dive days here yet",
};

const match = (over: Partial<SimilarDiver> = {}): SimilarDiver => ({
  id: "person-1",
  fullName: "Nadia Ruiz",
  email: null,
  phone: null,
  lastDiveDayAt: null,
  ...over,
});

const searchCandidate = {
  person: { id: "person-2", fullName: "Avery Diver", email: "avery@example.com" },
  rentalFit: null,
} as unknown as BookableDiver;

function renderPanel(
  confirmMatches: SimilarDiver[],
  extra: { query?: string; candidates?: BookableDiver[] } = {},
) {
  return render(
    <SeatDiverPanel
      surface="walk-in"
      shopSlug="blue-mantis"
      tripId="trip-1"
      query={extra.query ?? ""}
      candidates={extra.candidates ?? []}
      copy={copy}
      confirmName="Nadia Ruis"
      confirmMatches={confirmMatches}
    />,
  );
}

/**
 * **The counter door's half of the name prompt** (issue #1556). This is the
 * panel a staffer uses with the diver standing in front of them — the walk-in
 * at check-in and the global add-booking door — so it is the one place the
 * guess is most likely to be taken for a pick.
 */
describe("SeatDiverPanel name-match prompt", () => {
  it("marks a tap on a candidate as the guess it is, and nothing else on the panel", () => {
    const { container } = renderPanel([match()], {
      query: "Avery",
      candidates: [searchCandidate],
    });

    const candidateForm = screen.getByRole("button", { name: "Nadia Ruiz" }).closest("form");
    expect(candidateForm?.querySelector('input[name="fromNameMatch"]')).toHaveValue("true");
    // ...along with the name it was guessing from. The prompt lists exact
    // matches beside the trigram guesses, so this is what lets the booking flag
    // the guess and leave the regular the desk spelled right alone.
    expect(candidateForm?.querySelector('input[name="nameMatchQuery"]')).toHaveValue("Nadia Ruis");
    // The search picker below submits the same action for a diver a staffer
    // went looking for and found, and "create new diver anyway" invents
    // nobody's history — neither may raise the flag, or every seat is blocked
    // and the counter learns to tap past it.
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(1);
  });

  it("carries the last dive day the page dated, and says so where there is none", () => {
    renderPanel([
      match({ lastDiveDayAt: new Date("2026-08-26T15:00:00Z") }),
      match({ id: "person-3", fullName: "Nadia Ruiseco" }),
    ]);

    expect(screen.getByText("Last dive day here: 2026-08-26")).toBeInTheDocument();
    // The blank is the whole finding (`dive-domain-expert`, 2026-09-11): a
    // candidate left silent beside a dated sibling reads as the lesser diver,
    // and the counter taps the record with the cards — which is the wrong
    // record exactly when the namesake at the desk is the first-timer.
    expect(screen.getByText("No dive days here yet")).toBeInTheDocument();
    expect(screen.getAllByText(/Last dive day here/)).toHaveLength(1);
  });

  it("says nothing about dive days when this shop has one for nobody on the list", () => {
    // Silence is honest here and the line is not: it would be true of every
    // genuine first-timer and of every candidate this shop has only ever typed
    // in, so it would distinguish nobody from nobody, twice over.
    renderPanel([match(), match({ id: "person-3", fullName: "Nadia Ruiseco" })]);

    expect(screen.queryByText("No dive days here yet")).toBeNull();
    expect(screen.queryByText(/Last dive day here/)).toBeNull();
  });

  it("heads the list with the question and the stake, never an empty heading", () => {
    renderPanel([match()]);

    expect(
      screen.getByRole("heading", {
        name: "Is this the same Nadia Ruis? Picking one reuses that diver’s record, and their certifications and waiver only count once someone confirms it’s the same person.",
      }),
    ).toBeInTheDocument();
  });
});
