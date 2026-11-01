import { describe, expect, it } from "vitest";
import {
  nextShoreAlertContact,
  type ShoreAlertContact,
  shoreAlertRecipient,
} from "./shore-alert-contact";

const NOW = new Date("2026-10-15T12:00:00Z");
const EARLIER = new Date("2026-10-01T09:00:00Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const CONFIRMED = new Date("2026-10-02T10:00:00Z");
const NONE: ShoreAlertContact = {
  email: null,
  consentAt: null,
  consentByPersonId: null,
  confirmedAt: null,
};
const ON_FILE: ShoreAlertContact = {
  email: "shore@example.com",
  consentAt: EARLIER,
  consentByPersonId: OWNER,
  confirmedAt: CONFIRMED,
};

/** H-20261014-stale-roll-call-recipients: the shore contact hears a stale roll call only with a recorded consent. */
describe("shoreAlertRecipient", () => {
  it("is the address when the consent is on file and the inbox confirmed it", () => {
    expect(shoreAlertRecipient(ON_FILE)).toBe("shore@example.com");
  });

  it("is nobody until the address is confirmed by its link (H-20261014-stale-roll-call-recipients review)", () => {
    expect(shoreAlertRecipient({ ...ON_FILE, confirmedAt: null })).toBeNull();
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
  /**
   * `consentFor` is the address the box was rendered ticked for: the one on
   * file when its consent is, "" when the box was drawn empty.
   */
  const save = (
    current: ShoreAlertContact,
    email: string,
    consented: boolean,
    consentFor = current.consentAt ? (current.email ?? "") : "",
  ) =>
    nextShoreAlertContact({
      current,
      email,
      consented,
      consentFor,
      actorPersonId: MANAGER,
      now: NOW,
    });

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
      change: "set",
      value: {
        email: "Shore@Example.com",
        consentAt: NOW,
        consentByPersonId: MANAGER,
        confirmedAt: null,
      },
    });
  });

  it("keeps the original consent when the same address is saved again", () => {
    expect(save(ON_FILE, "shore@example.com", true)).toEqual({
      ok: true,
      change: "unchanged",
      value: ON_FILE,
    });
    expect(save(ON_FILE, "SHORE@example.com", true)).toEqual({
      ok: true,
      change: "unchanged",
      value: { ...ON_FILE, email: "SHORE@example.com" },
    });
  });

  it("records a fresh, unconfirmed consent when the address changes under a fresh tick", () => {
    expect(save(ON_FILE, "other@example.com", true, "")).toEqual({
      ok: true,
      change: "changed",
      value: {
        email: "other@example.com",
        consentAt: NOW,
        consentByPersonId: MANAGER,
        confirmedAt: null,
      },
    });
  });

  it("refuses a changed address with the old tick: the box spoke for the old one (H-20261014-stale-roll-call-recipients review)", () => {
    expect(save(ON_FILE, "other@example.com", true, "shore@example.com")).toEqual({
      ok: false,
      reason: "consent_missing",
    });
    // Whatever the case, the tick was drawn for another address.
    expect(save(ON_FILE, "Other@Example.com", true, "SHORE@example.com")).toEqual({
      ok: false,
      reason: "consent_missing",
    });
  });

  it("refuses a tick rendered for an address the shop no longer names", () => {
    // A stale form: the box was drawn for an address since cleared.
    expect(save(NONE, "shore@example.com", true, "older@example.com")).toEqual({
      ok: false,
      reason: "consent_missing",
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
    expect(save(ON_FILE, "", true)).toEqual({ ok: true, change: "cleared", value: NONE });
    expect(save(ON_FILE, "   ", false)).toEqual({ ok: true, change: "cleared", value: NONE });
    expect(save(NONE, "", false)).toEqual({ ok: true, change: "unchanged", value: NONE });
  });
});
