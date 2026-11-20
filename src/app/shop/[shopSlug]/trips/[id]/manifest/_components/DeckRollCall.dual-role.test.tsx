// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RollCallAction } from "../../_components/RollCallButton";
import { DeckRollCall } from "./DeckRollCall";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import { boardedAt, diver, diverContext, notBackAt } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

function dualRole(state: "boarded" | "missing" | "awaiting" | "conflict" = "boarded") {
  const guestAction = vi.fn<RollCallAction>(
    async () => ({ ok: true, eventId: "guest-new", status: "boarded" }) as const,
  );
  const crewAction = vi.fn<RollCallAction>(
    async () => ({ ok: true, eventId: "crew-new", status: "boarded" }) as const,
  );
  const divers = ["Shared Person", "Guest Two", "Guest Three", "Guest Four"].map(
    (fullName, index) =>
      diver({
        bookingId: `seat-${index}`,
        personId: `person-${index}`,
        fullName,
        rollCall: boardedAt(),
      }),
  );
  const crew: DiverRollCallContext["crew"] = ["Shared Person", "Crew Two", "Crew Three"].map(
    (fullName, index) => ({
      id: index === 0 ? "person-0" : `crew-${index}`,
      fullName,
      roles: ["divemaster"],
      standingRatings: [],
      emergencyContactName: null,
      emergencyContactPhone: null,
      buddyAlert: null,
      rollCall: boardedAt(),
    }),
  );
  if (state === "missing") divers[0].rollCall = notBackAt();
  if (state === "awaiting") {
    divers[0].rollCall = undefined;
    crew[0].rollCall = undefined;
  }
  if (state === "conflict") divers[0].rollCallContext = { conflict: true } as never;
  const context = diverContext({ divers, crew, rollCallAction: guestAction });
  const view = {
    manifest: {
      trip: { id: context.tripId },
      summary: {},
      divers,
      crew,
      completeness: { complete: state === "boarded" },
    },
    rollCall: {
      divers: context,
      crew: {
        ...context,
        crew,
        crewRollCallAction: crewAction,
        crewRollCallButtonCopy: context.rollCallButtonCopy("person-0"),
      },
    },
    actions: { rollCall: guestAction, crewRollCall: crewAction },
    checkpoint: "after_dive_1",
    isDeparture: false,
    reader: { alerted: new Set() },
  };
  render(
    DeckRollCall({
      view: view as never,
      checkpoint: "After dive 1",
      details: null,
      buddiesEnabled: true,
    }),
  );
  return { guestAction, crewAction };
}

it("counts six physical people while retaining seven independently selectable role records", () => {
  const { guestAction, crewAction } = dualRole();
  expect(screen.getByText("6 of 6 people accounted for")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  expect(screen.getByRole("button", { name: "Shared Person · Guest" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Shared Person · Crew" })).toBeVisible();
  expect(guestAction).not.toHaveBeenCalled();
  expect(crewAction).not.toHaveBeenCalled();
});

it.each(["missing", "awaiting", "conflict"] as const)(
  "keeps the shared person unresolved for a %s guest role despite independent crew evidence",
  (state) => {
    dualRole(state);
    expect(screen.getByText("5 of 6 people accounted for")).toBeVisible();
    expect(screen.queryByText("Everyone is accounted for")).toBeNull();
  },
);

it("records guest and crew roles in separate scalar submissions with separate receipts", async () => {
  const { guestAction, crewAction } = dualRole("awaiting");
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Shared Person · Guest" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record Shared Person aboard" })),
  );
  expect(guestAction).toHaveBeenCalledTimes(1);
  expect(crewAction).not.toHaveBeenCalled();
  const guest = guestAction.mock.calls[0]?.[1] as unknown as FormData;
  expect(guest.get("bookingId")).toBe("seat-0");
  expect(guest.get("status")).toBe("boarded");
  expect(guest.has("personId")).toBe(false);
  expect(screen.getByText("Aboard recorded")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Shared Person · Crew" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record Shared Person aboard" })),
  );
  expect(guestAction).toHaveBeenCalledTimes(1);
  expect(crewAction).toHaveBeenCalledTimes(1);
  const member = crewAction.mock.calls[0]?.[1] as unknown as FormData;
  expect(member.get("personId")).toBe("person-0");
  expect(member.get("status")).toBe("boarded");
  expect(member.has("bookingId")).toBe(false);
  expect(screen.getByText("Aboard recorded")).toBeVisible();
});

it.each(["Guest", "Crew"] as const)(
  "posts the named %s role's scalar ordinary status",
  async (role) => {
    const { guestAction, crewAction } = dualRole("awaiting");
    const action = role === "Guest" ? guestAction : crewAction;
    const other = role === "Guest" ? crewAction : guestAction;
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: `Shared Person · ${role}` }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Record Shared Person aboard" })),
    );
    expect(action).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    const posted = action.mock.calls[0]?.[1];
    expect(posted?.get("status")).toBe("boarded");
    expect(posted?.get(role === "Guest" ? "bookingId" : "personId")).toBe(
      role === "Guest" ? "seat-0" : "person-0",
    );
    expect(posted?.has(role === "Guest" ? "personId" : "bookingId")).toBe(false);
  },
);
