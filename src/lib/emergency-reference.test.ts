import { describe, expect, it } from "vitest";
import {
  EMPTY_EMERGENCY_REFERENCE,
  hasEmergencyReference,
  MAX_EMERGENCY_LINES,
  normalizeEmergencyReference,
  telHref,
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

describe("the tel: link", () => {
  it("strips what a dialler does not use and keeps the plus", () => {
    expect(telHref("+1 (919) 684-9111")).toBe("tel:+19196849111");
  });

  it("keeps an extension pause the shop wrote", () => {
    expect(telHref("+1 305 555 0100,,204")).toBe("tel:+13055550100,,204");
  });

  it("dials a three-digit emergency short code", () => {
    // 112, 911, 999 are real numbers a crew would tap.
    expect(telHref("112")).toBe("tel:112");
  });

  it("refuses something that is not a number", () => {
    // Rendered as plain text instead — a link that dials nothing is worse than
    // no link when somebody is holding a regulator.
    expect(telHref("ask the divemaster")).toBeNull();
    expect(telHref("--")).toBeNull();
  });

  /**
   * **A tap must dial what is written, or nothing.**
   *
   * The first version stripped the non-dialable characters and asked only
   * whether three digits survived, which turned every mixed value into a
   * confidently *wrong* link. The seeded shop already writes
   * `Mantis II - VHF 16, MMSI 338055501` into this shape, so these are the
   * expected data rather than adversarial input — and the earlier tests missed
   * it entirely by probing only the zero-digit case (`code-reviewer`).
   */
  it.each([
    ["VHF 16 / 22A", "a channel and a backup channel"],
    ["VHF Ch 16, backup 68", "two channels in one field"],
    ["Ch 16 (MMSI 338055501)", "a channel beside a vessel identity"],
    ["1-800-DIVE-911", "a vanity number"],
    ["Chamber 305-555-0177 ext 4", "an extension"],
    ["911 or +1 305 555 0000", "two numbers in one field"],
  ])("never invents a number from %s (%s)", (value) => {
    expect(telHref(value)).toBeNull();
  });

  it("still dials the shapes a real number arrives in", () => {
    // The other half: a rule strict enough to refuse the above must not refuse
    // the punctuation people actually type.
    expect(telHref("+1 305 555 0177")).toBe("tel:+13055550177");
    expect(telHref("(305) 555-0177")).toBe("tel:3055550177");
    expect(telHref("305.555.0177")).toBe("tel:3055550177");
    // A pause/wait tail is dialable and is how a shop reaches an extension
    // without writing the word.
    expect(telHref("+1 305 555 0177,,123")).toBe("tel:+13055550177,,123");
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
