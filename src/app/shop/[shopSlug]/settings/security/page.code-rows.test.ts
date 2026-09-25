import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** Each `<form …>…</form>` that asks for a code. */
const CODE_FORMS = SOURCE.split("<form")
  .slice(1)
  .map((form) => form.slice(0, form.indexOf("</form>")))
  .filter((form) => form.includes('name="code"'));

/**
 * **Every code box stands level with the button beside it.** Step-up, turning
 * two-factor off and turning it on each put a code box in a `Field` on one
 * `items-end` line with an `md` button; the box was the stacked field's 44px,
 * so each button stood 4px above the box's top edge. The probe groups a
 * `Field`'s box with its caption, so it never compared the two; this was found
 * by reading the code (review of 2026-09-25).
 */
describe("the security page's code rows", () => {
  it("draws each of the three code boxes at md", () => {
    expect(CODE_FORMS).toHaveLength(3);
    for (const form of CODE_FORMS) {
      expect(form).toContain('className={controlClassFor("md")}');
    }
    expect(SOURCE).not.toContain("className={controlClass}");
  });
});
