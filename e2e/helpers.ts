import { expect, type Locator, type Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { E2E_FROZEN_CLOCK } from "./servers";

/** Sign in through the dev credential form as the seeded owner. */
export async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/**
 * Sign out through ShopNav's two-tap compact-mode InlineConfirm (UX-persona
 * task 81): the first tap only arms the button and relabels it to the
 * confirm state without submitting, so a single click here would leave the
 * session signed in and every caller's next assertion hanging.
 */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign out? Confirm" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Check the minimum-age attestation box, present and `required` on a course
 * session's booking form whenever the course has a `minimumAge` (task 23) —
 * absent for a plain fun-dive trip. A no-op when the box isn't there, so
 * every course-session booking site can call this unconditionally right
 * before its submit click.
 */
export async function acceptAgeAttestation(page: Page) {
  const checkbox = page.getByRole("checkbox", { name: /confirm every diver on this booking/ });
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check();
  }
}

/**
 * "Now" as the server sees it. The e2e fleet freezes its clock at
 * E2E_FROZEN_CLOCK (playwright.config.ts → src/lib/clock.ts), so any date a
 * test computes for a form input, or any year it asserts against a
 * server-rendered calendar, must be relative to *that* instant — not the real
 * wall clock. Anchoring here is what keeps date-driven specs (and the visual
 * regression baselines) passing identically in 2026 and in 2030.
 */
export function e2eNow(): Date {
  return new Date(E2E_FROZEN_CLOCK);
}

/**
 * The diver's booking page for a trip a spec reached as staff. The two
 * namespaces mirror each other on the id — `/shop/<slug>/trips/<id>` is the
 * staff trip record, `/s/<slug>/trips/<id>` is the page divers buy from (ADR
 * 20260803-public-shop-namespace).
 */
export function publicTripUrl(staffTripUrl: string): string {
  return staffTripUrl.replace("/shop/", "/s/");
}

/** An ISO date (YYYY-MM-DD) `days` from the frozen clock, for date inputs. */
export function daysFromNow(days: number): string {
  return new Date(e2eNow().getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Sign in through the dev credential form as any seeded staff login. */
export async function signInAs(page: Page, login: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(login.email);
  await page.getByLabel("Password").fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/**
 * Open a departure from the staff schedule board.
 *
 * The board is the schedule builder (src/app/shop/[shopSlug]/schedule/board/_components),
 * where a row carries its own Move/Copy/Remove controls and only the title is a
 * link — so clicking the row itself lands on padding and navigates nowhere.
 * Every spec that starts "from the board, open trip X" goes through here rather
 * than re-deriving that.
 */
export async function openTripFromBoard(page: Page, title: string) {
  await page
    .getByRole("listitem")
    .filter({ hasText: title })
    .first()
    // Exact match: an unpriced trip's card also carries a "Set a price for
    // {title}, {date} {time}" link (task 150) whose accessible name contains
    // the trip title as a substring — a non-exact name match would resolve
    // to both links and hit Playwright's strict-mode violation.
    .getByRole("link", { name: title, exact: true })
    .click();
  await expect(page).toHaveURL(/\/trips\//);
}

/**
 * The schedule board pages a fixed number of departures at a time and has no
 * text search — a trip scheduled far enough out (or created earlier in the
 * same test) can land past the first page. Pages through "Show later
 * departures" until a trip card matching `title` appears, then returns its
 * link locator — call `.click()`, or `.getAttribute("href")` to read the
 * path without racing the click's own navigation.
 *
 * Retries the whole crawl a couple of times: several specs create a trip on
 * the exact same frozen-clock date (e.g. every "N days from now" age-gate
 * fixture), and a sibling test's parallel worker inserting one mid-crawl can
 * shift the keyset pagination boundary out from under a single pass. A fresh
 * crawl after the DB has settled clears that; a genuinely missing trip still
 * fails once every attempt turns up nothing.
 */
export async function findTripOnBoard(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
): Promise<Locator> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`/shop/${shopSlug}/schedule/board`);
    for (let hops = 0; hops < 15; hops++) {
      const link = page
        .locator(`a[href^="/shop/${shopSlug}/trips/"]:not([href$="/trips/new"])`)
        .filter({ hasText: title });
      if ((await link.count()) > 0) return link.first();
      const later = page.getByRole("link", { name: "Show later departures" });
      if ((await later.count()) === 0) break;
      // A plain client-side <Link> navigation — wait for the URL to actually
      // move to the href it points at before re-checking, or the next hop's
      // count() races the still-in-flight page transition.
      const nextHref = await later.getAttribute("href");
      await later.click();
      if (nextHref) await page.waitForURL(`**${nextHref}`);
    }
  }
  throw new Error(`trip "${title}" not found on the schedule board after paging`);
}
