// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { assembleEveningClose } from "@/features/today/closeout";
import { assembleDaySpine, todaysBoatsAreClear } from "@/features/today/today";

vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  keepRentalFitAction: vi.fn(),
  acknowledgeCrewAwayAction: vi.fn(),
  helpRequestAction: vi.fn(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
const { action, boat, closed, departure, evening, NOW, renderSpine } = await import(
  "./day-spine-test-fixtures"
);
afterEach(cleanup);

it("shows a trip-level warning and suppresses the day's all-clear", () => {
  const departures = [departure({ retainedSafetyUnresolved: true })];
  const actions = [
    action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
    action({ id: "later", kind: "waiver", departure: boat("t9") }),
  ];
  const spine = assembleDaySpine({ departures, actions }, { departures: [], actions: [] });
  expect(todaysBoatsAreClear(spine)).toBe(false);
  renderSpine({ departures, actions });
  expect(screen.getByText(/Unresolved safety evidence needs review/)).toBeTruthy();
  expect(screen.queryByText(/today.s boats are all clear/i)).toBeNull();
});

it("does not claim an evening boat or its people are all home over unresolved evidence", () => {
  const reading = evening([closed({ tripId: "t1", retainedSafetyUnresolved: true })]);
  expect(reading.close.allHome).toBe(false);
  renderSpine({ departures: [], evening: reading });
  expect(screen.getByText(/Unresolved safety evidence needs review/)).toBeTruthy();
  expect(screen.queryByText(/everyone.*home/i)).toBeNull();
});

it("shows an unresolved carryover and suppresses an otherwise clear evening", () => {
  const [carryover] = evening([closed({ tripId: "older", retainedSafetyUnresolved: true })]).close
    .stations;
  if (!carryover) throw new Error("carryover missing");
  const reading = evening([closed({ tripId: "current" })]);
  reading.close = assembleEveningClose([closed({ tripId: "current" })], NOW, null, carryover);
  expect(reading.close.allHome).toBe(false);
  renderSpine({ departures: [], evening: reading });
  expect(screen.getByText(/Unresolved safety evidence needs review/)).toBeTruthy();
});

it("shows a warning for unresolved evidence outside today's stations", () => {
  const departures = [departure()];
  const actions = [
    action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
    action({ id: "later", kind: "waiver", departure: boat("t9") }),
  ];
  const spine = assembleDaySpine(
    { departures, actions, retainedSafetyUnresolved: true },
    { departures: [], actions: [] },
  );
  expect(todaysBoatsAreClear(spine)).toBe(false);
  renderSpine({ departures, actions, retainedSafetyUnresolved: true });
  expect(screen.getByText(/Unresolved safety evidence needs review/)).toBeTruthy();
  expect(screen.queryByText(/today.s boats are all clear/i)).toBeNull();
});

it("surfaces a delivery problem even when its trip is outside today's stations", () => {
  renderSpine({
    departures: [],
    retainedSafetyUnresolved: true,
    retainedSafetyAlertNeedsReview: true,
  });
  expect(screen.getByText(/A safety review alert needs attention/)).toBeTruthy();
  expect(screen.queryByText(/today.s boats are all clear/i)).toBeNull();
});
