import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seat action's answer when the seat transaction gave up waiting for a
 * held departure: `55P03` after five seconds (`src/db/lock-bounds.ts`). A
 * staffer at the counter reads "tap again" on the page they were on, never a
 * crash page (layer B domain review, Q5).
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/divers", () => ({ findSimilarDivers: vi.fn(async () => []) }));
vi.mock("@/db/seat-diver", () => ({ seatDiver: vi.fn() }));
vi.mock("@/db/trips", () => ({ getTripWithBooked: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { seatDiver } = await import("@/db/seat-diver");
const { getTripWithBooked } = await import("@/db/trips");
const { HOUR_MS, nowMs } = await import("@/lib/clock");
const { verifyTripAdmissionGate } = await import("@/lib/trip-admission-gate");
const { requireShopSurface } = await import("@/lib/session");
const { seatExistingDiverAction, seatNewDiverAction } = await import("./seat-diver");
const { SEAT_SURFACES } = await import("./seat-diver-surfaces");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const DIVER_ID = "44444444-4444-4444-8444-444444444444";

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("tripId", TRIP_ID);
  data.set("personId", DIVER_ID);
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

/** Where the action sent the staffer. */
async function landing(
  data: FormData = form(),
  door: "departure" | "diver" | "walk-in" = "departure",
): Promise<string> {
  try {
    await seatExistingDiverAction(door, "blue-mantis", data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("the action neither redirected nor threw");
}

/** What drizzle throws for a lock wait Postgres gave up on. */
function lockWaitRefusal(): Error {
  const driver = Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
  });
  return new Error("Failed query: insert into bookings", { cause: driver });
}

/** A scheduled departure `hours` from the frozen clock. */
function boatAt(hours: number, status = "scheduled") {
  return { id: TRIP_ID, status, startsAt: new Date(nowMs() + hours * HOUR_MS) } as never;
}

beforeEach(() => {
  vi.mocked(getTripWithBooked).mockResolvedValue(boatAt(2));
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, personId: "staff" } },
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("seatExistingDiverAction under a held departure", () => {
  it("sends the staffer back to the trip with the busy notice", async () => {
    vi.mocked(seatDiver).mockRejectedValue(lockWaitRefusal());
    expect(await landing()).toBe(`/shop/blue-mantis/trips/${TRIP_ID}?notice=seat-busy`);
  });

  it("still throws anything that is not a lock wait", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    vi.mocked(seatDiver).mockRejectedValue(new Error("Failed query", { cause: deadlock }));
    await expect(landing()).rejects.toThrow("Failed query");
  });
});

/**
 * **Every refusal still refuses**, from the one door that carries a boat in its
 * landing: the notice names the gate, nothing is written past the transaction's
 * answer, and the signed `?gate=` rides only the certification refusal, bound to
 * this departure (src/lib/trip-admission-gate.ts).
 */
describe("every refusal lands on the boat with its own words", () => {
  const refusals = [
    ["trip_full", "diver-full"],
    ["divers_full", "diver-divers-full"],
    ["participant_type_unavailable", "diver-type-unavailable"],
    ["already_booked", "diver-already"],
    ["course_unstaffed", "diver-course-unstaffed"],
    ["course_prerequisite", "diver-course-prerequisite"],
    ["course_ratio_full", "diver-course-ratio-full"],
    ["course_min_age", "diver-course-min-age"],
    ["trip_unavailable", "diver-unavailable"],
    ["unavailable", "diver-unavailable"],
  ] as const;

  it.each(refusals)("%s lands as %s, with no gate", async (reason, notice) => {
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason } as never);
    expect(await landing()).toBe(`/shop/blue-mantis/trips/${TRIP_ID}?notice=${notice}`);
  });

  it.each(refusals)("%s answers the counter in the same words", async (reason, notice) => {
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason } as never);
    expect(await landing(form(), "walk-in")).toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=${notice}`,
    );
  });

  it("carries the boat's certification refusal as a gate signed for this departure only", async () => {
    const refusal = {
      requiredLevel: "advanced_open_water",
      heldLevel: "open_water",
      missingSpecialties: ["deep"],
      nitroxRequired: true,
    } as never;
    vi.mocked(seatDiver).mockResolvedValue({
      ok: false,
      reason: "trip_prerequisite",
      refusal,
    } as never);
    const to = new URL(await landing(form(), "walk-in"), "http://x");
    expect(to.pathname).toBe(`/shop/blue-mantis/trips/${TRIP_ID}`);
    expect(to.searchParams.get("notice")).toBe("diver-trip-prerequisite");
    const gate = to.searchParams.get("gate");
    expect(gate).not.toBeNull();
    expect(
      verifyTripAdmissionGate(gate ?? undefined, { kind: "trip", id: TRIP_ID }),
    ).not.toBeNull();
    // A signature for this boat is worthless on another, or on a diver's record.
    expect(verifyTripAdmissionGate(gate ?? undefined, { kind: "trip", id: DIVER_ID })).toBeNull();
    expect(verifyTripAdmissionGate(gate ?? undefined, { kind: "diver", id: DIVER_ID })).toBeNull();
  });

  it("an unparseable submission lands back on the boat it came from", async () => {
    const to = await landing(form({ personId: "not-a-uuid" }));
    expect(to).toBe(`/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-seat-invalid`);
    expect(seatDiver).not.toHaveBeenCalled();
  });

  it("a diver's record keeps its own landing and words", async () => {
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_full" } as never);
    expect(await landing(form(), "diver")).toBe(
      `/shop/blue-mantis/divers/${DIVER_ID}?notice=trip-full`,
    );
  });
});

/**
 * **A held seat is told as held**, on both doors and in the counter's mode: the
 * identity-unconfirmed hold (H-13) outranks every other success sentence, so a
 * staffer never reads a plain "Added" for a seat the boarding gate will refuse.
 */
describe("a held seat is announced as held", () => {
  const held = {
    ok: true,
    personId: DIVER_ID,
    bookingId: "55555555-5555-4555-8555-555555555555",
    identityUnconfirmed: true,
    waiver: "not_delivered",
    confirmation: "sent",
  } as never;

  it.each([
    ["departure", {}, "diver-added-identity-unconfirmed"],
    ["walk-in", {}, "walkin-added-identity-unconfirmed"],
    ["diver", {}, "booked-identity-unconfirmed"],
  ] as const)("%s %j says %s", async (door, extra, notice) => {
    vi.mocked(seatDiver).mockResolvedValue(held);
    const to = new URL(await landing(form(extra), door), "http://x");
    expect(to.searchParams.get("notice")).toBe(notice);
  });
});

/**
 * **The counter is for boats the counter can still seat.** `walkIn=true` is a
 * claim from the client; the boat is read again and a sailed, cancelled, held
 * or out-of-reach departure takes nobody and writes nothing.
 */
describe("a walk-in is refused on a boat the counter cannot seat", () => {
  const closed: Array<[string, unknown]> = [
    ["a boat that sailed an hour ago", boatAt(-1)],
    ["a boat that sailed this morning", boatAt(-5)],
    ["a boat days away", boatAt(24 * 5)],
    ["a cancelled boat", boatAt(2, "cancelled")],
    ["a boat that does not exist", null],
  ];

  it.each(closed)("%s", async (_name, trip) => {
    vi.mocked(getTripWithBooked).mockResolvedValue(trip as never);
    expect(await landing(form(), "walk-in")).toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-unavailable`,
    );
    expect(seatDiver).not.toHaveBeenCalled();
  });

  it("refuses a hand-entered walk-in the same way, before any name check", async () => {
    vi.mocked(getTripWithBooked).mockResolvedValue(boatAt(-3));
    const data = new FormData();
    data.set("tripId", TRIP_ID);
    data.set("fullName", "Dana Walker");
    await expect(seatNewDiverAction("walk-in", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-unavailable`,
    );
    expect(seatDiver).not.toHaveBeenCalled();
  });

  it("seats a walk-in on an open boat as a walk-in, with no email required", async () => {
    vi.mocked(seatDiver).mockResolvedValue({
      ok: true,
      personId: DIVER_ID,
      bookingId: "55555555-5555-4555-8555-555555555555",
      identityUnconfirmed: false,
      waiver: "not_needed",
      confirmation: "skipped",
    } as never);
    const data = new FormData();
    data.set("tripId", TRIP_ID);
    data.set("fullName", "Dana Walker");
    await expect(seatNewDiverAction("walk-in", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?notice=walkin-added&bid=`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: "walk_in", refusals: "specific" }),
    );
  });

  it("keeps an incomplete party on the request context after seating one member", async () => {
    const bookingId = "55555555-5555-4555-8555-555555555555";
    const requestId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(seatDiver).mockResolvedValue({
      ok: true,
      personId: DIVER_ID,
      bookingId,
      identityUnconfirmed: false,
      dateRequestPartyComplete: false,
      waiver: "not_needed",
      confirmation: "skipped",
    } as never);
    await expect(landing(form({ request: requestId }))).resolves.toBe(
      `/shop/blue-mantis/bookings/new/${TRIP_ID}?notice=party-seat-added&request=${requestId}`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateRequestInterestId: requestId }),
    );
  });

  it("returns to the trip after the last requested party member is seated", async () => {
    const bookingId = "55555555-5555-4555-8555-555555555555";
    const requestId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(seatDiver).mockResolvedValue({
      ok: true,
      personId: DIVER_ID,
      bookingId,
      identityUnconfirmed: false,
      dateRequestPartyComplete: true,
      waiver: "not_needed",
      confirmation: "skipped",
    } as never);
    await expect(landing(form({ request: requestId }))).resolves.toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-added&bid=${bookingId}`,
    );
  });

  it("does not close the explicit request when seating is refused", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_full" } as never);

    await expect(landing(form({ request: requestId }))).resolves.toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-full`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateRequestInterestId: requestId }),
    );
  });

  it("ignores a malformed request id rather than associating or closing it", async () => {
    const bookingId = "55555555-5555-4555-8555-555555555555";
    vi.mocked(seatDiver).mockResolvedValue({
      ok: true,
      personId: DIVER_ID,
      bookingId,
      identityUnconfirmed: false,
      waiver: "not_needed",
      confirmation: "skipped",
    } as never);

    await expect(landing(form({ request: "not-a-request-id" }))).resolves.toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-added&bid=${bookingId}`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateRequestInterestId: undefined }),
    );
  });

  it("still asks a roster hand entry for an email when it is not a walk-in", async () => {
    const data = new FormData();
    data.set("tripId", TRIP_ID);
    data.set("fullName", "Dana Walker");
    await expect(seatNewDiverAction("departure", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-seat-invalid`,
    );
    expect(seatDiver).not.toHaveBeenCalled();
  });

  it("does not read a posted walkIn field: the mode is the bound door's alone", async () => {
    vi.mocked(getTripWithBooked).mockResolvedValue(boatAt(-3));
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_unavailable" } as never);
    await landing(form({ walkIn: "true" }));
    expect(getTripWithBooked).not.toHaveBeenCalled();
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: "roster" }),
    );
  });

  it("does not read the claim on a roster seat, which has no counter to close", async () => {
    vi.mocked(getTripWithBooked).mockResolvedValue(boatAt(-3));
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_unavailable" } as never);
    await landing();
    expect(getTripWithBooked).not.toHaveBeenCalled();
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: "roster" }),
    );
  });

  it("ignores walkIn on a diver's record, which has no counter", async () => {
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_full" } as never);
    await landing(form({ walkIn: "true" }), "diver");
    expect(getTripWithBooked).not.toHaveBeenCalled();
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: SEAT_SURFACES.diver.entry }),
    );
  });
});
