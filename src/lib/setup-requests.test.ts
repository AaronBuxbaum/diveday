import { describe, expect, it } from "vitest";
import {
  parseSetupRequest,
  SETUP_CURRENT_SYSTEM_KEYS,
  SETUP_CURRENT_SYSTEMS,
  SETUP_TEXT_MAX,
  trippedHoneypot,
} from "./setup-requests";

const complete = {
  shopName: "  Reef Line Divers ",
  region: "Key Largo, FL",
  runsBoat: "yes",
  currentSystem: "spreadsheet",
  contactName: "Ana Ruiz",
  email: "Ana@ReefLine.example",
  phone: "",
};

describe("parseSetupRequest", () => {
  it("accepts a complete request, trimmed, with the email lowered and a blank phone as null", () => {
    expect(parseSetupRequest(complete)).toEqual({
      ok: true,
      data: {
        shopName: "Reef Line Divers",
        region: "Key Largo, FL",
        runsBoat: true,
        currentSystem: "spreadsheet",
        contactName: "Ana Ruiz",
        email: "ana@reefline.example",
        phone: null,
      },
    });
  });

  it("reads 'no' as a shop without a boat and keeps a phone that was given", () => {
    const parsed = parseSetupRequest({ ...complete, runsBoat: "no", phone: " +1 305 555 0100 " });
    expect(parsed.ok && parsed.data.runsBoat).toBe(false);
    expect(parsed.ok && parsed.data.phone).toBe("+1 305 555 0100");
  });

  it("names every missing required field, and only those", () => {
    const parsed = parseSetupRequest({});
    expect(parsed).toEqual({
      ok: false,
      fieldErrors: {
        shopName: "required",
        region: "required",
        runsBoat: "required",
        currentSystem: "required",
        contactName: "required",
        email: "required",
      },
    });
  });

  it("refuses a malformed email, an overlong name and an answer off the list as invalid", () => {
    const parsed = parseSetupRequest({
      ...complete,
      email: "not-an-address",
      shopName: "x".repeat(SETUP_TEXT_MAX + 1),
      currentSystem: "abacus",
      runsBoat: "maybe",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors.email).toBe("invalid");
    expect(parsed.fieldErrors.shopName).toBe("invalid");
    // An answer that is not one of the offered ones is the same as no answer.
    expect(parsed.fieldErrors.currentSystem).toBe("required");
    expect(parsed.fieldErrors.runsBoat).toBe("required");
  });

  it("treats a field that arrived as anything but a string as blank", () => {
    const parsed = parseSetupRequest({ ...complete, shopName: ["Reef"], email: 42 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors).toEqual({ shopName: "required", email: "required" });
  });

  it("refuses an overlong phone rather than truncating it", () => {
    const parsed = parseSetupRequest({ ...complete, phone: "5".repeat(31) });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors).toEqual({ phone: "invalid" });
  });

  it("refuses a line break smuggled into an answer that lands in a mail subject", () => {
    const parsed = parseSetupRequest({
      ...complete,
      shopName: "Reef\r\nBcc: everyone@example.com",
      region: "Key\u0000Largo",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors).toEqual({ shopName: "invalid", region: "invalid" });
  });

  it("takes a phone written the ways people write one, and refuses anything else", () => {
    expect(parseSetupRequest({ ...complete, phone: "+1 (305) 555-0100" }).ok).toBe(true);
    const parsed = parseSetupRequest({ ...complete, phone: "<b>call me</b>" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors).toEqual({ phone: "invalid" });
  });
});

describe("trippedHoneypot", () => {
  it("is tripped by any non-blank value and by nothing else", () => {
    expect(trippedHoneypot("https://spam.example")).toBe(true);
    expect(trippedHoneypot("")).toBe(false);
    expect(trippedHoneypot("   ")).toBe(false);
    expect(trippedHoneypot(null)).toBe(false);
  });
});

describe("SETUP_CURRENT_SYSTEM_KEYS", () => {
  it("words every answer the form offers", () => {
    expect(Object.keys(SETUP_CURRENT_SYSTEM_KEYS).sort()).toEqual(
      [...SETUP_CURRENT_SYSTEMS].sort(),
    );
  });
});
