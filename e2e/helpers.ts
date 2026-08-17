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
 * Sign out through the header's identity menu: Sign out lives behind the
 * shop-identity disclosure (logo + name), keeping its two-tap compact-mode
 * InlineConfirm (UX-persona task 81) — the first tap only arms the button
 * and relabels it to the confirm state without submitting, so skipping
 * either step here would leave the session signed in and every caller's
 * next assertion hanging. `[data-identity-menu]` is the trigger's stable
 * hook; its accessible name is the shop's own (variable) name.
 */
export async function signOut(page: Page) {
  await page.locator("[data-identity-menu]").click();
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

/** Navigate to the create-diver form from an add-diver section or panel. */
export async function openHandEntry(container: Locator): Promise<void> {
  const addLink = container.getByRole("link", { name: /Add (diver|to wait list)/i });
  if ((await addLink.count()) > 0) {
    await addLink.click();
    await container.page().waitForURL(/\/divers\/new/);
    return;
  }
  const details = container.locator("details#hand-entry");
  if ((await details.count()) > 0 && (await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
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
    minimumBookings?: number;
    minimumDecisionHours?: number;
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
  if (options.minimumBookings !== undefined) {
    await page.getByLabel("Minimum to run").fill(String(options.minimumBookings));
  }
  if (options.minimumDecisionHours !== undefined) {
    await page.getByLabel("Decide by").fill(String(options.minimumDecisionHours));
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
 * link lives. The button label is matched exactly, and the whole thing is
 * scoped to the Divers section so it can't pick up a crew or wait-list
 * control with a similar name.
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
 */
export async function findTripOnBoard(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
): Promise<Locator> {
  await page.goto(`/shop/${shopSlug}/schedule/board`);
  // The same barrier the `?after=` pages get below, but for the first page:
  // `goto` resolves into the segment's loading.tsx skeleton while the real
  // list streams in, and `count()` doesn't auto-wait — so a slow stream-in
  // read as "no cards and no pager" and the loop concluded the board ended
  // (seen as a one-in-many-runs CI failure hunting a seeded trip). The
  // builder section exists only in the streamed body, whatever the board
  // holds, so its appearance proves the cards and pager are in the DOM. (The
  // old wait target, the "Schedule overview" stat row, left the page with the
  // KPI tiles.)
  await page.getByRole("region", { name: "Schedule builder" }).waitFor();
  for (let hops = 0; hops < 15; hops++) {
    const link = page.locator(`a[href^="/shop/${shopSlug}/trips/"]`).filter({ hasText: title });
    if ((await link.count()) > 0) return link.first();
    const later = page.getByRole("link", { name: "Show later departures" });
    if ((await later.count()) === 0) break;
    // Each hop is a client-side <Link> navigation into the segment's
    // loading.tsx skeleton: the URL moves first, the destination's real
    // content streams in after. `count()` doesn't auto-wait, so without a
    // barrier the next iteration can read the linkless skeleton, see neither
    // cards nor pager, and conclude the board ended. Every page reached via
    // "Show later departures" carries `?after=`, which always renders the
    // "Back to the next departure" escape link alongside the trip cards (and
    // the skeleton contains no links at all) — so its appearance proves the
    // streamed content is in the DOM.
    const nextHref = await later.getAttribute("href");
    await later.click();
    if (nextHref) await page.waitForURL(`**${nextHref}`);
    await page.getByRole("link", { name: "Back to the next departure" }).first().waitFor();
  }
  throw new Error(`trip "${title}" not found on the schedule board after paging`);
}

/**
 * A staff trip's path, read from the schedule card's own href. Clicking and
 * then reading `page.url()` races the streaming list — the card can still be
 * re-rendering, and the URL read lands on the wrong route.
 */
export async function tripPathByTitle(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
): Promise<string> {
  const link = await findTripOnBoard(page, shopSlug, title);
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`no trip card found for ${title}`);
  return href;
}

/** A seeded departure's trip id, found the way staff reach it. */
export async function seededTripId(page: Page, shopSlug: string, title: string): Promise<string> {
  const href = await tripPathByTitle(page, shopSlug, title);
  const tripId = href.match(/\/trips\/([0-9a-f-]+)/i)?.[1];
  if (!tripId) throw new Error(`could not read a trip id from "${href}" for ${title}`);
  return tripId;
}

/**
 * Open a settings-hub row by its heading. The hub states each setting's
 * current value in a `<summary>` row and keeps the form behind it (the
 * trip Overview's summary-first grammar), so a spec that edits a setting
 * opens the row first. A row that is already open — a save redirects back
 * with `?saved=<section>`, which re-renders it open — is left alone.
 */
export async function openSettingsRow(page: Page, heading: string) {
  const details = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { level: 3, name: heading, exact: true }) })
    .first();
  const isOpen = await details.evaluate((node) => node.hasAttribute("open"));
  // `> summary` for the same reason as `openIfClosed` below: a settings row can
  // hold its own nested disclosures, and only a direct summary opens this one.
  if (!isOpen) await details.locator("> summary").click();
}

/**
 * Open a Guests roster card's "Details" disclosure.
 *
 * The roster keeps **work** in the open — blockers, the waiver control, the
 * payment selector, the emergency contact, the private notes — and files what
 * the card can only *tell* you behind one tap: the signed-waiver date, rental
 * fit, the orders link, and "Remove booking". Removing a seat is the one
 * administrative act several specs reach for as a teardown, hence this helper
 * rather than the same three lines in four files.
 *
 * The disclosure is uncontrolled — its `open` is native DOM state React does
 * not touch — so this checks before clicking rather than toggling blindly,
 * exactly like `openPrivateNotes` in add-diver.spec.ts.
 */
export async function openRosterDetails(row: Locator): Promise<void> {
  await openIfClosed(row.locator("details").filter({ hasText: "Remove booking" }).first());
}

/**
 * Open a Guests roster card's private-notes disclosure — a sibling of the
 * "Details" one above, not nested inside it, because writing a note about a
 * diver is desk work a staffer starts from the card rather than reference.
 *
 * The same check-before-click matters more here than anywhere else on the
 * roster: adding a note no longer navigates, so the disclosure a spec opened to
 * write one is *still open* when it comes back to delete it. Clicking blind
 * would close it and take the Delete button with it.
 */
export async function openRosterNotes(row: Locator): Promise<void> {
  await openIfClosed(
    row
      .locator("details")
      .filter({ hasText: /Private staff notes|Add a private note/ })
      .first(),
  );
}

/**
 * Native `open` is DOM state React never touches, so check before toggling.
 *
 * `> summary`, not `summary`: these panels contain other disclosures (the
 * emergency-contact edit form is one), and a descendant `<summary>` would make
 * this ambiguous under strict mode — or, worse, click the wrong one and leave
 * the panel shut. A `<details>` is opened only by its own direct summary.
 */
async function openIfClosed(details: Locator): Promise<void> {
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("> summary").click();
}
