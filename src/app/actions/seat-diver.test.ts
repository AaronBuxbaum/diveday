import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { levelShort, NO_NITROX, noSpecialty } from "@/test/admission-refusals";

/**
 * The seat action's answer when the seat transaction gave up waiting for a
 * held departure: `55P03` after five seconds (`src/db/lock-bounds.ts`). A
 * staffer at the counter reads "tap again" on the page they were on, never a
 * crash page (layer B domain review, Q5).
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("../../features/divers/store", () => ({ findSimilarDivers: vi.fn(async () => []) }));
vi.mock("../../features/seat-diver/store", () => ({ seatDiver: vi.fn() }));
vi.mock("../../features/navigation/rules", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));

const { seatDiver } = await import("../../features/seat-diver/store");
const { findSimilarDivers } = await import("../../features/divers/store");
const { verifyTripAdmissionGate } = await import("@/lib/trip-admission-gate");
const { requireShopSurface } = await import("../../features/session/rules");
const { seatExistingDiverAction, seatNewDiverAction } = await import("./seat-diver");

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
  door: "departure" | "diver" = "departure",
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

beforeEach(() => {
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

  it("carries the boat's certification refusal as a gate signed for this departure only", async () => {
    const refusal = [
      levelShort("advanced_open_water", "open_water"),
      noSpecialty("deep"),
      NO_NITROX,
    ] as never;
    vi.mocked(seatDiver).mockResolvedValue({
      ok: false,
      reason: "trip_prerequisite",
      refusal,
    } as never);
    const to = new URL(await landing(form()), "http://x");
    expect(to.pathname).toBe(`/shop/blue-mantis/trips/${TRIP_ID}`);
    expect(to.searchParams.get("notice")).toBe("diver-trip-prerequisite");
    const gate = to.searchParams.get("gate");
    expect(gate).not.toBeNull();
    const bound = (scope: { kind: "trip" | "diver"; id: string }, notice: string) => ({
      scope,
      notice,
      bookingId: null,
    });
    expect(
      verifyTripAdmissionGate(
        gate ?? undefined,
        bound({ kind: "trip", id: TRIP_ID }, "diver-trip-prerequisite"),
      ),
    ).not.toBeNull();
    // A signature for this boat is worthless on another, on a diver's record, or beside another notice.
    expect(
      verifyTripAdmissionGate(
        gate ?? undefined,
        bound({ kind: "trip", id: DIVER_ID }, "diver-trip-prerequisite"),
      ),
    ).toBeNull();
    expect(
      verifyTripAdmissionGate(
        gate ?? undefined,
        bound({ kind: "diver", id: DIVER_ID }, "diver-trip-prerequisite"),
      ),
    ).toBeNull();
    expect(
      verifyTripAdmissionGate(
        gate ?? undefined,
        bound({ kind: "trip", id: TRIP_ID }, "participant-type-cert"),
      ),
    ).toBeNull();
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
 * **A held seat is told as held**, on both doors: the
 * identity-unconfirmed hold (H-20260724-one-person-per-email) outranks every other success sentence, so a
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
    ["diver", {}, "booked-identity-unconfirmed"],
  ] as const)("%s %j says %s", async (door, extra, notice) => {
    vi.mocked(seatDiver).mockResolvedValue(held);
    const to = new URL(await landing(form(extra), door), "http://x");
    expect(to.searchParams.get("notice")).toBe(notice);
  });
});

/** A name is enough: email and phone are optional on a boat (Aaron, 2026-11-05). */
describe("adding a diver to a boat", () => {
  it("seats a diver typed with a name alone, as an ordinary add", async () => {
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
    await expect(seatNewDiverAction("departure", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-added&bid=`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entry: "roster",
        refusals: "specific",
        diver: expect.objectContaining({ fullName: "Dana Walker", email: undefined }),
      }),
    );
  });

  it("keeps an incomplete party on the departure's open add band, request and all", async () => {
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
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=party-seat-added&add=1&request=${requestId}`,
    );
    expect(seatDiver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateRequestInterestId: requestId }),
    );
  });

  it.each([
    [{ identityUnconfirmed: true, waiver: "not_delivered" }, "diver-added-identity-unconfirmed"],
    [{ identityUnconfirmed: false, waiver: "not_delivered" }, "diver-added-waiver-undelivered"],
    [{ identityUnconfirmed: false, waiver: "failed" }, "diver-added-waiver-undelivered"],
  ] as const)(
    "a party seat with %j still says %s, with the row and the request",
    async (outcome, notice) => {
      const bookingId = "55555555-5555-4555-8555-555555555555";
      const requestId = "66666666-6666-4666-8666-666666666666";
      vi.mocked(seatDiver).mockResolvedValue({
        ok: true,
        personId: DIVER_ID,
        bookingId,
        dateRequestPartyComplete: false,
        confirmation: "skipped",
        ...outcome,
      } as never);
      await expect(landing(form({ request: requestId }))).resolves.toBe(
        `/shop/blue-mantis/trips/${TRIP_ID}?notice=${notice}&bid=${bookingId}&add=1&request=${requestId}`,
      );
    },
  );

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

  it("keeps the request on the name-match prompt a typed name raises", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(findSimilarDivers).mockResolvedValueOnce([{ id: DIVER_ID }] as never);
    const data = new FormData();
    data.set("tripId", TRIP_ID);
    data.set("fullName", "Dana Walker");
    data.set("email", "dana@example.com");
    data.set("request", requestId);
    await expect(seatNewDiverAction("departure", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?confirmName=Dana+Walker&confirmEmail=dana%40example.com&add=1&request=${requestId}#hand-entry`,
    );
    expect(seatDiver).not.toHaveBeenCalled();
  });

  it("carries no request onto the prompt when the form named none", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValueOnce([{ id: DIVER_ID }] as never);
    const data = new FormData();
    data.set("tripId", TRIP_ID);
    data.set("fullName", "Dana Walker");
    data.set("email", "dana@example.com");
    data.set("request", "not-a-uuid");
    await expect(seatNewDiverAction("departure", "blue-mantis", data)).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/trips/${TRIP_ID}?confirmName=Dana+Walker&confirmEmail=dana%40example.com#hand-entry`,
    );
  });

  it("keeps the request and the open band when seating is refused, so the party can go on", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(seatDiver).mockResolvedValue({ ok: false, reason: "trip_full" } as never);

    await expect(landing(form({ request: requestId }))).resolves.toBe(
      `/shop/blue-mantis/trips/${TRIP_ID}?notice=diver-full&add=1&request=${requestId}`,
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
});
