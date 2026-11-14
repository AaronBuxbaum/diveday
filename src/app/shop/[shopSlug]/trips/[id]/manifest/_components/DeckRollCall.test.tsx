// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DeckRollCall } from "./DeckRollCall";
import { diver, diverContext, notBackAt } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

function selectedDetails(buddiesEnabled = true, subject: "diver" | "crew" = "diver") {
  const context = diverContext({
    checkpoint: "departure",
    isDeparture: true,
    divers: [
      diver({
        bookingId: "bea",
        fullName: "Bea Chen",
        buddyTeam: {
          teamId: "team",
          others: [{ kind: "diver", bookingId: "ari", fullName: "Ari Chen" }],
        },
      }),
      diver({ bookingId: "ari", fullName: "Ari Chen", rollCall: notBackAt() }),
    ],
  });
  const crew = [
    {
      id: "crew-bea",
      fullName: "Bea Chen",
      roles: ["divemaster"],
      standingRatings: [],
      buddyTeams: [
        {
          teamId: "crew-team",
          others: [{ kind: "crew", personId: "crew-ari", fullName: "Ari Chen" }],
        },
      ],
    },
    {
      id: "crew-ari",
      fullName: "Ari Chen",
      roles: ["divemaster"],
      standingRatings: [],
      rollCall: notBackAt(),
    },
  ];
  const deck = DeckRollCall({
    view: {
      manifest: {
        trip: { id: context.tripId },
        divers: context.divers,
        crew,
        completeness: { complete: false },
      },
      rollCall: {
        divers: context,
        crew: {
          ...context,
          crew,
          crewRollCallAction: context.rollCallAction,
          crewRollCallButtonCopy: context.rollCallButtonCopy("crew-bea"),
        },
      },
      actions: { rollCall: context.rollCallAction, crewRollCall: context.rollCallAction },
      checkpoint: "departure",
      isDeparture: true,
      reader: { alerted: new Set() },
    } as never,
    checkpoint: "Before departure",
    details: null,
    buddiesEnabled,
  });
  const person = deck.props.people.find(
    (item: { id: string }) => item.id === (subject === "crew" ? "crew-bea" : "bea"),
  );
  render(person.details);
  fireEvent.click(screen.getByRole("button", { name: "Open details for Bea Chen" }));
  return screen.getByRole("dialog");
}

it("shows the selected guest's buddy's recorded ashore status without rendering the buddy's controls", () => {
  const dialog = selectedDetails();
  const buddy = within(dialog).getByText("Ari Chen").closest("li");
  expect(buddy).toHaveTextContent("Not boarded");
  expect(buddy).not.toHaveTextContent("Awaiting");
  expect(screen.queryByRole("button", { name: "Open details for Ari Chen" })).toBeNull();
});

it("keeps buddy reference hidden when buddy planning is disabled", () => {
  const dialog = selectedDetails(false);
  expect(within(dialog).queryByText("Ari Chen")).toBeNull();
  expect(within(dialog).queryByText("Buddy team")).toBeNull();
});

it("shows a selected crew member's buddy's recorded ashore status without rendering the buddy's controls", () => {
  const dialog = selectedDetails(true, "crew");
  const buddy = within(dialog).getByText("Ari Chen").closest("li");
  expect(buddy).toHaveTextContent("Not boarded");
  expect(buddy).not.toHaveTextContent("Awaiting");
  expect(screen.queryByRole("button", { name: "Open details for Ari Chen" })).toBeNull();
});

it("hides a selected crew member's buddy reference when buddy planning is disabled", () => {
  const dialog = selectedDetails(false, "crew");
  expect(within(dialog).queryByText("Ari Chen")).toBeNull();
  expect(within(dialog).queryByText("Buddy team")).toBeNull();
});
