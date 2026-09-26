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

  /** K-495: every band's heading-to-lede step is the guide module's one value. */
  it("set their lede with the guide module's band lede class", () => {
    for (const marker of ["{guide.coexist && (", "{guide.website && ("]) {
      const at = SOURCE.indexOf(marker);
      const band = SOURCE.slice(at, SOURCE.indexOf("</section>", at));
      expect(band).toContain("<p className={GUIDE_BAND_LEDE_CLASS}>");
    }
    expect(SOURCE).not.toContain("max-w-2xl text-lg leading-8 text-muted");
  });
});

/**
 * **The callout links are 44px targets that answer a hover** (K-258).
 *
 * "See what DiveDay costs →" and "Email us at switch@dive.day" were
 * `inline-block` 24px words, and already underlined, so hovering them changed
 * nothing (the state atlas found 0 pixels between rest and hover). Each now
 * takes `tapTargetLinkClass` and thickens its underline on hover, on a line the
 * text's own 24px tall so the callout keeps its padding.
 */
describe("the coexist and website callout links", () => {
  const constant = SOURCE.match(/const CALLOUT_LINK_CLASS = `([^`]*)`;/);

  it("share one class: a 44px target whose underline thickens on hover", () => {
    expect(constant, "CALLOUT_LINK_CLASS is declared in the page").not.toBeNull();
    expect(constant?.[1]).toMatch(/^\$\{tapTargetLinkClass\} /);
    expect(constant?.[1]).toContain("hover:decoration-2");
  });

  it("each sits on a 24px line of its own, the target bleeding into the gap and padding", () => {
    for (const marker of ['href="/pricing"', "href={`mailto:"]) {
      const at = SOURCE.indexOf(marker);
      expect(at, `${marker} is where this test looks`).toBeGreaterThan(-1);
      const link = SOURCE.slice(at, SOURCE.indexOf(">", at));
      expect(link).toContain("className={CALLOUT_LINK_CLASS}");
      const line = SOURCE.lastIndexOf("<p ", at);
      expect(SOURCE.slice(line, SOURCE.indexOf(">", line) + 1)).toBe(
        '<p className="mt-4 flex h-6 items-center">',
      );
    }
    expect(SOURCE).not.toContain("inline-block font-medium text-primary underline");
  });
});
