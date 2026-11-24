// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BulkOffer, type BulkOfferBatch } from "./BulkOffer";
import { offerSeatCopy } from "./offer-seat-copy";

const held = vi.hoisted(() => ({
  hold: vi.fn(),
  release: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: held.hold,
  releaseHeldSendAction: held.release,
  undoHeldSendAction: held.undo,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const copy = offerSeatCopy(staffTranslator("en-US"));
const person = (id: string, name: string, email: string | null = `${id}@example.com`) => ({
  interestId: id,
  name,
  email,
});
const first: BulkOfferBatch = {
  interests: [person("a", "Ravi Menon"), person("b", "Hana Kobayashi")],
  names: "Ravi Menon and Hana Kobayashi each get the booking link by email.",
  send: "Send 2 offers",
  next: "Offer the next 2",
};
const second: BulkOfferBatch = {
  interests: [person("c", "Naledi Khumalo")],
  names: "Naledi Khumalo gets the booking link by email.",
  send: "Send the offer",
  next: "Offer the next in line",
};

const panel = (batch: BulkOfferBatch) => (
  <BulkOffer
    batch={batch}
    tripId="trip-1"
    bookingPath="/s/blue-mantis/trips/trip-1"
    shopName="Blue Mantis"
    tripTitle="Wreck Trip"
    tripWhen="Sat 15 Aug"
    copy={copy}
  />
);

const answers = (results: { interestId: string; delivery: string }[]) =>
  held.release.mockResolvedValue({ status: "done", outcome: { kind: "seat_offer", results } });

/** Press the batch's button and let the (zero-length) hold release. */
async function send(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await act(async () => {});
}

beforeEach(() => {
  held.hold.mockReset().mockResolvedValue({ id: "held-1", runAt: 0, holdMs: 0 });
  held.release.mockReset();
  held.undo.mockReset();
});
afterEach(cleanup);

describe("BulkOffer", () => {
  it("names everyone it writes to, and holds one seat_offer send for exactly them", async () => {
    answers([
      { interestId: "a", delivery: "sent" },
      { interestId: "b", delivery: "sent" },
    ]);
    render(panel(first));
    expect(screen.getByText(first.names)).toBeVisible();
    expect(held.hold).not.toHaveBeenCalled();
    await send("Send 2 offers");
    expect(held.hold).toHaveBeenCalledTimes(1);
    const sent = held.hold.mock.calls[0]?.[0] as FormData;
    expect(sent.get("holdKind")).toBe("seat_offer");
    expect(sent.get("tripId")).toBe("trip-1");
    expect(sent.getAll("interestId")).toEqual(["a", "b"]);
    expect(sent.has("discount")).toBe(false);
  });

  it("cannot be sent twice: the spent batch's button stays disabled", async () => {
    answers([
      { interestId: "a", delivery: "sent" },
      { interestId: "b", delivery: "sent" },
    ]);
    render(panel(first));
    await send("Send 2 offers");
    const button = screen.getByRole("button", { name: "Offer emailed" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(held.hold).toHaveBeenCalledTimes(1);
  });

  it("keeps the names it was opened with when the page hands it the next people", async () => {
    answers([
      { interestId: "a", delivery: "sent" },
      { interestId: "b", delivery: "sent" },
    ]);
    const { rerender } = render(panel(first));
    // A refresh mid-read (another staffer offered someone) swaps nothing under the button.
    rerender(panel(second));
    expect(screen.getByText(first.names)).toBeVisible();
    expect(screen.queryByText(second.names)).toBeNull();
    await send("Send 2 offers");
    const sent = held.hold.mock.calls[0]?.[0] as FormData;
    expect(sent.getAll("interestId")).toEqual(["a", "b"]);
    // Spent, the next batch is one deliberate press away, named before it is sent.
    fireEvent.click(screen.getByRole("button", { name: "Offer the next in line" }));
    expect(screen.getByText(second.names)).toBeVisible();
    expect(screen.getByRole("button", { name: "Send the offer" })).toBeEnabled();
    expect(held.hold).toHaveBeenCalledTimes(1);
  });

  it("offers no next batch while nobody else is waiting", async () => {
    answers([
      { interestId: "a", delivery: "sent" },
      { interestId: "b", delivery: "sent" },
    ]);
    const { rerender } = render(panel(first));
    await send("Send 2 offers");
    rerender(panel({ ...second, interests: [] }));
    expect(screen.queryByRole("button", { name: second.next })).toBeNull();
  });

  it("treats a candidate the server already emailed as reached, with no write-to-them fallback", async () => {
    answers([
      { interestId: "a", delivery: "already_sent" },
      { interestId: "b", delivery: "sent" },
    ]);
    render(panel(first));
    await send("Send 2 offers");
    expect(screen.queryByText(/Ravi Menon/, { selector: "a, button" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer emailed" })).toBeDisabled();
  });

  it("gives the one that could not be sent its own composer, and still spends the batch", async () => {
    answers([
      { interestId: "a", delivery: "sent" },
      { interestId: "b", delivery: "fallback" },
    ]);
    render(panel(first));
    await send("Send 2 offers");
    expect(screen.getByRole("link", { name: /Hana Kobayashi/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
    expect(screen.queryByRole("link", { name: /Ravi Menon/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer emailed" })).toBeDisabled();
  });

  it("sends nothing when the hold is undone", async () => {
    held.hold.mockResolvedValue({ id: "held-1", runAt: 0, holdMs: 8000 });
    held.undo.mockResolvedValue(true);
    render(panel(first));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send 2 offers" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(held.release).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send 2 offers" })).toBeEnabled();
  });
});
