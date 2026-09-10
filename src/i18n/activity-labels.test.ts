import { describe, expect, it } from "vitest";
import { ACTIVITY_CODES, activityParams, isActivityCode } from "@/lib/activity";
import { activityLine } from "./activity-labels";
import { staffTranslator } from "./staff-messages";

/**
 * **The union and the bundles, held together.**
 *
 * `src/lib/activity.ts` closes the set of things the trail can say; the bundles
 * carry the sentences. A code with no sentence renders as a raw key on a shop's
 * screen, and a sentence with no code is copy nobody will ever read — so both
 * directions are checked here, in both languages, which is the whole reason the
 * column can be `text` rather than an enum (issue #1655).
 */
describe("activity lines", () => {
  const NAMES = { actor: "Marisol Vega", diver: "Priya Sharma", crew: "Diego Marín" };

  it.each(["en-US", "es-ES"])("words every code in %s", (locale) => {
    const t = staffTranslator(locale);

    for (const code of ACTIVITY_CODES) {
      // `self` is only read by the two support-needs sentences, and passing it
      // everywhere costs nothing: an ICU select over a parameter a message does
      // not mention is simply unused.
      const line = activityLine(t, { code, params: { ...NAMES, self: "no" } });
      expect(line.trim(), code).not.toBe("");
      // A missing key renders as the key itself, which is the failure this
      // catches: a code added to the union and to neither bundle.
      expect(line, code).not.toContain(`activity.line.${code}`);
      // And no placeholder survives unfilled.
      expect(line, code).not.toMatch(/\{[a-z]/i);
    }
  });

  it("says which side of the support-needs line the diver was on", () => {
    const t = staffTranslator("en-US");
    const staff = activityLine(t, {
      code: "support_needs_updated",
      params: { ...NAMES, self: "no" },
    });
    const own = activityLine(t, {
      code: "support_needs_updated",
      params: { ...NAMES, self: "yes" },
    });

    expect(staff).toContain(NAMES.actor);
    expect(own).not.toContain(NAMES.actor);
    expect(own).toContain("their dives");
  });

  /**
   * The column is text, so a row written by a newer build can be read by an
   * older one for the seconds a deploy takes. One honest sentence beats a raw
   * code on screen, and beats a throw taking a diver record down over one row
   * of history.
   */
  it("answers an unknown code with a sentence rather than the code", () => {
    const t = staffTranslator("en-US");
    const line = activityLine(t, { code: "something_a_later_build_writes", params: {} });

    expect(line).not.toContain("something_a_later_build_writes");
    expect(line.trim()).not.toBe("");
  });

  /**
   * A writer that omits a name is a compile error, so this is about the row
   * that reaches the renderer anyway. `translatorOnError` makes that loud
   * outside production on purpose — the alternative is a sentence with a gap in
   * it that no test and no dev server ever reports.
   */
  it("is loud rather than quiet about a payload missing a name", () => {
    const t = staffTranslator("en-US");

    expect(() =>
      activityLine(t, { code: "note_added", params: { actor: "Dana Reyes" } }),
    ).toThrow();
  });

  it("reads only string names out of a stored payload", () => {
    // Postgres hands back whatever was written, so the renderer reads through
    // `activityParams` rather than trusting the column's type.
    expect(activityParams({ actor: "Sal", count: 3, nested: { x: 1 } })).toEqual({ actor: "Sal" });
    expect(activityParams(null)).toEqual({});
    expect(activityParams(["Sal"])).toEqual({});
    expect(activityParams("Sal")).toEqual({});
  });

  it("knows its own codes and nothing else", () => {
    for (const code of ACTIVITY_CODES) expect(isActivityCode(code)).toBe(true);
    expect(isActivityCode("message")).toBe(false);
    expect(isActivityCode("")).toBe(false);
  });
});
