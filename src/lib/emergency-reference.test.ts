import { describe, expect, it } from "vitest";
import {
  EMPTY_EMERGENCY_REFERENCE,
  emergencyReferenceForDeparture,
  hasEmergencyReference,
  MAX_EMERGENCY_LINES,
  normalizeCallSign,
  normalizeEmergencyReference,
  normalizeMmsi,
} from "./emergency-reference";

describe("normalizing what a shop typed", () => {
  const base = { lines: [], vessel: "", shoreContact: "", plan: "" };

  it("drops a line with no number", () => {
    // A label with nothing to dial is a note, and the manifest is not the place
    // for notes.
    const result = normalizeEmergencyReference({
      ...base,
      lines: [
        { label: "Chamber", phone: "" },
        { label: "DAN", phone: "+1 919 684 9111" },
      ],
    });
    expect(result.lines).toEqual([{ label: "DAN", phone: "+1 919 684 9111" }]);
  });

  it("keeps a number with no label — it is still dialable", () => {
    const result = normalizeEmergencyReference({ ...base, lines: [{ label: "", phone: "911" }] });
    expect(result.lines).toEqual([{ label: "", phone: "911" }]);
  });

  it("trims everything and bounds the list", () => {
    const many = Array.from({ length: MAX_EMERGENCY_LINES + 3 }, (_, i) => ({
      label: `  Line ${i}  `,
      phone: `  55500${i}  `,
    }));
    const result = normalizeEmergencyReference({ ...base, lines: many, vessel: "  Mantis I  " });
    expect(result.lines).toHaveLength(MAX_EMERGENCY_LINES);
    expect(result.lines[0]).toEqual({ label: "Line 0", phone: "555000" });
    expect(result.vessel).toBe("Mantis I");
  });
});

describe("whether the shop has recorded anything", () => {
  it("is false for an untouched shop", () => {
    // Which is what makes the manifest ask, rather than render an empty panel a
    // crew cannot tell apart from a shop with no numbers.
    expect(hasEmergencyReference(EMPTY_EMERGENCY_REFERENCE)).toBe(false);
  });

  it("is true on any one field", () => {
    for (const filled of [
      { lines: [{ label: "Chamber", phone: "911" }] },
      { vessel: "Mantis I" },
      { shoreContact: "Dana, +1 305 555 0100" },
      { plan: "Call the chamber first." },
    ]) {
      expect(hasEmergencyReference({ ...EMPTY_EMERGENCY_REFERENCE, ...filled })).toBe(true);
    }
  });
});

/**
 * **It has to be in the snapshot, or none of it matters.**
 *
 * The whole argument for this feature is that the numbers are on the device
 * when the signal is not. A chamber number that renders on the live manifest
 * and drops out of the offline copy is the laminated-card-in-the-shop failure
 * with extra steps, so this asserts the contract at the boundary the snapshot
 * actually crosses (issue #688).
 */
describe("the offline snapshot's shop identity", () => {
  it("carries the emergency reference through serialization", async () => {
    const { serializeManifests } = await import("./offline-manifests");
    const reference = {
      lines: [{ label: "Chamber (Key Largo)", phone: "+1 305 555 0111" }],
      vessel: "Mantis I",
      shoreContact: "Dana, +1 305 555 0100",
      plan: "Call the chamber, then the coastguard.",
    };

    const payload = serializeManifests(
      [],
      {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: reference,
      },
      (blocker) => blocker.code,
    );

    expect(payload.shop.emergencyReference).toEqual(reference);
    // And it survives the JSON round trip the encrypted store puts it through —
    // a `Date` or a `Map` in here would arrive on the boat as an empty object.
    expect(JSON.parse(JSON.stringify(payload)).shop.emergencyReference).toEqual(reference);
  });
});

describe("the departure's own boat (fourth review, item 11)", () => {
  const shop = {
    lines: [{ label: "DAN", phone: "+1 919 684 9111" }],
    vessel: "Mantis II - VHF 16, MMSI 338055501",
    shoreContact: "Front desk",
    plan: "Radio first.",
  };
  const mantisOne = { name: "Mantis I", callSign: "WDM2201", mmsi: "338055502" };

  it("prints the boat the departure sails on, never the shop-wide hull", () => {
    // The shop line names Mantis II; a departure on Mantis I read that MMSI
    // off the card made for the coastguard's first question.
    const reference = emergencyReferenceForDeparture(shop, mantisOne);
    expect(reference.boat).toEqual(mantisOne);
    expect(reference.vessel).toBe("");
    expect(reference.lines).toEqual(shop.lines);
    expect(reference.plan).toBe("Radio first.");
  });

  it("keeps the shop line when the boat's row holds no call sign and no MMSI", () => {
    // Review B1: on upgrade day every boat has neither, and the shop line is
    // where the MMSI was typed. Dropping it lost the one figure the card was
    // read for until someone found the two new fields.
    const bare = { name: "Mantis I", callSign: null, mmsi: null };
    const reference = emergencyReferenceForDeparture(shop, bare);
    expect(reference.boat).toEqual(bare);
    expect(reference.vessel).toBe(shop.vessel);
  });

  it("drops the shop line once the boat holds either radio fact", () => {
    expect(
      emergencyReferenceForDeparture(shop, { name: "Mantis I", callSign: "WDM2201", mmsi: null })
        .vessel,
    ).toBe("");
    expect(
      emergencyReferenceForDeparture(shop, { name: "Mantis I", callSign: null, mmsi: "338055502" })
        .vessel,
    ).toBe("");
  });

  it("keeps the shop line for a departure on no boat", () => {
    const reference = emergencyReferenceForDeparture(shop, null);
    expect(reference.boat).toBeNull();
    expect(reference.vessel).toBe(shop.vessel);
  });

  it("never counts a boat alone as something recorded", () => {
    // The boat is the departure's, not the shop's reference: a hull name and
    // call sign are not an emergency number, so the absence is still stated.
    const boatOnly = { name: "Mantis I", callSign: "WDM2201", mmsi: null };
    expect(
      hasEmergencyReference(emergencyReferenceForDeparture(EMPTY_EMERGENCY_REFERENCE, boatOnly)),
    ).toBe(false);
    expect(
      hasEmergencyReference(emergencyReferenceForDeparture(EMPTY_EMERGENCY_REFERENCE, null)),
    ).toBe(false);
  });
});

describe("a boat's radio identity as typed", () => {
  it("reads an MMSI with the spaces a licence prints", () => {
    expect(normalizeMmsi(" 338 055 502 ")).toBe("338055502");
    expect(normalizeMmsi("338-055-502")).toBe("338055502");
    expect(normalizeMmsi("")).toBeNull();
  });

  it("refuses an MMSI that is not nine digits", () => {
    expect(normalizeMmsi("33805550")).toBe("invalid");
    expect(normalizeMmsi("3380555021")).toBe("invalid");
    expect(normalizeMmsi("33805550O")).toBe("invalid");
  });

  it("upper-cases a call sign and refuses one that cannot be read over the radio", () => {
    expect(normalizeCallSign("  wdm2201 ")).toBe("WDM2201");
    expect(normalizeCallSign("   ")).toBeNull();
    expect(normalizeCallSign("WDM/2201")).toBe("invalid");
    expect(normalizeCallSign("A".repeat(13))).toBe("invalid");
  });
});
