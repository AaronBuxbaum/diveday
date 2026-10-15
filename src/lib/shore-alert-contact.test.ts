import { describe, expect, it } from "vitest";
import { nextShoreAlertContact, shoreAlertRecipient } from "./shore-alert-contact";

const NOW = new Date("2026-10-15T12:00:00Z");
const EARLIER = new Date("2026-10-01T09:00:00Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const NONE = { email: null, consentAt: null, consentByPersonId: null };
const ON_FILE = { email: "shore@example.com", consentAt: EARLIER, consentByPersonId: OWNER };

/** H-118: the shore contact hears a stale roll call only with a recorded consent. */
describe("shoreAlertRecipient", () => {
  it("is the address when the consent is on file", () => {
    expect(shoreAlertRecipient(ON_FILE)).toBe("shore@example.com");
  });

  it("is nobody without a consent, whatever the address", () => {
    expect(shoreAlertRecipient({ ...ON_FILE, consentAt: null })).toBeNull();
    expect(shoreAlertRecipient(NONE)).toBeNull();
  });

  it("is nobody when the address is blank", () => {
    expect(shoreAlertRecipient({ ...ON_FILE, email: "  " })).toBeNull();
  });
});

describe("nextShoreAlertContact", () => {
  const save = (current: typeof NONE | typeof ON_FILE, email: string, consented: boolean) =>
    nextShoreAlertContact({ current, email, consented, actorPersonId: MANAGER, now: NOW });

  it("refuses an address without the consent ticked", () => {
    expect(save(NONE, "shore@example.com", false)).toEqual({
      ok: false,
      reason: "consent_missing",
    });
  });

  it("refuses something that is not an address", () => {
    expect(save(NONE, "Maria, VHF 16", true)).toEqual({ ok: false, reason: "invalid_email" });
    expect(save(NONE, `${"a".repeat(320)}@example.com`, true)).toEqual({
      ok: false,
      reason: "invalid_email",
    });
  });

  it("records who consented and when for a new address", () => {
    expect(save(NONE, "  Shore@Example.com ", true)).toEqual({
      ok: true,
      value: { email: "Shore@Example.com", consentAt: NOW, consentByPersonId: MANAGER },
    });
  });

  it("keeps the original consent when the same address is saved again", () => {
    expect(save(ON_FILE, "shore@example.com", true)).toEqual({ ok: true, value: ON_FILE });
    expect(save(ON_FILE, "SHORE@example.com", true)).toEqual({
      ok: true,
      value: { ...ON_FILE, email: "SHORE@example.com" },
    });
  });

  it("records a fresh consent when the address changes", () => {
    expect(save(ON_FILE, "other@example.com", true)).toEqual({
      ok: true,
      value: { email: "other@example.com", consentAt: NOW, consentByPersonId: MANAGER },
    });
  });

  it("refuses a changed address whose consent was not ticked again", () => {
    expect(save(ON_FILE, "other@example.com", false)).toEqual({
      ok: false,
      reason: "consent_missing",
    });
  });

  it("refuses the address on file once its box is unticked: clearing it is how to stop", () => {
    expect(save(ON_FILE, "shore@example.com", false)).toEqual({
      ok: false,
      reason: "consent_missing",
    });
  });

  it("clears the consent with the address", () => {
    expect(save(ON_FILE, "", true)).toEqual({ ok: true, value: NONE });
    expect(save(ON_FILE, "   ", false)).toEqual({ ok: true, value: NONE });
  });
});
