import { describe, expect, it } from "vitest";
import { guideSource } from "./funnel";
import { MIGRATION_GUIDE_SLUGS } from "./migration-guides";
import {
  asksWhichSystem,
  parseSetupRequest,
  SETUP_CURRENT_SYSTEM_KEYS,
  SETUP_CURRENT_SYSTEMS,
  SETUP_TEXT_MAX,
  setupPreselection,
  setupSentAdvice,
  setupSentPath,
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
        currentSystemGuide: null,
      },
    });
  });

  it("accepts an unanswered current tool without inventing a system or keeping a stale guide", () => {
    const parsed = parseSetupRequest({ ...complete, currentSystem: "", currentSystemGuide: "eve" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.currentSystem).toBeUndefined();
    expect(parsed.data.currentSystemGuide).toBeNull();
    expect(setupSentPath("/get-set-up/sent", parsed.data.currentSystem)).toBe("/get-set-up/sent");
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
    expect(parsed.fieldErrors.currentSystem).toBe("invalid");
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

  it("refuses format characters and Unicode line separators that hide or break a line", () => {
    for (const contactName of [
      "Ana\u202eziuR",
      "Ana\u200dRuiz",
      "Ana\u2028Ruiz",
      "Ana\u2029Ruiz",
    ]) {
      const parsed = parseSetupRequest({ ...complete, contactName });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.fieldErrors).toEqual({ contactName: "invalid" });
    }
  });

  it("keeps accented and non-Latin names", () => {
    expect(parseSetupRequest({ ...complete, contactName: "José Núñez 李" }).ok).toBe(true);
  });

  it("takes a phone written the ways people write one, and refuses anything else", () => {
    expect(parseSetupRequest({ ...complete, phone: "+1 (305) 555-0100" }).ok).toBe(true);
    const parsed = parseSetupRequest({ ...complete, phone: "<b>call me</b>" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors).toEqual({ phone: "invalid" });
  });
});

describe("which booking system or shop software", () => {
  it("asks only after a booking system or dive-shop software", () => {
    expect(asksWhichSystem("booking_system")).toBe(true);
    expect(asksWhichSystem("shop_software")).toBe(true);
    for (const answer of ["paper", "spreadsheet", "other", "", undefined]) {
      expect(asksWhichSystem(answer)).toBe(false);
    }
  });

  it("keeps the system named after one of those two answers", () => {
    const parsed = parseSetupRequest({
      ...complete,
      currentSystem: "booking_system",
      currentSystemGuide: "fareharbor",
    });
    expect(parsed.ok && parsed.data.currentSystemGuide).toBe("fareharbor");
  });

  it("drops it after any other answer, and drops a system with no guide", () => {
    const afterPaper = parseSetupRequest({
      ...complete,
      currentSystem: "paper",
      currentSystemGuide: "fareharbor",
    });
    expect(afterPaper.ok && afterPaper.data.currentSystemGuide).toBeNull();
    for (const crafted of ["", "constructor", "FareHarbor", ["eve"], 7]) {
      const parsed = parseSetupRequest({
        ...complete,
        currentSystem: "shop_software",
        currentSystemGuide: crafted,
      });
      expect(parsed.ok && parsed.data.currentSystemGuide).toBeNull();
    }
  });

  it("preselects the system a reader came from on any guide's door", () => {
    expect(setupPreselection(guideSource("fareharbor", "close"))).toEqual({
      currentSystem: "booking_system",
      currentSystemGuide: "fareharbor",
    });
    expect(setupPreselection(guideSource("eve", "concierge"))).toEqual({
      currentSystem: "shop_software",
      currentSystemGuide: "eve",
    });
    for (const slug of MIGRATION_GUIDE_SLUGS) {
      const preselected = setupPreselection(guideSource(slug));
      expect(preselected?.currentSystemGuide).toBe(slug);
      expect(asksWhichSystem(preselected?.currentSystem)).toBe(true);
    }
  });

  it("preselects nothing from any other door", () => {
    for (const source of ["pricing", "switching-hub-concierge", "switching-spreadsheet", "x"]) {
      expect(setupPreselection(source)).toBeNull();
    }
    expect(setupPreselection(undefined)).toBeNull();
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

describe("setupSentAdvice", () => {
  it("answers paper, a spreadsheet and another system each with its own first step", () => {
    expect(setupSentAdvice("paper")).toEqual({ key: "marketing.setUp.sent.paper" });
    expect(setupSentAdvice("spreadsheet")?.link?.href).toBe(
      "/switching/spreadsheet?from=setup-sent",
    );
    expect(setupSentAdvice("booking_system")?.link?.href).toBe("/switching?from=setup-sent");
    expect(setupSentAdvice("shop_software")?.key).toBe("marketing.setUp.sent.system");
  });

  it("says nothing more for something else, a missing answer or a crafted one", () => {
    expect(setupSentAdvice("other")).toBeNull();
    expect(setupSentAdvice(undefined)).toBeNull();
    expect(setupSentAdvice(["paper", "paper"])).toBeNull();
    expect(setupSentAdvice("constructor")).toBeNull();
  });

  it("links the named system's own guide", () => {
    expect(setupSentAdvice("booking_system", "fareharbor")).toEqual({
      key: "marketing.setUp.sent.system",
      link: {
        href: "/switching/fareharbor?from=setup-sent",
        key: "marketing.setUp.sent.systemGuideLink",
        competitor: "FareHarbor",
      },
    });
    expect(setupSentAdvice("shop_software", "eve")?.link?.href).toBe(
      "/switching/eve?from=setup-sent",
    );
  });

  it("falls back to every guide for an unknown system, and ignores one after paper", () => {
    expect(setupSentAdvice("booking_system", "constructor")?.link?.href).toBe(
      "/switching?from=setup-sent",
    );
    expect(setupSentAdvice("booking_system", ["eve", "eve"])?.link?.href).toBe(
      "/switching?from=setup-sent",
    );
    expect(setupSentAdvice("paper", "eve")).toEqual({ key: "marketing.setUp.sent.paper" });
  });
});

describe("setupSentPath", () => {
  it("carries what they use, and the system's guide only after a system", () => {
    expect(setupSentPath("/get-set-up/sent", "booking_system", "rezdy")).toBe(
      "/get-set-up/sent?uses=booking_system&guide=rezdy",
    );
    expect(setupSentPath("/get-set-up/sent", "booking_system", null)).toBe(
      "/get-set-up/sent?uses=booking_system",
    );
    expect(setupSentPath("/get-set-up/sent", "paper", "rezdy")).toBe("/get-set-up/sent?uses=paper");
  });
});
