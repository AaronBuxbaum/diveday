// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookableDiver } from "@/db/divers";
import type { DateInterestRow } from "@/db/interest-dates";
import { staffTranslator } from "@/i18n/staff-messages";
import { addBandFor, seatRequestBand } from "./seat-request-band";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("../_lib/seat-request", () => ({ readSeatRequest: vi.fn() }));
const { readSeatRequest } = await import("../_lib/seat-request");

afterEach(cleanup);

const t = staffTranslator("en-US");
const ROW = {
  id: "6f1c2c9e-1111-4000-8000-000000000001",
  courseId: null,
  courseTitle: null,
  interest: "Wreck",
  personId: null,
  name: "Imani Okafor",
  email: "imani@example.com",
  phone: "+13055550101",
  partySize: 3,
} as DateInterestRow;

const TRIP = "6f1c2c9e-2222-4000-8000-000000000002";
const WHERE = { shopSlug: "blue-mantis", tripId: TRIP, t };

describe("seatRequestBand", () => {
  it("prefills someone not on file and names who asked, for how many", () => {
    const band = seatRequestBand(
      { row: ROW, candidate: null, askerAboard: false, seated: 0, partySize: 3 },
      WHERE,
    );
    expect(band.context).toEqual({
      id: ROW.id,
      prefill: { fullName: "Imani Okafor", email: "imani@example.com", phone: "+13055550101" },
    });
    expect(band.search).toBeUndefined();
    render(<div>{band.card}</div>);
    expect(screen.getByText(t("bookings.new.fromRequest"))).toBeInTheDocument();
    expect(
      screen.getByText(`(${t("trips.addDiver.requestLeft", { count: 3 })})`),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("bookings.new.viewRequests") })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/requests",
    );
  });

  it("offers the asker on file as the one match, and prefills nothing", () => {
    const candidate = {
      person: { id: "person-1", fullName: "Avery Diver" },
      rentalFit: null,
    } as unknown as BookableDiver;
    const band = seatRequestBand(
      {
        row: { ...ROW, personId: "person-1", name: "Avery Diver" },
        candidate,
        askerAboard: false,
        seated: 0,
        partySize: 3,
      },
      WHERE,
    );
    expect(band.context).toEqual({ id: ROW.id, prefill: undefined });
    expect(band.search).toEqual({ query: "Avery Diver", candidates: [candidate] });
    render(<div>{band.card}</div>);
    expect(screen.getByRole("link", { name: t("requests.viewDiver") })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
  });

  it("says how many are left to seat, not how many asked", () => {
    const band = seatRequestBand(
      { row: ROW, candidate: null, askerAboard: false, seated: 1, partySize: 3 },
      WHERE,
    );
    render(<div>{band.card}</div>);
    expect(
      screen.getByText(`(${t("trips.addDiver.requestLeft", { count: 2 })})`),
    ).toBeInTheDocument();
  });

  it("prefills the asker for the party's first seat only", () => {
    const band = seatRequestBand(
      { row: ROW, candidate: null, askerAboard: false, seated: 1, partySize: 3 },
      WHERE,
    );
    expect(band.context).toEqual({ id: ROW.id, prefill: undefined });
  });

  it("says the asker is already on this boat, only when they are (issue #3742)", () => {
    const aboard = seatRequestBand(
      {
        row: { ...ROW, personId: "person-1", name: "Avery Diver" },
        candidate: null,
        askerAboard: true,
        seated: 0,
        partySize: 3,
      },
      WHERE,
    );
    const { unmount } = render(<div>{aboard.card}</div>);
    expect(
      screen.getByText(t("trips.addDiver.requestAskerAboard", { name: "Avery Diver" })),
    ).toBeInTheDocument();
    unmount();

    const off = seatRequestBand(
      { row: ROW, candidate: null, askerAboard: false, seated: 0, partySize: 3 },
      WHERE,
    );
    render(<div>{off.card}</div>);
    expect(screen.queryByText(/already on this boat/)).toBeNull();
  });

  it("lets the desk put the request down, keeping the band open", () => {
    const band = seatRequestBand(
      { row: ROW, candidate: null, askerAboard: false, seated: 0, partySize: 3 },
      WHERE,
    );
    render(<div>{band.card}</div>);
    expect(screen.getByRole("link", { name: t("trips.addDiver.requestDone") })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${TRIP}?add=1`,
    );
  });
});

describe("addBandFor", () => {
  const db = {} as never;
  const where = { shop: { id: "shop-1" }, shopSlug: "blue-mantis", tripId: TRIP, t };

  it("keeps the page when the request is gone, and says so in place of the card", async () => {
    vi.mocked(readSeatRequest).mockResolvedValue("gone");
    const band = await addBandFor(db, where, { add: "1", request: ROW.id });
    expect(band).toMatchObject({ open: true, counter: false });
    expect(band.request).toBeUndefined();
    render(<div>{band.requestGone}</div>);
    expect(screen.getByText(t("trips.addDiver.requestGone"))).toBeInTheDocument();
  });

  it("says a request never offered this departure was not, and carries none of it", async () => {
    vi.mocked(readSeatRequest).mockResolvedValue("not_offered");
    const band = await addBandFor(db, where, { add: "1", request: ROW.id });
    expect(band.request).toBeUndefined();
    render(<div>{band.requestGone}</div>);
    expect(screen.getByText(t("trips.addDiver.requestNotOffered"))).toBeInTheDocument();
  });

  it("is the counter only when the desk chose it, and the counter answers no request", async () => {
    vi.mocked(readSeatRequest).mockClear();
    expect(await addBandFor(db, where, { add: "1" })).toMatchObject({ counter: false });
    const counter = await addBandFor(db, where, { counter: "1", request: ROW.id });
    expect(counter).toEqual({ open: false, counter: true });
    expect(readSeatRequest).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ request: ROW.id }),
    );
  });
});
