import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the guide body is a cached async Server Component behind the
 * request's locale, so this pins the source that decides the geometry; the
 * pixel probe measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** The opening tag of the first `<section>` after `marker`. */
function sectionAfter(marker: string) {
  const at = SOURCE.indexOf(marker);
  expect(at, `${marker} is where this test looks`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("<section", at);
  return SOURCE.slice(open, SOURCE.indexOf(">", open) + 1);
}

/**
 * **No guide stacks two rules** (K-204). `GuideContext` is ruled below now,
 * so the coexist band that follows it on the booking-channel guides is ruled
 * below only; its old `border-y` would have drawn a second hairline on top of
 * the context's.
 */
describe("the coexist band", () => {
  it("is ruled below only, under the context band's own rule", () => {
    const section = sectionAfter("{guide.coexist && (");
    expect(section).toContain("border-b border-border");
    expect(section).not.toContain("border-y");
  });
});

/** The opening tag of the first element after `marker` whose tag starts `tag`. */
function tagAfter(marker: string, tag: string) {
  const at = SOURCE.indexOf(marker);
  expect(at, `${marker} is where this test looks`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf(tag, at);
  return SOURCE.slice(open, SOURCE.indexOf(">", open) + 1);
}

/**
 * **One padding for every eyebrow-and-prose band** (K-518): the coexist and
 * website bands take the guide module's band box rather than a hand copy of
 * it, the copy that let "you are here" drift to `py-14`.
 */
describe("the guide's own bands", () => {
  it("pad their box with the guide module's band class", () => {
    for (const marker of ["{guide.coexist && (", "{guide.website && ("]) {
      expect(tagAfter(marker, "<div")).toContain("className={GUIDE_BAND_CLASS}");
    }
  });
});
