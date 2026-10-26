// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowMs } from "@/lib/clock";
import { RescheduleNotice } from "./RescheduleNotice";

const edge = vi.hoisted(() => ({
  row: vi.fn(),
  undo: vi.fn(),
  release: vi.fn(),
  hold: vi.fn(),
}));
// Server-rendered notice data and actions are the component's external edges;
// query authorization and action gates retain their real database tests.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/held-sends", () => ({ pendingHeldSend: edge.row }));
vi.mock("@/db/trip-rescheduled", () => ({ heldRescheduleIsPlaceOnly: async () => false }));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: edge.hold,
  undoHeldSendAction: edge.undo,
  releaseHeldSendAction: edge.release,
}));

const HELD = "b0707cc2-aa54-4c28-b352-d29444f9478a";
const props = { shopId: "shop-a", heldId: HELD, tell: "2", t: staffTranslator("en-US") };
const row = {
  id: HELD,
  runAt: new Date(nowMs() + 8_000),
  payload: { kind: "trip_rescheduled", tripId: "trip-a" },
};
const notTold = props.t("shared.rescheduleHold.notTold");
const tellThem = props.t("shared.rescheduleHold.tellThem");

beforeEach(() => {
  vi.useFakeTimers();
  edge.row.mockResolvedValue(row);
  edge.undo.mockResolvedValue(true);
  edge.release.mockResolvedValue({ status: "gone" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("keeps a confirmed Undo across the action's row-absent route refresh", async () => {
  let resolve!: (value: boolean) => void;
  edge.undo.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const view = render(await RescheduleNotice(props));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(edge.undo).toHaveBeenCalledWith(HELD);
  edge.row.mockResolvedValue(null);
  view.rerender(await RescheduleNotice(props));
  await act(async () => resolve(true));
  expect(screen.getByText(notTold)).toBeVisible();
  expect(screen.getByRole("button", { name: tellThem })).toBeVisible();
});

it("keeps a successful Undo when its route refresh arrives afterward", async () => {
  const view = render(await RescheduleNotice(props));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  expect(screen.getByText(notTold)).toBeVisible();
  edge.row.mockResolvedValue(null);
  view.rerender(await RescheduleNotice(props));
  expect(screen.getByRole("button", { name: tellThem })).toBeVisible();
});

it.each(["absent", "foreign-shop", "other-kind", "wrong-trip"])(
  "offers no notice or Tell them for an initial %s row",
  async (reason) => {
    // pendingHeldSend returns null for a foreign shop; its real query gate is
    // covered separately. The component must not invent an outcome from null.
    if (reason === "absent" || reason === "foreign-shop") edge.row.mockResolvedValue(null);
    if (reason === "other-kind")
      edge.row.mockResolvedValue({ ...row, payload: { kind: "seat_offer" } });
    const scoped = reason === "wrong-trip" ? { ...props, tripId: "trip-b" } : props;
    const view = render(await RescheduleNotice(scoped));
    expect(view.container).toBeEmptyDOMElement();
    expect(edge.row).toHaveBeenCalledWith({}, props.shopId, HELD);
  },
);

it.each([{ heldId: "invalid" }, { tell: "0" }, { tell: "501" }, { tell: undefined }])(
  "rejects invalid query identity before reading a row: %j",
  async (override) => {
    const view = render(await RescheduleNotice({ ...props, ...override }));
    expect(view.container).toBeEmptyDOMElement();
    expect(edge.row).not.toHaveBeenCalled();
  },
);

it.each([
  { shopId: "shop-b" },
  { heldId: "9ffb8c63-600a-4f81-b1e3-a36daaa4d283" },
  { tripId: "trip-b" },
])("resets an Undo snapshot when its scoped identity changes: %j", async (identity) => {
  const view = render(await RescheduleNotice(props));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  expect(screen.getByRole("button", { name: tellThem })).toBeVisible();
  edge.row.mockResolvedValue(null);
  view.rerender(await RescheduleNotice({ ...props, ...identity }));
  expect(view.container).toBeEmptyDOMElement();
});

it("never treats an absent refresh or refused Undo as success; release-gone hides the row", async () => {
  edge.undo.mockResolvedValue(false);
  const view = render(await RescheduleNotice(props));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  edge.row.mockResolvedValue(null);
  view.rerender(await RescheduleNotice(props));
  expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  expect(screen.queryByText(notTold)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: tellThem })).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(8_000));
  expect(edge.release).toHaveBeenCalledWith(HELD);
  expect(view.container).toBeEmptyDOMElement();
});

it("reholds only the trip captured from the verified row after confirmed Undo", async () => {
  edge.hold.mockResolvedValue({ id: "new-hold", runAt: 0, holdMs: 8_000 });
  render(await RescheduleNotice(props));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: tellThem })));
  const form = edge.hold.mock.calls[0]?.[0];
  expect(form?.get("tripId")).toBe("trip-a");
  expect(form?.get("holdKind")).toBe("trip_rescheduled");
});
