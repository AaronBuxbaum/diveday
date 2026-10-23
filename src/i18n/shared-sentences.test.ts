import { describe, expect, it } from "vitest";
import { sayWords, sendLimitWords } from "./shared-sentences";
import { staffTranslator } from "./staff-messages";

/**
 * A staffer stopped by the hourly send bound needs to know whether it went
 * (UX sheet 2026-10-22, item 6): a trip link, a desk note and a resent invoice
 * on Today read the one shared sentence, in both locales, with what they sent
 * named (check 2026-10-23 found the invoice still on its own sentence).
 */
describe("the shared send-limit sentence", () => {
  it.each([
    ["en-US", "links", "a lot of links", "Nothing went out"],
    ["en-US", "notes", "a lot of notes", "Nothing went out"],
    ["es-ES", "links", "muchos enlaces", "No salió nada"],
    ["es-ES", "notes", "muchos avisos", "No salió nada"],
    ["en-US", "invoices", "a lot of invoices", "Nothing went out"],
    ["es-ES", "invoices", "muchas facturas", "No salió nada"],
  ] as const)("%s %s names the thing and says nothing went out", (locale, thing, named, none) => {
    const text = sayWords(staffTranslator(locale), sendLimitWords(thing));
    expect(text).toContain(named);
    expect(text).toContain(none);
  });
});
