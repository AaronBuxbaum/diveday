import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

/**
 * One booking, seated end to end with nothing but Tab, Shift+Tab, Enter and
 * typing — no `click()` anywhere in this file.
 *
 * ## Why this exists next to the axe scans
 *
 * `e2e/a11y.spec.ts` proves every control on ~40 surfaces has a name, a role
 * and a reachable label. None of that is the same as the page being
 * *traversable*. A page can pass every rule axe has and still be unusable
 * without a mouse, because the three things that decide that are all invisible
 * to a static tree walk:
 *
 * - **Tab order.** axe reads the accessibility tree, not the sequence the
 *   browser will actually walk. A control that a positive `tabindex` yanks to
 *   the front, or a panel that mounts *before* its trigger in the DOM, scans
 *   perfectly and reads out of order.
 * - **Focus visibility.** axe cannot tell you where the focus ring is, only
 *   what the element is called. Losing the ring (a `outline: none` in a
 *   component's own class string, a control that isn't one of the tags
 *   `globals.css`'s `:focus-visible` rule matches) is invisible to it.
 * - **Focus containment and return.** A modal that doesn't take focus, doesn't
 *   hold it, or drops it on the floor when it closes is a dead end for a
 *   keyboard user. Every element in it is perfectly labelled the whole time.
 *
 * And one more that is about *hearing* rather than moving: whether the outcome
 * of the booking is **announced**. A sighted mouse user sees the confirmation
 * banner; a screen-reader user only learns the seat was sold if that text
 * lands in a live region as a change. This spec records live-region mutations
 * with a `MutationObserver` installed *before* the submit, so "the banner is in
 * the DOM afterwards" cannot pass for "the banner was announced" — a server
 * render that merely includes the sentence produces no mutation and fails here.
 *
 * ## The route it walks
 *
 * The global Add-a-booking door, because it is the only booking path that
 * crosses a dialog: `⌘K` palette (a portal `role="dialog"` with a hand-rolled
 * focus trap, src/components/useFocusTrap.ts) → the departure picker → the
 * diver form → the roster it lands on. Four surfaces, three of them keyboard
 * traps waiting to happen.
 */

signedInAsOwner();

/** What a keyboard user can actually tell about the element that has focus. */
type FocusStop = {
  /**
   * `a "Two-Tank Reef…" → /shop/blue-mantis/bookings/new/<id>` — the element,
   * its accessible-ish name, and where it goes. Enough to read a whole tab
   * order out of one failure message, and enough to match a stop on. Form
   * controls take their name from their `<label>`, because an `<input>` has no
   * text of its own and would otherwise be indistinguishable from every other
   * input on the page.
   */
  readonly label: string;
  /** Matches `:focus-visible` — the browser itself considers this keyboard focus. */
  readonly keyboardFocused: boolean;
  /** A ring is actually drawn (globals.css gives native controls a 3px outline). */
  readonly hasFocusRing: boolean;
  /** Rendered, non-zero-sized, and not buried in an `aria-hidden` subtree. */
  readonly perceivable: boolean;
  /** Later in the document than the previous stop — nothing leapfrogged the order. */
  readonly followsPrevious: boolean;
  /** Inside the open dialog, when one is open. */
  readonly insideDialog: boolean;
};

/**
 * Start a walk at the top of the document.
 *
 * Two things need resetting between legs, and neither happens on its own,
 * because a client-side navigation keeps the same `window`:
 *
 * - the previous stop, or the next `followsPrevious` compares against an
 *   element on a page we already left;
 * - focus itself. Following a `<Link>` with Enter leaves focus on the anchor,
 *   and `cacheComponents` keeps the route it belonged to mounted-but-hidden
 *   (ADR 20260801-cache-components-e2e-activity-migration) — so focus sits on
 *   a `display:none` element, and Chromium answers the next Tab by dropping to
 *   the body instead of advancing. Blurring first puts the walk where a fresh
 *   document load would put it.
 */
async function beginWalk(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    (window as unknown as { __kbPrev?: HTMLElement | null }).__kbPrev = null;
  });
}

/**
 * Press Tab (or Shift+Tab) once and describe wherever focus landed.
 *
 * A landing on `<body>` is retried once rather than failed on. Chromium keeps a
 * "sequential focus navigation starting point" that `blur()` does not reset, so
 * the first Tab after following a `<Link>` — whose anchor the client router
 * left mounted-but-hidden — spends itself resetting to the document start
 * instead of advancing. The second press moves. Two in a row is a genuine dead
 * end and still throws.
 */
async function tab(page: Page, direction: "forward" | "back" = "forward"): Promise<FocusStop> {
  const key = direction === "forward" ? "Tab" : "Shift+Tab";
  await page.keyboard.press(key);
  let stop = await snapshotFocus(page);
  if (!stop) {
    await page.keyboard.press(key);
    stop = await snapshotFocus(page);
  }
  if (!stop) throw new Error("Tab moved focus to the document body — the tab order ran out");
  return stop;
}

async function snapshotFocus(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    const held = window as unknown as { __kbPrev?: HTMLElement | null };
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const prev = held.__kbPrev && el.ownerDocument.contains(held.__kbPrev) ? held.__kbPrev : null;
    const followsPrevious =
      prev === null ||
      prev === el ||
      Boolean(prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    held.__kbPrev = el;
    // `closest`, not a document-wide `querySelector`: the question is whether
    // *this* element sits inside a modal, and the staff chrome can have more
    // than one dialog in the tree at a time.
    const insideDialog = el.closest('[role="dialog"], [role="alertdialog"]') !== null;
    const role = el.getAttribute("role");
    const labelled =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? (el.labels?.[0]?.textContent ?? el.getAttribute("placeholder") ?? "")
        : "";
    const name = (el.getAttribute("aria-label") ?? (labelled || el.textContent) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const target = el instanceof HTMLAnchorElement && el.href ? new URL(el.href).pathname : null;
    return {
      label: `${el.tagName.toLowerCase()}${role ? `[${role}]` : ""} "${name.slice(0, 60)}"${
        target ? ` → ${target}` : ""
      }`,
      keyboardFocused: el.matches(":focus-visible"),
      hasFocusRing:
        style.outlineStyle !== "none" && (Number.parseFloat(style.outlineWidth) || 0) > 0,
      perceivable:
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        el.closest('[aria-hidden="true"]') === null,
      followsPrevious,
      insideDialog,
    };
  });
}

/**
 * The three things that must hold at *every* stop, checked as one so a failure
 * names the control rather than an index. Kept separate from the walk itself so
 * a leg can assert them over the whole path it took, not just its destination.
 */
function expectUsableStop(stop: FocusStop, where: string): void {
  expect(stop.perceivable, `${where}: focus landed on something invisible — ${stop.label}`).toBe(
    true,
  );
  expect(stop.keyboardFocused, `${where}: not :focus-visible — ${stop.label}`).toBe(true);
  expect(stop.hasFocusRing, `${where}: no focus ring drawn — ${stop.label}`).toBe(true);
  expect(stop.followsPrevious, `${where}: tab order jumped backwards to ${stop.label}`).toBe(true);
}

/**
 * Tab forward until a stop's label matches, checking every stop on the way.
 * Returns the path, so a caller can assert *how far* something was — a control
 * you reach on the 3rd Tab and one you reach on the 60th are not the same
 * design, and only one of them is reachable in practice.
 */
async function tabUntil(
  page: Page,
  match: RegExp,
  { limit, where }: { limit: number; where: string },
): Promise<FocusStop[]> {
  const path: FocusStop[] = [];
  const trail = () => path.map((stop, i) => `  ${i + 1}. ${stop.label}`).join("\n");
  for (let i = 0; i < limit; i++) {
    let stop: FocusStop;
    try {
      stop = await tab(page);
    } catch (error) {
      // Running off the end of the tab order is itself a finding about the
      // page, so the whole path it walked has to survive into the message.
      throw new Error(`${where}: ${(error as Error).message}. Path was:\n${trail()}`);
    }
    expectUsableStop(stop, `${where} (stop ${i + 1})`);
    path.push(stop);
    if (match.test(stop.label)) return path;
  }
  throw new Error(`${where}: never reached ${match} in ${limit} tabs. Path was:\n${trail()}`);
}

/**
 * Start recording every piece of text that lands inside a live region
 * (`aria-live`, `role="status"`, `role="alert"`) from this moment on.
 *
 * The point is the *from this moment on*. A screen reader announces a live
 * region because its contents changed while it was listening; text that was
 * already in the document when the user arrived is just text. Reading the
 * banner's `textContent` after the fact cannot tell those two apart, and this
 * can.
 */
async function recordAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __announced?: string[]; __announcer?: MutationObserver };
    store.__announcer?.disconnect();
    store.__announced = [];
    const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]';
    /**
     * Every live region this mutation put text into — looking *up* and *down*.
     * Up covers a text node changing inside a region that was already there
     * (the palette's sr-only counter). Down covers a whole subtree being
     * grafted in with the region inside it, which is what a client-side route
     * change does: React swaps a wrapper `<div>` whose descendant is the
     * `role="status"` banner, so an ancestors-only walk sees the insert and
     * concludes, wrongly, that nothing was announced.
     */
    const regionsTouchedBy = (node: Node): HTMLElement[] => {
      const el = node instanceof HTMLElement ? node : node.parentElement;
      if (!el) return [];
      const found: HTMLElement[] = [];
      const ancestor = el.closest<HTMLElement>(LIVE);
      if (ancestor) found.push(ancestor);
      for (const inner of el.querySelectorAll<HTMLElement>(LIVE)) found.push(inner);
      return found;
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const touched: Node[] =
          record.type === "characterData" ? [record.target] : [...record.addedNodes];
        for (const node of touched) {
          for (const region of regionsTouchedBy(node)) {
            const text = (region.textContent ?? "").replace(/\s+/g, " ").trim();
            if (text) store.__announced?.push(text);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    store.__announcer = observer;
  });
}

/** Everything a live region has received since `recordAnnouncements`. */
async function announcements(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __announced?: string[] }).__announced ?? []);
}

test("a booking can be seated with the keyboard alone, and says so out loud", async ({ page }) => {
  // Four surfaces, ~60 individual Tab presses each round-tripping an
  // `evaluate`, plus a debounced palette search and a server action. Every
  // step is fast; there are simply a lot of them.
  test.setTimeout(120_000);

  const diver = `Keyboard Kelly ${e2eNow().getTime()}`;

  // ── Leg 1. Reach the global search from a cold page, and prove the dialog
  // it opens is a place a keyboard user can get out of again.
  await page.goto("/shop/blue-mantis");
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await beginWalk(page);

  // The very first tab stop is the skip link. This is the single most load-
  // bearing fact about a staff page's tab order: without it, every one of the
  // ~15 header stops below stands between a keyboard user and the actual page,
  // on every navigation.
  const first = await tab(page);
  expectUsableStop(first, "shop home");
  expect(first.label, "the first tab stop should be the skip link").toMatch(
    /Skip to main content/i,
  );

  const toSearch = await tabUntil(page, /"Search"/, { limit: 20, where: "shop home" });
  // Reachable at all is the floor; reachable *early* is the design. Search is
  // how the palette (and therefore every destination) is opened without a
  // mouse, so burying it behind a long nav would be a real regression even
  // though every link in that nav is perfectly labelled.
  expect(
    toSearch.length,
    `Search took ${toSearch.length} tabs from the top of the page`,
  ).toBeLessThanOrEqual(12);

  await page.keyboard.press("Enter");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();

  // Focus *entered* the dialog. A modal that opens behind you is worse than no
  // modal: the backdrop swallows the page you can still tab through.
  const entered = await page.evaluate(() => {
    const el = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    return {
      inside: Boolean(el && dialog?.contains(el)),
      role: el instanceof HTMLElement ? el.getAttribute("role") : null,
    };
  });
  expect(entered.inside, "opening the palette did not move focus into it").toBe(true);
  expect(entered.role, "focus should land on the palette's own combobox").toBe("combobox");

  // …and stays inside, in both directions. Six presses is more than the trap
  // has focusable children, so an escape would have happened by now.
  for (let i = 0; i < 6; i++) {
    const stop = await tab(page);
    expect(stop.insideDialog, `Tab ${i + 1} escaped the palette to ${stop.label}`).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    const stop = await tab(page, "back");
    expect(stop.insideDialog, `Shift+Tab ${i + 1} escaped the palette to ${stop.label}`).toBe(true);
  }

  // Closing hands focus back to the control that opened it. Without this the
  // keyboard user is returned to the top of the document and has to walk the
  // whole header again — the most common way a correct focus trap is still a
  // dead end.
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  const restored = await page.evaluate(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement.getAttribute("aria-label")
      : null,
  );
  expect(restored, "Escape did not return focus to the trigger").toBe("Search");

  // ── Leg 2. Drive the palette to the booking door, and check it narrates
  // itself while doing it.
  await recordAnnouncements(page);
  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();
  await page.keyboard.type("Add a booking");
  await expect(palette.getByRole("option", { name: "Add a booking" })).toBeVisible();

  // The palette's `aria-live="polite"` counter (CommandPalette.tsx) is the only
  // way a screen-reader user learns that typing changed the list underneath
  // them — the rows themselves are never read out.
  expect(
    (await announcements(page)).join(" | "),
    "typing in the palette announced nothing into its live region",
  ).toMatch(/\(\d+\)/);

  await page.keyboard.press("Enter");
  await page.waitForURL(/\/bookings\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Add a booking" })).toBeVisible();

  // ── Leg 3. Choose the departure. Every stop between the top of the page and
  // the first departure is checked, which is the part of "keyboard accessible"
  // no route-level scan covers.
  await beginWalk(page);
  await tabUntil(page, /→ \/shop\/blue-mantis\/bookings\/new\/./, {
    limit: 40,
    where: "departure picker",
  });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/bookings\/new\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Add a booking" })).toBeVisible();

  // ── Leg 4. Navigate to Add diver, type the diver in and seat them.
  await beginWalk(page);
  await tabUntil(page, /"Add diver"/, { limit: 25, where: "diver search" });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/divers\/new\?/);
  await expect(page.getByRole("heading", { level: 1, name: "Add a diver" })).toBeVisible();

  await beginWalk(page);
  await recordAnnouncements(page);
  await tabUntil(page, /"Full name"/, { limit: 25, where: "diver form" });
  await expect(page.getByLabel("Full name")).toBeFocused();
  await page.keyboard.type(diver);

  // The three fields and the submit are contiguous and in reading order. This
  // is asserted exactly rather than by another search loop, because a form
  // whose submit button is not the next stop after its last field is a form
  // people fail to submit.
  const email = await tab(page);
  expectUsableStop(email, "diver form");
  expect(email.label).toMatch(/Email/);
  await page.keyboard.type(`kelly-${e2eNow().getTime()}@example.com`);

  const phone = await tab(page);
  expectUsableStop(phone, "diver form");
  expect(phone.label).toMatch(/Phone/);

  const submit = await tab(page);
  expectUsableStop(submit, "diver form");
  expect(submit.label).toMatch(/Add to trip/);

  await page.keyboard.press("Enter");

  // Seated: the shared seat-a-diver action lands on the trip's roster.
  await page.waitForURL(/\/trips\/[^/]+\/guests/);
  await expect(page.getByRole("link", { name: diver })).toBeVisible();

  // And the outcome was *announced*, not merely rendered. The e2e fleet
  // configures no email provider, so seating always resolves to the
  // waiver-undelivered wording (`SEAT_SURFACES["new-booking"]` →
  // `trips.notices.diverAddedWaiverUndelivered`); what matters here is that the
  // sentence arrived as a mutation inside a live region while the observer
  // installed back in leg 4 was watching.
  await expect
    .poll(async () => (await announcements(page)).join(" | "), {
      message: "seating the diver never reached a live region",
      timeout: 10_000,
    })
    .toMatch(/Diver added to the trip/);
});
