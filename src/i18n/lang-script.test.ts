import { describe, expect, it } from "vitest";
import { localeCorrectionScript, localeDirection } from "./lang-script";
import { DIVER_LOCALES } from "./settings";

/**
 * **Nothing in this app had ever set a direction** — `globals.css` carried a
 * `:dir(rtl)` rule for the `<select>` indicator, written on purpose, that
 * could never match (issue #733). These pin the attribute now that it exists,
 * and pin that it is *derived* rather than typed.
 */
describe("localeDirection", () => {
  it("reads both shipped locales left to right", () => {
    for (const locale of DIVER_LOCALES) expect(localeDirection(locale), locale).toBe("ltr");
  });

  /**
   * Derived, so a third locale gets its direction for free rather than being
   * forgotten in a map somebody has to remember to edit. Arabic is not shipped
   * and this is not a claim that it is — it is the check that the derivation
   * is real.
   */
  it("would read Arabic right to left, without anybody adding it to a list", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("he-IL")).toBe("rtl");
  });

  it("falls back to ltr for a tag it cannot parse, rather than rendering no direction", () => {
    expect(localeDirection("not a locale")).toBe("ltr");
    expect(localeDirection("")).toBe("ltr");
  });
});

describe("the pre-hydration correction script", () => {
  it("sets the direction beside the language it just matched", () => {
    const script = localeCorrectionScript();
    expect(script).toContain("d.lang=l");
    expect(script).toContain("d.dir=");
    // The lookup is a table of *this build's* locales, resolved on the server.
    // The script never asks the visitor which way their language reads.
    for (const locale of DIVER_LOCALES) expect(script).toContain(`"${locale}":"ltr"`);
  });

  /**
   * The script is embedded with `dangerouslySetInnerHTML`, so every value in
   * it goes through `escapeForScriptContext` — a `</script>` in any of them
   * would end the block early.
   */
  it("escapes every value it embeds", () => {
    expect(localeCorrectionScript()).not.toContain("</");
  });
});
