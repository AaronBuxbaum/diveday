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
 * Move between a trip record's surfaces (`TripSubNav` — Overview, Guests,
 * Manifest, Prep). The nav is labelled "Trip" and its links are plain
 * `<Link>`s, so the click resolves client-side: waiting on the tab's own path
 * segment here is what keeps a caller's first assertion from racing the
 * in-flight transition. The active tab renders as an inert `<span>`, so
 * calling this for the tab you are already on would hang — navigate, don't
 * re-select.
 */
export async function openTripTab(page: Page, tab: "Guests" | "Manifest" | "Prep") {
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: tab }).click();
  await page.waitForURL(new RegExp(`/${tab.toLowerCase()}(\\?|$)`));
}

/**
 * Put a departure on the board through the real staff form — the schedule
 * board's own add panel, opened at full depth (`?add=full`), which is the only
 * trip-creation form there is (ADR 20260806-one-trip-create-form). ~30 specs
 * need a departure of their own rather than sharing a seeded charter another
 * worker may be mutating.
 *
 * Only the four fields the form actually requires are positional-ish; the
 * rest are opt-in because the panel defaults them (seats, price, and the
 * free-cancellation window are all optional on it too). `course` is applied
 * *first* on purpose: picking a course re-renders the form around the
 * selection, so a title filled before it would be thrown away.
 *
 * Settling on the notice rather than the URL is deliberate — the notice names
 * the departure that just landed, which is the stable signal that the write
 * went through wherever the action decided to land (the board normally, the
 * shop home for a shop's very first departure ever).
 */
export async function createTrip(
  page: Page,
  options: {
    title: string;
    date: string;
    departsAt: string;
    returnsAt: string;
    shopSlug?: string;
    course?: string;
    capacity?: number;
    price?: number;
    cancellationWindowHours?: number;
  },
): Promise<void> {
  // Always the full depth (`?add=full`), even for a caller that only fills the
  // four required fields: this helper stands in for "a shop scheduled a trip"
  // across ~30 specs, and the disclosed form is the superset — a spec that later
  // wants a deposit or a cancellation window must not have to know which depth
  // the helper happened to open.
  await page.goto(`/shop/${options.shopSlug ?? "blue-mantis"}/schedule/board?add=full`);
  if (options.course !== undefined) {
    // By name, not label: board rows carry aria-labels naming their departure,
    // which a label match would sweep up alongside the panel's own select.
    await page.locator('select[name="courseId"]').selectOption({ label: options.course });
  }
  await page.getByLabel("What is it").fill(options.title);
  await page.getByLabel("Date").fill(options.date);
  await page.getByLabel("Departs").fill(options.departsAt);
  await page.getByLabel("Returns").fill(options.returnsAt);
  if (options.capacity !== undefined) {
    await page.getByLabel("Seats").fill(String(options.capacity));
  }
  if (options.price !== undefined) {
    await page.getByLabel(/Price per diver/).fill(String(options.price));
  }
  if (options.cancellationWindowHours !== undefined) {
    await page.getByLabel("Free cancellation window").fill(String(options.cancellationWindowHours));
  }
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(options.title);
}

/**
 * Send the waiver to the first diver on the open trip's Guests roster and
 * return the bearer link it hands back — a relative `/waivers/<token>` path.
 *
 * The e2e fleet configures no email provider, so the shared
 * `WaiverSendControl` always falls to its private-link affordance instead of
 * "Waiver sent to …", and that inline `role="status"` result is where the
 * link lives. The button label is matched exactly so it targets the per-diver
 * control rather than the roster's "Send waivers to selected" bulk button,
 * and the whole thing is scoped to the Divers section so it can't pick up a
 * crew or wait-list control with a similar name.
 *
 * Caller must already be on the trip's Guests tab (`openTripTab(page,
 * "Guests")`); this deliberately does not navigate, because several specs
 * need the staff URL they were on to return to afterwards.
 */
export async function sendWaiverForFirstDiver(page: Page): Promise<string> {
  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) })
    .filter({ visible: true });
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  const href = await diverSection.getByRole("status").getByRole("link").getAttribute("href");
  if (!href?.startsWith("/waivers/")) {
    throw new Error(`expected a /waivers/ bearer link from the send control, got ${href}`);
  }
  return href;
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
