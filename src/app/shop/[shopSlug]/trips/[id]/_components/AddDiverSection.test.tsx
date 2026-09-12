// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { AddDiverSection } from "./AddDiverSection";

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/trips/trip-1/guests",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const action = (_formData: FormData) => {};

describe("AddDiverSection", () => {
  it("renders search form and add diver link when trip is not full", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query=""
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
        timeZone="America/Cancun"
      />,
    );

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add diver" }).at(-1)).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?surface=trip-guests&tripId=trip-1",
    );
  });

  it("offers waitlist addition directly when trip is full", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={true}
        query=""
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
        timeZone="America/Cancun"
      />,
    );

    expect(screen.getByRole("link", { name: "Add to wait list" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?surface=trip-guests&tripId=trip-1&waitlist=true",
    );
  });

  it("offers direct add-diver link with prefill when no matches are found", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query="Nobody Here"
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
        timeZone="America/Cancun"
      />,
    );

    expect(screen.getByText("No returning diver matches “Nobody Here”.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add diver" })[1]).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?name=Nobody+Here&surface=trip-guests&tripId=trip-1",
    );
  });

  it("keeps one add diver button when matching returning divers are listed", () => {
    const candidate = {
      person: { id: "person-1", fullName: "Avery Diver", email: "avery@example.com" },
      rentalFit: null,
    } as unknown as BookableDiver;

    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query="Avery"
        candidates={[candidate]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
        timeZone="America/Cancun"
      />,
    );

    expect(screen.getByText("Avery Diver")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add diver" })).toHaveLength(1);
    expect(screen.queryByText("Not listed?")).toBeNull();
  });
});

/**
 * The counter prompt (issue #1556). A list of five names answers nothing — the
 * name is what the staffer just typed — so each candidate carries the last day
 * this shop had them on a boat, and picking one is marked as the guess it is.
 */
describe("AddDiverSection name-match prompt", () => {
  const match = (over: Partial<SimilarDiver>): SimilarDiver => ({
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

  const renderPrompt = (
    confirmMatches: SimilarDiver[],
    search: { query?: string; candidates?: BookableDiver[] } = {},
  ) =>
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query={search.query ?? ""}
        candidates={search.candidates ?? []}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
        timeZone="America/Cancun"
        confirmName="Nadia Ruis"
        confirmMatches={confirmMatches}
      />,
    );

  /**
   * `people.phone` holds E.164 since #1547, so the number beside a candidate's
   * name is grouped for the staffer reading it against what they typed (#1712).
   */
  it("groups a candidate's stored number", () => {
    renderPrompt([match({ email: "nadia@example.test", phone: "+13055550142" })]);

    expect(screen.getByText("(nadia@example.test, +1 305 555 0142)")).toBeInTheDocument();
  });

  it("asks the owner's question by name and names the stake", () => {
    renderPrompt([match({})]);

    expect(
      screen.getByRole("heading", {
        name: "Is this the same Nadia Ruis? Picking one reuses that diver’s record, and their certifications and waiver only count once someone confirms it’s the same person.",
      }),
    ).toBeInTheDocument();
  });

  it("dates a candidate's last dive day in the shop's zone", () => {
    // 00:30 UTC on the 27th is still the evening of the 26th in Cancún, so a
    // line that read the server's zone would name the wrong day.
    renderPrompt([match({ lastDiveDayAt: new Date("2026-08-27T00:30:00Z") })]);

    expect(screen.getByText("Last dive day here: Wed, Aug 26")).toBeInTheDocument();
  });

  it("says nothing about dive days when this shop has one for nobody on the list", () => {
    // The line would be true of every genuine first-timer and of every
    // candidate this shop has only ever typed in, so here it distinguishes
    // nobody from nobody.
    renderPrompt([match({ lastDiveDayAt: null })]);

    expect(screen.queryByText(/Last dive day here/)).toBeNull();
    expect(screen.queryByText("No dive days here yet")).toBeNull();
  });

  it("names the candidate with no dive day once a sibling has one", () => {
    // The finding (`dive-domain-expert`, 2026-09-11): a blank beside a date
    // reads as "the one with the date is the real diver", which biases the tap
    // toward the record that already has cards — the wrong way round when the
    // namesake at the counter is the first-timer.
    renderPrompt([
      match({ lastDiveDayAt: new Date("2026-08-27T00:30:00Z") }),
      match({ id: "person-3", fullName: "Nadia Ruiseco" }),
    ]);

    expect(screen.getByText("Last dive day here: Wed, Aug 26")).toBeInTheDocument();
    expect(screen.getByText("No dive days here yet")).toBeInTheDocument();
  });

  it("marks the pick as a name match, so the seat it takes is identity-unconfirmed", () => {
    // The search picker renders *beside* the prompt, because the count below
    // is the whole assertion: a prompt rendered alone would pass it however
    // many flags the picker grew.
    const { container } = renderPrompt([match({})], {
      query: "Avery",
      candidates: [searchCandidate],
    });

    const candidateForm = screen.getByRole("button", { name: "Nadia Ruiz" }).closest("form");
    expect(candidateForm?.querySelector('input[name="fromNameMatch"]')).toHaveValue("true");
    // ...along with the name it was guessing from, which is what the booking
    // compares: the prompt lists an exact match too, and flagging that seat is
    // how a shop learns to tap confirm identity without reading it.
    expect(candidateForm?.querySelector('input[name="nameMatchQuery"]')).toHaveValue("Nadia Ruis");
    expect(screen.getByText("Avery Diver")).toBeInTheDocument();
    // ...and only there. The picker seats a diver a staffer went looking for
    // and found, and "create a new diver anyway" invents nobody's history —
    // if either raised the flag, every seat would land blocked and the counter
    // would learn to tap past it.
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(1);
  });
});
