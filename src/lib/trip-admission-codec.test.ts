import { describe, expect, it } from "vitest";
import type { Certification, DiveSpecialty } from "@/db/schema";
import { levelShort, NO_NITROX, noLevel, noSpecialty } from "@/test/admission-refusals";
import type { TripLevelRequirement } from "./training-mark";
import {
  decideTripAdmission,
  decodeTripAdmissionRefusal,
  encodeTripAdmissionRefusal,
  refusalIsLevelOnly,
  type TripAdmissionEvidence,
  type TripAdmissionRefusal,
} from "./trip-admission";

/**
 * The refusal's wire format (issue #2706): the sale threshold's ladder
 * blockers, one per `~`, each its code and params joined by `-`. The decoder
 * reads an attacker's query string, so everything it accepts is exactly what
 * the encoder writes for a refusal `decideTripAdmission` could return.
 */

function certification(overrides: Partial<Certification> = {}): Certification {
  return { status: "verified", level: "open_water", ...overrides } as Certification;
}

function evidence(overrides: Partial<TripAdmissionEvidence> = {}): TripAdmissionEvidence {
  return {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    ...overrides,
  };
}

function requirement(overrides: Partial<TripLevelRequirement> = {}): TripLevelRequirement {
  return {
    minimumCertificationIsDefault: false,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    ...overrides,
  };
}

describe("the refusal survives a redirect", () => {
  const cases: TripAdmissionRefusal[] = [
    [levelShort("advanced_open_water", "open_water")],
    [noLevel("rescue")],
    [noSpecialty("deep")],
    [NO_NITROX],
    [
      levelShort("rescue", "advanced_open_water"),
      noSpecialty("wreck"),
      noSpecialty("night"),
      noSpecialty("drysuit"),
      NO_NITROX,
    ],
  ];

  it.each(cases)("round-trips %o", (...refusal) => {
    expect(decodeTripAdmissionRefusal(encodeTripAdmissionRefusal(refusal))).toEqual(refusal);
  });

  // Branch coverage on the sale's wire (issue #3832): what the encoder writes for
  // a blocker the sale never raises or one short of its params, and what the
  // decoder then refuses.
  it("writes a code the sale never raises bare, and the decoder refuses it", () => {
    const encoded = encodeTripAdmissionRefusal([{ code: "waiver_pending" }]);
    expect(encoded).toBe("waiver_pending");
    expect(decodeTripAdmissionRefusal(encoded)).toBeNull();
  });

  it("writes an empty slot for a param a blocker lacks, and the decoder refuses it", () => {
    for (const refusal of [
      [{ code: "specialty_missing" }],
      [{ code: "specialty_missing", params: {} }],
      [{ code: "certification_insufficient", params: { requiredLevel: "rescue" } }],
    ] as TripAdmissionRefusal[]) {
      expect(decodeTripAdmissionRefusal(encodeTripAdmissionRefusal(refusal))).toBeNull();
    }
    expect(encodeTripAdmissionRefusal([{ code: "specialty_missing" }])).toBe("specialty_missing-");
  });

  it("stays URL-safe — nothing it writes needs escaping", () => {
    for (const refusal of cases) {
      const encoded = encodeTripAdmissionRefusal(refusal);
      expect(encodeURIComponent(encoded)).toBe(encoded);
    }
  });

  it("round-trips every refusal decideTripAdmission returns over the monotone grid", () => {
    // Not a hand-picked list: whatever the gate can say, the wire can carry.
    let seen = 0;
    for (const minimumCertificationLevel of [null, "advanced_open_water", "rescue"] as const) {
      for (const requiredSpecialties of [[], ["deep"], ["wreck", "night"]] as DiveSpecialty[][]) {
        for (const requiresNitrox of [false, true]) {
          for (const held of [[], [certification({ level: "open_water" })]]) {
            const admission = decideTripAdmission({
              requirement: requirement({
                minimumCertificationLevel,
                requiredSpecialties,
                requiresNitrox,
              }),
              siteRequirement: null,
              evidence: evidence({ certifications: held }),
              declared: held.length ? undefined : { nitrox: true },
            });
            if (admission.admitted) continue;
            seen += 1;
            expect(
              decodeTripAdmissionRefusal(encodeTripAdmissionRefusal(admission.refusal)),
            ).toEqual(admission.refusal);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  const hostile: Array<[string | undefined, string]> = [
    ["", "empty"],
    [undefined, "absent"],
    ["certification_insufficient", "a level blocker without its params"],
    ["certification_insufficient-advanced_open_water", "a level blocker missing what is held"],
    ["certification_insufficient-advanced_open_water-open_water-x", "over-long params"],
    ["specialty_missing-scooter", "an unknown specialty"],
    ["certification_missing-cave", "an unknown level"],
    ["nitrox_missing-1", "a param nitrox does not carry"],
    ["waiver_pending", "a readiness code the sale never raises"],
    ["payment_due", "another readiness code the sale never raises"],
    ["specialty_missing-deep~certification_missing-rescue", "a list out of ladder order"],
    ["nitrox_missing~specialty_missing-deep", "nitrox ahead of a specialty"],
    ["certification_missing-rescue~certification_missing-rescue", "two level blockers"],
    ["specialty_missing-deep~specialty_missing-deep", "a repeated specialty"],
    ["nitrox_missing~nitrox_missing", "a repeated nitrox"],
    ["~", "an empty blocker"],
    ["nitrox_missing~", "a trailing separator"],
    ["constructor", "a prototype-walking code"],
    ["certification_missing-constructor", "a prototype-walking level"],
    ["specialty_missing-__proto__", "a prototype-walking specialty"],
    ["certification_insufficient-rescue-instructor", "a held level that already reaches the bar"],
    ["certification_insufficient-rescue-rescue", "a held level equal to the bar"],
    ["certification_missing-deep", "a specialty in a level slot"],
    ["specialty_missing-rescue", "a level in a specialty slot"],
    ["certification_insufficient--open_water", "an empty param"],
    ["NITROX_MISSING", "a code in another case"],
    ["specialty_missing-Deep", "a param in another case"],
    ["specialty_missing%2Ddeep", "a percent-encoded separator"],
    ["nitrox_missing.extra", "a stray signature separator"],
  ];

  it.each(hostile)("refuses %s (%s) rather than half-decoding it", (value) => {
    expect(decodeTripAdmissionRefusal(value)).toBeNull();
  });

  /**
   * `?gate=a&gate=b` is a shape Next really delivers, and an array is truthy —
   * so `if (!value)` passed it through to `value.split()`, a `TypeError`, and
   * the error boundary. A 500 on a staff page, from a repeated query param.
   * The same class `src/proxy.ts` documents at length for `embed`; every
   * sibling param on these routes was already hardened and `gate` was not.
   */
  it("accepts only canonical values: whatever decodes re-encodes to the same string", () => {
    for (const refusal of cases) {
      const encoded = encodeTripAdmissionRefusal(refusal);
      const decoded = decodeTripAdmissionRefusal(encoded);
      expect(decoded && encodeTripAdmissionRefusal(decoded)).toBe(encoded);
    }
  });

  const repeated: Array<[string[], string]> = [
    [["certification_missing-rescue", "specialty_missing-deep"], "two well-formed values"],
    [["certification_missing-rescue"], "one well-formed value in an array"],
    [[], "an empty array"],
    [["", ""], "two empty values"],
  ];

  it.each(repeated)("refuses %o (%s) instead of throwing on it", (value) => {
    expect(() => decodeTripAdmissionRefusal(value)).not.toThrow();
    expect(decodeTripAdmissionRefusal(value)).toBeNull();
  });
});

describe("refusalIsLevelOnly: what the booking form may advise on", () => {
  it("is true only for a level shortfall with no card missing beside it", () => {
    expect(refusalIsLevelOnly([levelShort("advanced_open_water", "open_water")])).toBe(true);
    expect(refusalIsLevelOnly([noLevel("rescue")])).toBe(true);
    // `.some` here would sell these seats on a typed rung; they must refuse.
    expect(
      refusalIsLevelOnly([levelShort("advanced_open_water", "open_water"), noSpecialty("deep")]),
    ).toBe(false);
    expect(refusalIsLevelOnly([levelShort("advanced_open_water", "open_water"), NO_NITROX])).toBe(
      false,
    );
    expect(refusalIsLevelOnly([noSpecialty("deep")])).toBe(false);
    expect(refusalIsLevelOnly([])).toBe(false);
  });
});
