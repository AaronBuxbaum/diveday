import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_WINDOW_MS,
  type ConfirmationCodeSubject,
  confirmationCode,
  confirmationCodeMatches,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordBody,
  parseReplyKeyword,
} from "./reply-keywords";

/**
 * The parse and the code, with nothing else attached (ADR
 * 20260909-reply-keywords). What matters here is what is *refused*: a sentence
 * a diver wrote must never be read as a command, and a code must not verify
 * against a seat, a person, an address or a window it was not minted for.
 */

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);

const SUBJECT: ConfirmationCodeSubject = {
  shopId: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
  personId: "33333333-3333-4333-8333-333333333333",
  channel: "email",
  toAddress: "priya.sharma@example.com",
};

describe("parseReplyKeyword", () => {
  it("reads the fixed letters, in either case and with a phone keyboard's punctuation", () => {
    for (const body of ["C", "c", "C.", " c ", "«C»", "C!"]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "intent", intent: "cancel" });
    }
    for (const body of ["M", "m", "M."]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "intent", intent: "move" });
    }
  });

  it("reads the whole word in both shipped languages, accents folded", () => {
    for (const body of ["cancel", "Cancelar", "cancelación"]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "intent", intent: "cancel" });
    }
    for (const body of ["move", "mover", "Cambiar"]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "intent", intent: "move" });
    }
  });

  it("leaves a sentence alone, which is the whole point", () => {
    // Every one of these is a real message shape the inbox exists for. Reading
    // a command out of any of them would cancel a seat nobody asked about.
    for (const body of [
      "Can I cancel and rebook for next week?",
      "Moving house that weekend, sorry!",
      "C U at the dock",
      "cancel my booking please",
      "",
      "   ",
    ]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "none" });
    }
  });

  it("refuses anything longer than a word or two", () => {
    expect(parseReplyKeyword("c".repeat(KEYWORD_MAX_LENGTH + 1))).toEqual({ kind: "none" });
  });

  it("reads a code, and never reads one of our own words as a code", () => {
    expect(parseReplyKeyword("4KQ2ZP")).toEqual({ kind: "code", code: "4KQ2ZP" });
    expect(parseReplyKeyword("4kq2zp")).toEqual({ kind: "code", code: "4KQ2ZP" });
    // The alphabet's exclusions do this on their own — CANCEL carries an `L`,
    // MOVER is five characters — but the parse checks intents first anyway, and
    // this is the assertion that keeps both true.
    expect(parseReplyKeyword("CANCEL")).toEqual({ kind: "intent", intent: "cancel" });
    expect(parseReplyKeyword("CAMBIO")).toEqual({ kind: "intent", intent: "move" });
  });

  it("refuses a code-shaped string carrying an excluded character", () => {
    // `0`, `O`, `1`, `I` and `L` are the ones a diver mistypes for each other.
    for (const body of ["4KQ2Z0", "4KQ2ZO", "4KQ2Z1", "4KQ2ZI", "4KQ2ZL"]) {
      expect(parseReplyKeyword(body)).toEqual({ kind: "none" });
    }
  });
});

describe("normalizeKeywordBody", () => {
  it("folds accents, collapses whitespace, and strips surrounding punctuation only", () => {
    expect(normalizeKeywordBody("  ¿Cancelación?  ")).toBe("cancelacion");
    expect(normalizeKeywordBody("a  b")).toBe("a b");
  });
});

describe("confirmationCode", () => {
  it("is the length and alphabet a person can retype", () => {
    const code = confirmationCode(SUBJECT, NOW);
    expect(code).toHaveLength(CONFIRMATION_CODE_LENGTH);
    expect(code).toMatch(/^[23456789A-HJKMNP-Z]+$/);
  });

  it("verifies against the seat it was minted for", () => {
    expect(confirmationCodeMatches(confirmationCode(SUBJECT, NOW), SUBJECT, NOW)).toBe(true);
  });

  it("is bound to every field, so a code for one thing cannot act on another", () => {
    const code = confirmationCode(SUBJECT, NOW);
    const others: ConfirmationCodeSubject[] = [
      { ...SUBJECT, bookingId: "44444444-4444-4444-8444-444444444444" },
      { ...SUBJECT, personId: "55555555-5555-4555-8555-555555555555" },
      { ...SUBJECT, shopId: "66666666-6666-4666-8666-666666666666" },
      { ...SUBJECT, channel: "whatsapp" },
      { ...SUBJECT, toAddress: "someone.else@example.com" },
    ];
    for (const other of others) {
      expect(confirmationCodeMatches(code, other, NOW)).toBe(false);
    }
  });

  it("still verifies one window later, and stops the window after that", () => {
    const code = confirmationCode(SUBJECT, NOW);
    expect(confirmationCodeMatches(code, SUBJECT, NOW + CONFIRMATION_WINDOW_MS)).toBe(true);
    expect(confirmationCodeMatches(code, SUBJECT, NOW + 2 * CONFIRMATION_WINDOW_MS + 1)).toBe(
      false,
    );
  });

  it("refuses anything that is not a code at all", () => {
    expect(confirmationCodeMatches("nope", SUBJECT, NOW)).toBe(false);
    expect(confirmationCodeMatches("", SUBJECT, NOW)).toBe(false);
  });
});
