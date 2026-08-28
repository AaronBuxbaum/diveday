// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { DOOR_GLYPH_IDS, type DoorGlyphId, EntryDone } from "./EntryShell";

/**
 * **Slice 10a of ADR 20260827-first-light: the door speaks Clearwater.**
 *
 * Three laws, none of them a picture. The mark on a terminal door is *drawn*
 * (decision 2); a door renders **one** primary and nothing else button-shaped
 * (decision 1); and a dead link has two tiers — an account token never names a
 * shop, a booking token always offers the shop's hand (decision 3).
 *
 * Every assertion here is over the rule rather than the layout, deliberately:
 * a snapshot of these pages would fail on the next legitimate restyle and
 * teach the next reader to re-baseline without looking.
 */

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

function read(relativePath: string) {
  return readFileSync(join(SRC_DIR, relativePath), "utf8");
}

/** Every non-test `.ts`/`.tsx` under a directory, so a sweep can be stated as a fact. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Anything Unicode calls a picture — the emoji and the older dingbats that a
 * platform renders as a colour glyph anyway (the hourglass this component used
 * to wear is one of those). The same shape as the tinted-ink guards: a regex
 * over the file, because what this catches is a character typed into a source,
 * and no rendering test can see a character nobody has rendered yet.
 */
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/**
 * **The doors** — the pages a person meets before they are signed in, plus the
 * two email-lifecycle pages reached from an inbox. Not the bearer-token pages:
 * `/ready`, `/waivers`, `/recap` and `/claim` are the diver's thread, and
 * their own slices own their words (ADR 20260827-the-divers-thread).
 */
const DOORS = [
  "app/sign-in/page.tsx",
  "app/onboard/page.tsx",
  "app/forgot-password/page.tsx",
  "app/verify/[token]/page.tsx",
  "app/invite/[token]/page.tsx",
  "app/reset-password/[token]/page.tsx",
  "app/unsubscribe/[token]/page.tsx",
] as const;

describe("the terminal mark is drawn, never typed", () => {
  it("is a closed set of five situations", () => {
    // The ADR names four; `cancelled` is the fifth its census missed, and the
    // reason is in `EntryShell.tsx`'s own comment. Listed rather than counted
    // so adding one is a deliberate edit here as well as there.
    expect([...DOOR_GLYPH_IDS]).toEqual(["sent", "expired", "done", "quiet", "cancelled"]);
  });

  it.each([...DOOR_GLYPH_IDS])("draws %s as one currentColor stroke and no character", (glyph) => {
    const { container } = render(<EntryDone glyph={glyph} title="Title" text="Text." />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    // A stroke, not a fill: the mark follows the tone and the theme of
    // whatever renders it, which is the whole reason it carries no colour.
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.innerHTML.trim()).not.toBe("");
    // Nothing readable in the circle — the heading carries the meaning, in the
    // reader's own language, which is exactly what an emoji could not do.
    expect(container.textContent).not.toMatch(PICTOGRAPH);
  });

  it("draws a different mark for every situation", () => {
    const drawn = DOOR_GLYPH_IDS.map((glyph) => {
      const view = render(<EntryDone glyph={glyph} title="Title" text="Text." />);
      const markup = view.container.querySelector("svg")?.innerHTML ?? "";
      view.unmount();
      return markup;
    });
    expect(new Set(drawn).size).toBe(DOOR_GLYPH_IDS.length);
  });

  it("keeps the circle decorative and says the words once", () => {
    render(<EntryDone glyph="done" title="Email confirmed" text="You're all set." />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Email confirmed" })).toBeTruthy();
  });

  it("is typed, so no caller can hand it markup or an emoji", () => {
    // The compiler is the real guard. This states it where a reader will find
    // it, and `@ts-expect-error` is itself an error the day the prop widens
    // back to `string` — so the pin fails loudly rather than going quiet.
    // @ts-expect-error — an emoji is not a DoorGlyphId.
    const typed: DoorGlyphId = "\u23f3";
    expect([...DOOR_GLYPH_IDS]).not.toContain(typed);
  });
});

describe("no door types a picture", () => {
  it("holds across every component under account/", () => {
    const offenders = sourceFiles(HERE)
      .filter((file) => PICTOGRAPH.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("holds across every door page", () => {
    const offenders = DOORS.filter((door) => PICTOGRAPH.test(read(door)));
    expect(offenders).toEqual([]);
  });
});

/**
 * **One primary per door** (ADR 20260827-first-light, decision 1). A door asks
 * one thing; a second filled button beside it is the page asking the reader to
 * choose before they have done the one thing they came for. Sign-in's "Forgot
 * password?" is the case worth pinning — it claims a full touch target through
 * `buttonClass`, and it is a `link` variant, which is text.
 */
describe("a door renders one primary", () => {
  /** Each `buttonClass(…)` call in a source, as the options text it was handed. */
  function buttonCalls(source: string) {
    return [...source.matchAll(/buttonClass\(([^)]*)/g)].map(([, options]) => options);
  }

  it.each([...DOORS])("%s asks for exactly one filled button", (door) => {
    const primaries = buttonCalls(read(door)).filter((options) => !options.includes("variant:"));
    expect(primaries).toHaveLength(1);
  });

  it("counts sign-in's forgot-password link as text, not as a second button", () => {
    const signIn = read("app/sign-in/page.tsx");
    expect(signIn).toContain('variant: "link"');
    expect(buttonCalls(signIn)).toHaveLength(2);
  });
});

/**
 * **The dead-link law, in two tiers** (ADR 20260827-first-light, decision 3).
 * Already true in the code before this slice; normative from it.
 *
 * An **account** token belongs to a person, so its dead screen names no shop —
 * a forwarded invite link must not disclose who invited whom. A **booking**
 * token belongs to a diver holding a phone at a dock, whose one question is
 * who to ask, so its dead screen hands over the shop's name and contact
 * through `ExpiredLinkCard`.
 */
describe("the dead-link law has two tiers", () => {
  /** Each account door, with the message subtree its dead link says itself in. */
  const ACCOUNT_TIER: [page: string, keys: string][] = [
    ["app/verify/[token]/page.tsx", "account.verify"],
    ["app/reset-password/[token]/page.tsx", "account.resetPassword"],
    ["app/invite/[token]/page.tsx", "account.invite"],
    ["app/unsubscribe/[token]/page.tsx", "lastMinute.unsubscribe"],
  ];

  /**
   * `/claim` joined this tier in slice 10c (decision 4). Its dead state used to
   * be the bare door for *every* cause, which meant the most ordinary way of
   * reaching one — the seat was already claimed, so the link died inside the
   * claim itself — told a party member holding a forwarded URL to ask a shop
   * the page would not name. `/recap` is the fourth booking token and is
   * deliberately absent: it still renders the bare door for every dead cause,
   * which is drift against decision 3 that no slice of this program covers.
   */
  const BOOKING_TIER = [
    "app/waivers/[token]/page.tsx",
    "app/ready/[token]/page.tsx",
    "app/claim/[token]/page.tsx",
  ];

  it.each(ACCOUNT_TIER)("%s renders the bare door, never the shop's hand", (page) => {
    const source = read(page);
    expect(source).toContain("<EntryDone");
    expect(source).not.toContain("ExpiredLinkCard");
  });

  it.each(ACCOUNT_TIER)("%s says it in one unavailableTitle/Text pair", (page, keys) => {
    const source = read(page);
    expect(source).toContain(`${keys}.unavailableTitle`);
    expect(source).toContain(`${keys}.unavailableText`);
  });

  /**
   * The disclosure half, checked where it can actually be broken: a sentence
   * that interpolates a shop is a sentence somebody wrote a `{shopName}` into.
   * Both locales, because a translation is where a placeholder gets added back
   * by someone matching another string's shape.
   */
  it.each(ACCOUNT_TIER)("%s names no shop in either locale", (_page, keys) => {
    const [namespace, group] = keys.split(".");
    for (const locale of DIVER_LOCALES) {
      const bundle = DIVER_MESSAGES[locale] as unknown as Record<
        string,
        Record<string, Record<string, string>>
      >;
      const messages = bundle[namespace]?.[group] ?? {};
      for (const key of ["unavailableTitle", "unavailableText"] as const) {
        expect(messages[key]).toBeTruthy();
        expect(messages[key]).not.toMatch(/\{\s*shop/i);
      }
    }
  });

  it.each(BOOKING_TIER)("%s offers the shop's hand", (page) => {
    const source = read(page);
    expect(source).toContain("<ExpiredLinkCard");
    expect(source).toMatch(/shop=\{/);
  });
});
