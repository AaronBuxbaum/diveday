import { describe, expect, it } from "vitest";
import { levelShort, NO_NITROX, noSpecialty } from "@/test/admission-refusals";
import type { TripAdmissionRefusal } from "./trip-admission";
import { encodeTripAdmissionRefusal } from "./trip-admission";
import {
  verifyTripAdmissionGate as check,
  GATE_LIFETIME_MS,
  signTripAdmissionGate as mint,
  type TripAdmissionGateScope,
} from "./trip-admission-gate";

/**
 * **The `?gate=` param must be evidence, not an instruction.**
 *
 * The codec on its own proved only that a value was well-formed. That let
 * anyone who could get a staffer to open a link render a fabricated, *specific*
 * refusal — and the specific ones are the ones that point a staffer at the
 * certifications form, where a hand-entered card lands `pending` and clears
 * `decideTripAdmission` on the next attempt (H-20260725-two-findings-dive-domain). Every test here fails
 * against the unsigned codec.
 */

const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";
const DIVER = "33333333-3333-4333-8333-333333333333";

const NOTICE = "diver-trip-prerequisite";
const SEAT = "55555555-5555-4555-8555-555555555555";
const NOW = 1_800_000_000_000;

/** A binding for `scope`: the sale-time notice, no seat, unless said. */
const bind = (scope: TripAdmissionGateScope, notice = NOTICE, bookingId: string | null = null) => ({
  scope,
  notice,
  bookingId,
});

// The suite's long-standing shape: scope in, the default notice and clock around it.
const signTripAdmissionGate = (
  refusal: TripAdmissionRefusal,
  scope: TripAdmissionGateScope,
  now = NOW,
) => mint(refusal, bind(scope), now);
const verifyTripAdmissionGate = (
  value: Parameters<typeof check>[0],
  scope: TripAdmissionGateScope,
  now = NOW,
) => check(value, bind(scope), now);

const tripA: TripAdmissionGateScope = { kind: "trip", id: TRIP_A };
const tripB: TripAdmissionGateScope = { kind: "trip", id: TRIP_B };
const diver: TripAdmissionGateScope = { kind: "diver", id: DIVER };

const levelRefusal: TripAdmissionRefusal = [levelShort("advanced_open_water", "open_water")];

const specialtyRefusal: TripAdmissionRefusal = [noSpecialty("deep")];

describe("a signed gate round-trips for the scope it was minted for", () => {
  const cases: TripAdmissionRefusal[] = [
    levelRefusal,
    specialtyRefusal,
    [NO_NITROX],
    [
      levelShort("rescue", "advanced_open_water"),
      noSpecialty("wreck"),
      noSpecialty("night"),
      noSpecialty("drysuit"),
      NO_NITROX,
    ],
  ];

  it.each(cases)("%o survives the redirect", (...refusal) => {
    expect(verifyTripAdmissionGate(signTripAdmissionGate(refusal, tripA), tripA)).toEqual(refusal);
  });

  it("round-trips on a diver-scoped surface too", () => {
    expect(verifyTripAdmissionGate(signTripAdmissionGate(levelRefusal, diver), diver)).toEqual(
      levelRefusal,
    );
  });

  it("stays URL-safe — nothing it writes needs escaping", () => {
    for (const refusal of cases) {
      const signed = signTripAdmissionGate(refusal, tripA);
      expect(encodeURIComponent(signed)).toBe(signed);
    }
  });

  it("leaves the codes readable in the URL, so a staff bug report is debuggable", () => {
    expect(signTripAdmissionGate(levelRefusal, tripA)).toMatch(
      /^certification_insufficient-advanced_open_water-open_water\.[0-9a-z]+\.[\w-]+$/,
    );
  });
});

/**
 * The attack the signature exists to stop: a hand-written value that names a
 * requirement no gate ever raised. `specialty_missing-deep` renders "…their Deep card isn't
 * on file", which is exactly the sentence that sends a staffer to the
 * certifications form.
 */
describe("an unsigned value is not a refusal", () => {
  const forged: Array<[string, string]> = [
    ["specialty_missing-deep", "a fabricated missing-specialty refusal"],
    ["certification_insufficient-advanced_open_water-open_water", "a fabricated level refusal"],
    ["nitrox_missing", "a fabricated nitrox refusal"],
    [
      "certification_missing-instructor~specialty_missing-wreck~specialty_missing-night~nitrox_missing",
      "a fabricated everything-at-once refusal",
    ],
  ];

  it.each(forged)("refuses %s (%s)", (value) => {
    expect(verifyTripAdmissionGate(value, tripA)).toBeNull();
  });

  it("refuses a value carrying a plausible-looking but wrong signature", () => {
    const signed = signTripAdmissionGate(levelRefusal, tripA);
    const [codes, issued, signature] = signed.split(".") as [string, string, string];
    // Same shape, same length, one character rotated — the tamper a
    // non-timing-safe or truncated compare would wave through.
    const flipped = signature[0] === "A" ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(verifyTripAdmissionGate(`${codes}.${issued}.${flipped}`, tripA)).toBeNull();
  });

  it("refuses codes swapped underneath a genuine signature", () => {
    const [, issued, signature] = signTripAdmissionGate(levelRefusal, tripA).split(".");
    const swapped = `${encodeTripAdmissionRefusal(specialtyRefusal)}.${issued}.${signature}`;
    expect(verifyTripAdmissionGate(swapped, tripA)).toBeNull();
  });
});

/**
 * The signature is bound to the id the *landing route* owns, so a genuine
 * refusal — one a staffer really did produce — cannot be re-pointed at a
 * departure whose gate refused nobody.
 */
describe("a genuine signature does not travel", () => {
  it("refuses a trip's gate replayed onto another departure", () => {
    const signed = signTripAdmissionGate(levelRefusal, tripA);
    expect(verifyTripAdmissionGate(signed, tripA)).toEqual(levelRefusal);
    expect(verifyTripAdmissionGate(signed, tripB)).toBeNull();
  });

  it("refuses a diver-scoped gate read as a trip-scoped one, even on the same id", () => {
    const sameId = "44444444-4444-4444-8444-444444444444";
    const signed = signTripAdmissionGate(levelRefusal, { kind: "diver", id: sameId });
    expect(verifyTripAdmissionGate(signed, { kind: "trip", id: sameId })).toBeNull();
  });

  it("refuses a diver's gate replayed onto a different diver", () => {
    const signed = signTripAdmissionGate(specialtyRefusal, diver);
    expect(verifyTripAdmissionGate(signed, { kind: "diver", id: TRIP_A })).toBeNull();
  });
});

/**
 * Everything a query string can actually deliver. `?gate=a&gate=b` arrives as
 * an array and is truthy — the shape that used to reach `.split()` and 500 a
 * staff page (the same class `src/proxy.ts` documents for `embed`).
 */
describe("hostile and malformed query values are refused, never thrown on", () => {
  const hostile: Array<[string | string[] | undefined | null, string]> = [
    [undefined, "absent"],
    [null, "null"],
    ["", "empty"],
    [["a", "b"], "repeated (?gate=a&gate=b)"],
    [[], "an empty array"],
    [[signTripAdmissionGate(levelRefusal, tripA)], "a genuine value wrapped in an array"],
    [".", "a bare separator"],
    [".abc", "a signature with no codes"],
    [
      "certification_insufficient-advanced_open_water-open_water..",
      "codes with an empty signature",
    ],
    ["certification_missing-cave.1.AAAA", "an unknown level under a signature"],
    ["waiver_pending.1.AAAA", "a readiness code the sale never raises"],
    ["constructor.1.AAAA", "a prototype-walking code"],
    ["nitrox_missing.AAAA", "a v2-shaped value with no issue time"],
  ];

  it.each(hostile)("refuses %o (%s)", (value) => {
    expect(() => verifyTripAdmissionGate(value, tripA)).not.toThrow();
    expect(verifyTripAdmissionGate(value, tripA)).toBeNull();
  });

  /**
   * Signed by us, addressed to us — and still refused, because a signature
   * over a malformed body is not a licence to half-decode it. A refusal
   * naming a requirement the trip does not have is worse than a generic one.
   */
  it("refuses a well-signed value whose codes the codec rejects", () => {
    const demandsNothing = signTripAdmissionGate([], tripA);
    expect(demandsNothing).toMatch(/^\.[0-9a-z]+\./);
    expect(verifyTripAdmissionGate(demandsNothing, tripA)).toBeNull();
    // A boarding blocker the sale never raises, signed: still not a refusal.
    const boardingOnly = signTripAdmissionGate([{ code: "waiver_pending" }], tripA);
    expect(verifyTripAdmissionGate(boardingOnly, tripA)).toBeNull();
    // Signed, but out of ladder order: the decoder still refuses it.
    const outOfOrder = signTripAdmissionGate([...specialtyRefusal, ...levelRefusal], tripA);
    expect(verifyTripAdmissionGate(outOfOrder, tripA)).toBeNull();
  });
});

/**
 * **A genuine gate says one thing, about one seat, for a day** (issue #3777).
 * It was bound to the route alone, so a real refusal could be pasted beside
 * another notice name or onto another seat, and never stopped being true.
 */
describe("a genuine gate is bound to its notice, its seat and its day", () => {
  const seated = bind(tripA, "participant-type-cert", SEAT);
  const signed = mint(levelRefusal, seated, NOW);

  it("verifies for exactly the binding it was minted for", () => {
    expect(check(signed, seated, NOW)).toEqual(levelRefusal);
  });

  it("refuses the same gate beside another notice", () => {
    expect(check(signed, bind(tripA, NOTICE, SEAT), NOW)).toBeNull();
    expect(check(signed, { ...seated, notice: "booking-removed" }, NOW)).toBeNull();
  });

  it("refuses the same gate on another seat, or on no seat at all", () => {
    const otherSeat = "66666666-6666-4666-8666-666666666666";
    expect(check(signed, { ...seated, bookingId: otherSeat }, NOW)).toBeNull();
    expect(check(signed, { ...seated, bookingId: null }, NOW)).toBeNull();
    // And a sale-time gate (no seat) does not describe a seat.
    const sale = mint(levelRefusal, bind(tripA), NOW);
    expect(check(sale, { ...bind(tripA), bookingId: SEAT }, NOW)).toBeNull();
  });

  it("refuses an issue time rewritten under the original signature", () => {
    const [codes, , signature] = signed.split(".") as [string, string, string];
    const later = Math.floor((NOW + GATE_LIFETIME_MS) / 1000).toString(36);
    expect(check(`${codes}.${later}.${signature}`, seated, NOW + GATE_LIFETIME_MS)).toBeNull();
  });

  it("lives for a day, to the millisecond, and no longer", () => {
    expect(check(signed, seated, NOW + GATE_LIFETIME_MS - 1_000)).toEqual(levelRefusal);
    expect(check(signed, seated, NOW + GATE_LIFETIME_MS + 1_000)).toBeNull();
    expect(check(signed, seated, NOW + 7 * GATE_LIFETIME_MS)).toBeNull();
  });

  it("refuses a gate from the future", () => {
    expect(check(mint(levelRefusal, seated, NOW + 10 * 60_000), seated, NOW)).toBeNull();
  });
});
