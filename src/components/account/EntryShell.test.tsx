// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import {
  DOOR_GLYPH_IDS,
  type DoorGlyphId,
  EntryDone,
  EntryShell,
  entryPanelClass,
} from "./EntryShell";
import { EntryShellSkeleton } from "./EntryShellSkeleton";

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
  // What `/onboard` is without the setup key (ADR 20260925-shops-are-set-up-by-hand).
  "app/onboard/_components/ClosedDoor.tsx",
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
    render(<EntryDone glyph="done" title="Email confirmed" text="You’re all set." />);
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
 * **The panel is a phone-width nothing** (2026-09-17 design review).
 *
 * Every door shares one constant, so the rule can be stated once. The bug it
 * closes is one unscoped utility among five scoped ones: `shadow-bed` drew a
 * soft box below `sm` where there was no border, no ground and no padding to
 * justify it, so the fields on sign-in, forgot-password, the staff invite and
 * set-password all sat inside a faint edge-to-edge rectangle — loudest in dark
 * mode, where the bed is `rgba(0, 0, 0, 0.35)`.
 *
 * Asserted as a fact about the class string rather than a computed style,
 * because jsdom resolves no media queries and this *is* a media-query rule.
 */
describe("the door's panel", () => {
  it("draws nothing below sm — every surface utility is breakpoint-scoped", () => {
    const panel = entryPanelClass.split(/\s+/).filter(Boolean);
    const unscoped = panel.filter((utility) => !utility.startsWith("sm:"));
    // The margin above the panel is the one thing that is not the surface.
    expect(unscoped).toEqual(["mt-8"]);
    for (const utility of ["sm:border", "sm:bg-surface", "sm:p-8", "sm:shadow-bed"]) {
      expect(panel).toContain(utility);
    }
  });

  it("hands the skeleton the same frame, so neither can drift", () => {
    expect(read("components/account/EntryShellSkeleton.tsx")).toContain("entryPanelClass");
  });
});

/**
 * **The way out is a target, not a word** (docs/design/pixel-craft.md, class
 * 7). Every door hands its "Back to sign in" to one of two slots — the shell's
 * footer or a terminal door's action — and each page typed the link as bare
 * text, so the pixel probe measured it at 96.3 × 17px on forgot-password, the
 * staff invite, reset-password and verify. The slot owns the floor, so a link
 * passed into it is 44px tall whatever the page typed.
 *
 * **And the line it sits on stays a line.** A 44px link is an atomic inline
 * box, and an atomic inline's margin box is what sizes its line, so the slot
 * hands back (44 − 20) / 2 above and below it. Without that, every line
 * holding a link grew from 20px to 44px: a two-row footer's words stood 24px
 * apart instead of 8, and a sentence that wraps its link onto a second line
 * (the closed onboarding door's "Try the live demo") set its two lines 32px
 * apart instead of 20.
 */
describe("a door's links are tap targets", () => {
  /**
   * `tapTargetLinkClass`, applied by the slot to its links — under `:where(&)`,
   * so the rule weighs (0,0,1) and a link's own class wins. The plain `[&_a]:`
   * form weighs (0,1,1) and would cut a `buttonClass()` link's `min-h-12` to
   * 44px. The footer reaches every link in it (`_a`); a terminal door's action
   * reaches only a link that is the whole action (`>a`).
   */
  const FOOTER = "[:where(&)_a]:";
  const ACTION = "[:where(&)>a]:";
  const floorOf = (variant: string) =>
    tapTargetLinkClass.split(" ").map((utility) => `${variant}${utility}`);

  /** Tailwind's `--spacing`: `min-h-11` is 44px, `-my-3` hands back 12. */
  const SPACING_PX = 4;
  /** `text-sm`'s line box, which both slots set their words in. */
  const TEXT_SM_LINE_PX = 20;

  /** The px one of the slot's rules sets on its links: `…min-h-11` → 44, `…-my-3` → 12. */
  function step(slot: Element | null | undefined, variant: string, utility: string): number {
    const prefix = `${variant}${utility}-`;
    const found = [...(slot?.classList ?? [])].find((name) => name.startsWith(prefix));
    return found ? Number(found.slice(prefix.length)) * SPACING_PX : 0;
  }

  /** How much of its line a link takes: its 44px box less what the slot hands back. */
  function lineTaken(slot: Element | null | undefined, variant: string): number {
    return step(slot, variant, "min-h") - 2 * step(slot, variant, "-my");
  }

  /** The gap between a flex column's rows: `gap-2` → 8. */
  function rowGap(slot: Element | null | undefined): number {
    const found = [...(slot?.classList ?? [])].find((name) => /^gap-\d/.test(name));
    return found ? Number(found.slice("gap-".length)) * SPACING_PX : 0;
  }

  it("floors every link in the shell's footer", () => {
    render(
      <EntryShell title="Reset your password" footer={<a href="/sign-in">Back to sign in</a>}>
        <form />
      </EntryShell>,
    );
    const footer = screen.getByRole("link", { name: "Back to sign in" }).closest("footer");
    for (const utility of floorOf(FOOTER)) expect(footer).toHaveClass(utility);
    expect(step(footer, FOOTER, "min-h")).toBe(44);
  });

  it("keeps a two-row footer's rows 8px apart, 28px from line to line", () => {
    render(
      <EntryShell
        title="Open your shop"
        footer={
          <>
            <p>
              The demo is a sample shop. <a href="/">Try the live demo</a>
            </p>
            <p>
              Already have a shop? <a href="/sign-in">Sign in</a>
            </p>
          </>
        }
      >
        <form />
      </EntryShell>,
    );
    const footer = screen.getByRole("link", { name: "Sign in" }).closest("footer");
    expect(footer).toHaveClass("mt-8", "gap-2");
    expect(lineTaken(footer, FOOTER)).toBe(TEXT_SM_LINE_PX);
    expect(lineTaken(footer, FOOTER) + rowGap(footer)).toBe(28);
  });

  it("keeps a sentence's link on the sentence's 20px line, wrapped or not", () => {
    render(
      <EntryShell
        title="Sign in"
        footer={
          <p>
            Need a shop? <a href="mailto:hello@example.com">Write to hello@example.com</a>
          </p>
        }
      >
        <form />
      </EntryShell>,
    );
    const link = screen.getByRole("link", { name: "Write to hello@example.com" });
    const footer = link.closest("footer");
    // Inside the sentence, not a row of its own: the footer's rule reaches it
    // as a descendant, and it takes its line's 20px, not 44.
    expect(link.parentElement?.tagName).toBe("P");
    for (const utility of floorOf(FOOTER)) expect(footer).toHaveClass(utility);
    expect(lineTaken(footer, FOOTER)).toBe(TEXT_SM_LINE_PX);
  });

  it("floors the one link a terminal door offers, 24px under the body as before", () => {
    render(
      <EntryDone
        glyph="expired"
        title="This link has expired"
        text="Ask for a fresh one."
        action={<a href="/sign-in">Back to sign in</a>}
      />,
    );
    const slot = screen.getByRole("link", { name: "Back to sign in" }).parentElement;
    for (const utility of floorOf(ACTION)) expect(slot).toHaveClass(utility);
    expect(step(slot, ACTION, "min-h")).toBe(44);
    expect(slot).toHaveClass("mt-6");
    expect(lineTaken(slot, ACTION)).toBe(TEXT_SM_LINE_PX);
  });

  /**
   * `ExpiredLinkCard` hands the action a column: a `buttonClass()` link or a
   * form, then "Need help? Contact {shop}." The column is the action, so
   * nothing in it is this slot's to size: the button is 48px already, and the
   * contact sentence keeps its 20px line, 16px under the button.
   */
  it("leaves the links in a column handed to it alone", () => {
    render(
      <EntryDone
        glyph="expired"
        title="This link has expired"
        text="Ask for a fresh one."
        action={
          <div className="flex flex-col items-center gap-4">
            <a href="/s/reef" className="min-h-12">
              See the schedule
            </a>
            <p>
              Need help? <a href="mailto:hi@reef.example">Contact Reef</a>.
            </p>
          </div>
        }
      />,
    );
    const column = screen.getByRole("link", { name: "See the schedule" }).parentElement;
    const slot = column?.parentElement;
    expect(slot).toHaveClass("mt-6");
    expect([...(slot?.classList ?? [])].filter((name) => name.startsWith(FOOTER))).toEqual([]);
    for (const utility of floorOf(ACTION)) expect(slot).toHaveClass(utility);
  });

  /**
   * The footer is back at its `mt-8`, since a link no longer grows its line;
   * the skeleton stands its footnote bar in the same 20px row at the same
   * margin, so nothing shifts when the door streams in (class 11).
   */
  it("keeps the words where they were, in the shell and in its skeleton", () => {
    render(
      <EntryShell title="Reset your password" footer={<a href="/sign-in">Back to sign in</a>}>
        <form />
      </EntryShell>,
    );
    const footer = screen.getByRole("link", { name: "Back to sign in" }).closest("footer");
    expect(footer).toHaveClass("mt-8");
    cleanup();

    const { container } = render(<EntryShellSkeleton fields={["email"]} />);
    const footnote = container.querySelector("main > div")?.lastElementChild;
    expect(footnote).toHaveClass("mt-8", "h-5");
  });
});

/**
 * **The skeleton is the door's own geometry** (docs/design/pixel-craft.md,
 * class 11). It drew 44px button bars 24px under the last field, where every
 * door's form is `flex flex-col gap-4` around a 48px `buttonClass()` — 16 +
 * 48, not 24 + 44 — and a description bar on sign-in, verify and onboarding,
 * which have none, and no row for sign-in's "Forgot password?", a 48px link
 * pulled to 32px of flow by its `-my-2`. Each one moved the form when the
 * page streamed in.
 */
describe("the door's skeleton", () => {
  /** The panel the skeleton draws, found by the constant it shares with the shell. */
  function panelOf(container: HTMLElement) {
    const panel = [...container.querySelectorAll("div")].find(
      (node) => node.className === entryPanelClass,
    );
    if (!panel) throw new Error("no panel");
    return panel;
  }

  it("stands its button 16px under the fields, 48px tall", () => {
    const { container } = render(<EntryShellSkeleton fields={["email"]} />);
    const button = panelOf(container).lastElementChild;
    expect(button).toHaveClass("mt-4", "h-12");
    expect(button).not.toHaveClass("mt-6");
    expect(button).not.toHaveClass("h-11");
  });

  it("stands a single-button door's button 48px tall", () => {
    const { container } = render(<EntryShellSkeleton wordmark panel={false} footnote={false} />);
    const pulse = container.querySelector(".animate-pulse");
    expect(pulse?.lastElementChild).toHaveClass("h-12");
  });

  it("draws a description bar only for a door that has a description", () => {
    const withBar = render(<EntryShellSkeleton fields={["email"]} />);
    expect(panelOf(withBar.container).previousElementSibling).toHaveClass("h-6");
    withBar.unmount();

    const { container } = render(<EntryShellSkeleton description={false} fields={["email"]} />);
    // The title bar is what the panel follows when there is no description.
    expect(panelOf(container).previousElementSibling).toHaveClass("h-9");
  });

  it("keeps sign-in's forgot-password row between the last field and the button", () => {
    const { container } = render(
      <EntryShellSkeleton description={false} trailingLink fields={["email", "password"]} />,
    );
    const rows = [...panelOf(container).children];
    const link = rows.at(-2);
    expect(link).toHaveClass("mt-4", "h-8");
    expect(rows.at(-1)).toHaveClass("mt-4", "h-12");
  });

  it("is what sign-in, verify and onboarding stream in under — none has a description", () => {
    expect(read("app/sign-in/page.tsx")).toMatch(
      /<EntryShellSkeleton description=\{false\} trailingLink fields=/,
    );
    expect(read("app/verify/[token]/loading.tsx")).toContain("description={false}");
    expect(read("app/onboard/loading.tsx")).toContain("description={false}");
  });
});

/**
 * **A door's sentences balance, not just its question** (class 8). EntryDone
 * balanced its heading and left the body to break greedily, so a two-line body
 * ended on "do." or "one." alone on the stranded-diver and expired-link doors,
 * and the verify door's first line ended on "Sign" with "in" below it.
 */
describe("a door's body text balances", () => {
  it("balances a terminal door's body", () => {
    render(<EntryDone glyph="expired" title="Expired" text="Ask the shop for a new one." />);
    expect(screen.getByText("Ask the shop for a new one.")).toHaveClass("text-balance");
  });

  it("balances the shell's description", () => {
    render(
      <EntryShell title="Reset your password" description="Pick a new one for your account.">
        <form />
      </EntryShell>,
    );
    expect(screen.getByText("Pick a new one for your account.")).toHaveClass("text-balance");
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
   * the page would not name.
   *
   * `/recap` is the fourth, and was the last one outside the rule (issue
   * #1119). Its token is *signed* rather than stored, so there is no
   * `booking_capabilities` row and no revocation, and it collapsed every dead
   * cause into the bare door on the strength of that. What the collapse was
   * protecting against is a forged token, and `verifyRecapToken` rejects one
   * before any of these branches is reachable — so a dead recap link that gets
   * this far carries DiveDay's own signature, and is owed the shop's hand like
   * the other three. It keeps the bare door for the one case that resolves
   * nothing at all.
   */
  const BOOKING_TIER = [
    "app/waivers/[token]/page.tsx",
    "app/ready/[token]/page.tsx",
    "app/claim/[token]/page.tsx",
    "app/recap/[token]/page.tsx",
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
