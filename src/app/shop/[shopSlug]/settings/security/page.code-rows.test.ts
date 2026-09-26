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

/**
 * **A session row's Revoke rings inside the row.** The word ends on the row's
 * 12px inset (`flush`, K-06), so its hover fill reaches 4px from the sunken
 * row's edge and the outset ring, 5px past the fill, a pixel beyond it.
 */
describe("the security page's session rows", () => {
  it("draws Revoke's ring inside its sunken row", () => {
    const revoke = SOURCE.slice(SOURCE.indexOf("revokeSessionAction.bind"));
    const call = revoke.slice(revoke.indexOf("buttonClass("), revoke.indexOf("})}") + 3);
    expect(call).toContain("flush: true");
    expect(call).toContain("focus-visible:focus-ring-inset");
  });

  /**
   * **Revoke stays at the row's end** (pixel-craft class 5). A real user
   * agent is longer than the row, and the device line's `<span>` had no flex
   * basis to give up, so it pushed the Revoke form onto a second flex line:
   * Revoke alone under the text, and the grey box 12px above the words and 25px
   * below them (K-448). The line takes the room that is left and wraps in it,
   * breaking a long unspaced token (an IPv6 address) rather than running under
   * the button; the form keeps its own width.
   */
  it("keeps Revoke beside the device line, however long the line", () => {
    const row = SOURCE.slice(SOURCE.indexOf("sessions.map("), SOURCE.indexOf("</li>"));
    /** The first `<tag …>` in the row: its opening tag alone, and its classes. */
    const opening = (tag: string) => {
      const start = row.indexOf(`<${tag}`);
      const open = row.slice(start, row.indexOf(">", start));
      return { open, classes: open.match(/className="([^"]*)"/)?.[1].split(/\s+/) ?? [] };
    };
    expect(opening("span").classes).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "break-words"]),
    );
    const form = opening("form");
    expect(form.open).toContain("revokeSessionAction");
    expect(form.classes).toContain("shrink-0");
  });

  /**
   * **A wrapped device line never opens on a separator** (pixel-craft class
   * 8). The three parts were joined by " · " with an ordinary space before
   * each dot, so a user agent that wrapped could start its next line "· 127.0.0.1",
   * the defect K-590 fixed on the Print register. The dot is glued to the part
   * before it.
   */
  it("glues each separator to the part before it", () => {
    const line = SOURCE.slice(
      SOURCE.indexOf("sessions.map("),
      SOURCE.indexOf("<form", SOURCE.indexOf("sessions.map(")),
    );
    expect(line).not.toMatch(/ ·\{" "\}/);
    expect(
      line.split('{"\\u00a0· "}').length - 1,
      "one before the address, one before the time",
    ).toBe(2);
  });
});
