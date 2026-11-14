// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfflineDeckRollCall } from "./DeckRollCall";
import { controls, diver, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

function dualRole(state: "boarded" | "missing" | "awaiting" = "boarded") {
  const copy = savedCopy();
  const manifest = copy.snapshot.manifests[0];
  const boarded = {
    state: "boarded" as const,
    occurredAt: copy.snapshot.savedAt,
    recordedByName: "Dana",
  };
  manifest.checkpoint = "after_dive_1";
  manifest.divers = ["Shared Person", "Guest Two", "Guest Three", "Guest Four"].map(
    (name, index) => ({
      ...diver(`seat-${index}`, name),
      personId: `person-${index}`,
      rollCall: boarded,
    }),
  );
  manifest.crew = ["Shared Person", "Crew Two", "Crew Three"].map((fullName, index) => ({
    id: index === 0 ? "person-0" : `crew-${index}`,
    fullName,
    roles: ["divemaster"],
    rollCall: boarded,
  }));
  if (state === "missing") manifest.divers[0].rollCall = { ...boarded, state: "not_boarded" };
  if (state === "awaiting") {
    manifest.divers[0].rollCall = undefined;
    manifest.crew[0].rollCall = undefined;
  }
  const view = offlineTripView(copy, "after_dive_1");
  if (!view) throw new Error("expected saved checkpoint");
  const ctx = controls();
  ctx.record = vi.fn(
    async () =>
      ({
        ok: true,
        observedAt: copy.snapshot.savedAt,
        eventId: "new-event",
        pending: true,
      }) as const,
  );
  render(<OfflineDeckRollCall view={view} controls={ctx} details={null} />);
  return ctx;
}

it("counts six physical people and offers separate named guest and crew navigation", () => {
  const ctx = dualRole();
  expect(screen.getByText("6 of 6 people accounted for")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  expect(screen.getByRole("button", { name: "Shared Person · Guest" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Shared Person · Crew" })).toBeVisible();
  expect(ctx.record).not.toHaveBeenCalled();
});

it("does not use a boarded crew role to clear a missing passenger role", () => {
  dualRole("missing");
  expect(screen.getByText("5 of 6 people accounted for")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Shared Person · Crew" }));
  expect(screen.getByText("Boarded", { exact: true })).toBeVisible();
});

it("records each role independently on this device and navigation creates no evidence", async () => {
  const ctx = dualRole("awaiting");
  expect(screen.getByText("5 of 6 people accounted for")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Shared Person · Guest" }));
  expect(ctx.record).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record Shared Person aboard" })),
  );
  expect(ctx.record).toHaveBeenCalledTimes(1);
  expect(ctx.record).toHaveBeenNthCalledWith(1, { bookingId: "seat-0" }, { status: "boarded" });
  expect(screen.getByText("Aboard recorded")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Shared Person · Crew" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record Shared Person aboard" })),
  );
  expect(ctx.record).toHaveBeenCalledTimes(2);
  expect(ctx.record).toHaveBeenNthCalledWith(
    2,
    { crewPersonId: "person-0" },
    { status: "boarded" },
  );
  expect(screen.getByText("Aboard recorded")).toBeVisible();
});
