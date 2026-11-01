import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, type Locator, type Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { E2E_FROZEN_CLOCK, E2E_STRIPE_TEST_WEBHOOK_SECRET } from "./servers";

// Better Auth sign-out revokes a database session. The staff storage-state
// fixture caches one session per worker/role for speed, so a test that signs
// out must invalidate that cache before the next test tries to reuse it. This
// generation is process-local, matching Playwright's worker-local fixture
// lifetime; a changed value tells the fixture to sign in again.
let staffStorageStateGeneration = 0;

export function currentStaffStorageStateGeneration(): number {
  return staffStorageStateGeneration;
}

function invalidateStaffStorageState(): void {
  staffStorageStateGeneration += 1;
}

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
  const identityMenu = page.locator("[data-identity-menu]");
  await expect(identityMenu).toHaveAttribute("data-hydrated", "true");
  await identityMenu.click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign out? Confirm", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  invalidateStaffStorageState();
}

/** Check a course booking's required minimum-age attestation when present. */
export async function acceptAgeAttestation(page: Page) {
  const checkbox = page.getByRole("checkbox", { name: /confirm every diver on this booking/ });
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check();
  }
}

/**
 * Set party size after hydration; remaining capacity renders radios through six
 * seats and a select above six.
 */
export async function choosePartySize(page: Page, count: number) {
  const control = page.getByLabel("People", { exact: true });
  await expect(control).toHaveAttribute("data-hydrated", "true");
  if ((await control.evaluate((node: Element) => node.tagName)) === "SELECT") {
    await control.selectOption(String(count));
    return;
  }
  const label = count === 1 ? "1 person" : `${count} people`;
  // Radio inputs are visually hidden: click the wrapping label by input value,
  // then assert the radio's accessible name. Visible label copy may change.
  await control.locator(`label:has(input[value="${count}"])`).click();
  await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
}

/** Save the diver's Day-of dive intent and wait for the action's status. */
export async function saveDiveIntent(page: Page, label: string) {
  const step = await openThreadStep(page, "dayof");
  await step.getByLabel("What’s this dive for?").selectOption({ label });
  await step.getByRole("button", { name: "Save day-of details" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved. The crew will see your answers" }),
  ).toBeVisible();
}

/** Submit one booking on the open public trip and wait for its `/ready/<token>` thread. */
export async function bookASeatAndOpenThread(page: Page, name: string, email?: string) {
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    // Pass an email when a caller needs to look up this diver; otherwise derive one.
    .fill(
      email ?? `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${e2eNow().getTime()}@example.com`,
    );
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
}

/** Stable, unique anchor for the diver's trip-prep thread status. */
export function threadStatus(page: Page): Locator {
  return page.locator('[data-testid="thread-status"]');
}

/**
 * Open and return the visible direct details for one trip-prep step. Steps use
 * a named native accordion; the visible direct-child selector excludes nested
 * card disclosures and a preserved hidden Activity copy.
 */
export async function openThreadStep(page: Page, step: string): Promise<Locator> {
  // Direct children avoid matching nested per-card disclosures.
  const details = page.locator(`[data-thread-step="${step}"] > details`).filter({ visible: true });
  await details.waitFor();
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return details;
  await details.locator(":scope > summary").click();
  // The open attribute confirms the disclosure transition; its body can lay out later.
  await expect(details).toHaveAttribute("open", "");
  return details;
}

/** Open one visible recap door; these independent disclosures may stay open together. */
export async function openRecapDoor(page: Page, door: string): Promise<Locator> {
  const details = page.locator(`[data-recap-door="${door}"] details`).filter({ visible: true });
  await details.waitFor();
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return details;
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  return details;
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
 * **Pay a Stripe invoice the way Stripe does** (issue #2306): a test-mode
 * `invoice.paid`, signed with the fleet's test webhook secret, posted to the
 * real `/api/webhooks/stripe`. No door marks an invoice paid but the webhook,
 * so the spec goes through it rather than around it. Signed at the frozen
 * clock, the instant the server checks the signature's age against.
 */
export async function payInvoiceThroughWebhook(
  request: APIRequestContext,
  invoice: { invoiceId: string; stripeAccountId: string; amountCents: number },
): Promise<void> {
  await postSignedStripeEvent(request, {
    id: `evt_e2e_${invoice.invoiceId}`,
    type: "invoice.paid",
    account: invoice.stripeAccountId,
    data: { object: { id: invoice.invoiceId, amount_paid: invoice.amountCents } },
  });
}

/**
 * **Settle a card payment at booking the way Stripe does** (ADR
 * 20260721-checkout-at-booking): a test-mode `checkout.session.completed`
 * carrying `payment_status: "paid"`, the one event that clears a booking's
 * payment gate, signed and posted like `payInvoiceThroughWebhook`.
 */
export async function payCheckoutThroughWebhook(
  request: APIRequestContext,
  checkout: { sessionId: string; stripeAccountId: string; amountCents: number },
): Promise<void> {
  await postSignedStripeEvent(request, {
    id: `evt_e2e_${checkout.sessionId}`,
    type: "checkout.session.completed",
    account: checkout.stripeAccountId,
    data: {
      object: {
        id: checkout.sessionId,
        object: "checkout.session",
        payment_status: "paid",
        status: "complete",
        amount_total: checkout.amountCents,
      },
    },
  });
}

async function postSignedStripeEvent(
  request: APIRequestContext,
  event: { id: string; type: string; account: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const created = Math.floor(e2eNow().getTime() / 1000);
  const payload = JSON.stringify({ ...event, created, livemode: false });
  const signature = createHmac("sha256", E2E_STRIPE_TEST_WEBHOOK_SECRET)
    .update(`${created}.${payload}`)
    .digest("hex");
  const response = await request.post("/api/webhooks/stripe", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${created},v1=${signature}`,
    },
  });
  expect(response.status()).toBe(200);
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
 * Open a departure from the staff schedule board, which the page must already
 * be on.
 *
 * Two things a caller would otherwise re-derive, and twenty specs did:
 *
 * - **Only the title is a link.** A row carries its own Move/Copy/Remove
 *   controls, so clicking the row itself lands on padding and navigates
 *   nowhere.
 * - **The board is one week.** A departure further out than the week a spec
 *   landed on is reached by paging, which `walkBoardWeeksFor` does.
 */
export async function openTripFromBoard(page: Page, title: string) {
  await (await walkBoardWeeksFor(page, title)).click();
  await expect(page).toHaveURL(/\/trips\//);
}

/**
 * Move between a departure's surfaces: Trip is the Divers tab, Manifest the
 * Boat tab, Prep the Gear tab (ADR 20261001-logbook, decision 3).
 *
 * This navigates by URL rather than by clicking a tab: a helper every spec
 * leans on should put the caller on a surface, and `boat-loop.spec.ts` is
 * where the tabs themselves are the subject.
 */
export async function openTripTab(page: Page, tab: "Trip" | "Manifest" | "Prep") {
  // **Wait for the departure before reading the address bar.** A click that
  // opens one resolves when its request leaves, not when the URL commits, so
  // `page.url()` here can still be the board the caller clicked from — which is
  // `check:e2e-hygiene`'s `action-race` wearing a helper. The tab strip bought
  // this for free: its link could not be clicked before the page holding it had
  // rendered. Navigating by URL has to ask for it.
  await page.waitForURL(TRIP_SURFACE_URL).catch(() => {
    throw new Error(`openTripTab called from ${page.url()}, which is not a departure`);
  });
  const url = new URL(page.url());
  const root = url.pathname.match(/^(.*\/trips\/[^/?#]+)/)?.[1];
  if (!root) throw new Error(`openTripTab called from ${url.pathname}, which is not a departure`);
  const target = tab === "Trip" ? root : `${root}/${tab.toLowerCase()}`;
  // Divers and Details share a path: Details is `?view=details`, and an About
  // form's save lands on Details with a `form=` that `FlashParams` strips, so the
  // address bar alone cannot say the roster is open. The tab strip can.
  const onTarget =
    url.pathname === target &&
    (tab !== "Trip" ||
      (await page.locator('nav[data-trip-tabs] a[aria-current="page"]').getAttribute("href")) ===
        root);
  if (onTarget) return;
  await page.goto(target);
  await page.waitForURL(
    tab === "Trip" ? TRIP_ROOT_URL : new RegExp(`/${tab.toLowerCase()}(\\?|#|$)`),
  );
}

/**
 * **A diver's row in a departure's roster ledger**, scoped to the ledger rather
 * than to the page.
 *
 * `page.locator("li").filter({ hasText: name })` was unambiguous while the
 * departure page held only the roster. Slice 23c folded the packing list in
 * under it (ADR 20260919-one-idea), and a diver with no fit on file is now
 * named in "Sizes still missing" as well as in their own seat — two `<li>`s
 * holding one name, which is a strict-mode violation rather than a flake, and
 * which took three specs red on CI at once.
 *
 * The ledger's own region is the honest scope: `RosterSection` labels it with
 * `trips.roster.heading` on any page that owns its masthead, which the
 * departure does. English, like every other locator in this suite.
 */
export function rosterRow(page: Page, diverName: string): Locator {
  return page
    .getByRole("region", { name: "Divers", exact: true })
    .locator("li")
    .filter({ hasText: diverName });
}

const TRIP_ROOT_URL = /\/trips\/[^/?#]+(?:[?#]|$)/;
/** Any of a departure's surfaces — the root itself, or one of its sub-pages. */
const TRIP_SURFACE_URL = /\/trips\/[^/?#]+/;

/**
 * Open the departure's Details tab before using its rows. Details is its own
 * tab (ADR 20261001-logbook), so a caller standing on Divers is moved across by
 * URL first; the rows are laid flat there, never folded (owner, 2026-10-05).
 */
export async function openTripAbout(page: Page): Promise<Locator> {
  const about = page.locator("section#about");
  // A caller often clicks its way here, and the click resolves before the URL
  // commits: wait for the departure's own tabs before reading the address.
  await page.waitForURL(TRIP_ROOT_URL);
  await expect(page.getByRole("navigation", { name: "Departure" })).toBeVisible();
  const url = new URL(page.url());
  if (url.searchParams.get("view") !== "details" && (await about.count()) === 0) {
    url.searchParams.set("view", "details");
    url.hash = "";
    await page.goto(url.toString());
  }
  await expect(about).toBeVisible();
  return about;
}

/**
 * Open the Details tab's "More for this departure" row — where the rare and
 * destructive acts live (the weather blow-out, cancelling the departure, the
 * series-wide writes), beside Promote and Activity. Opens the tab first.
 */
export async function openTripMore(page: Page): Promise<Locator> {
  await openTripAbout(page);
  const list = page.getByRole("group", { name: "More for this departure" });
  if ((await list.getAttribute("open")) === null) {
    await list.locator(":scope > summary").click();
  }
  await expect(list).toHaveAttribute("open", "");
  return list;
}

/**
 * Open one About row's editor — the departure's crew, its price, the days it
 * runs — found by the row's label, which its `<details>` carries as its name.
 * A row opens itself only while its subject has open work, so a settled one
 * (a boat with crew on it) takes a tap. Opens the panel itself first.
 */
export async function openTripAboutRow(page: Page, label: string): Promise<Locator> {
  await openTripAbout(page);
  const row = page.getByRole("group", { name: label, exact: true });
  await expect(row).toBeVisible();
  await openIfClosed(row);
  return row;
}

/**
 * Create a trip through the full-depth (`?add=full`) board form. Title, date and times are
 * required; other settings are optional. Course selection re-renders the form,
 * and boat selection sets capacity, so select each before filling affected
 * fields. Wait for the title in the success notice because a first trip may
 * redirect to the shop home.
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
    /** A boat from the shop's fleet, by name (the option reads "<name> (<seats> seats)"). */
    boat?: string;
  },
): Promise<void> {
  await page.goto(`/shop/${options.shopSlug ?? "blue-mantis"}/schedule/board/new?add=full`);
  if (options.course !== undefined) {
    // By name, not label: board rows carry aria-labels naming their departure,
    // which a label match would sweep up alongside the panel's own select.
    await page.locator('select[name="courseId"]').selectOption({ label: options.course });
  }
  await page.getByLabel("What is it").fill(options.title);
  await page.getByLabel("Date").fill(options.date);
  await page.getByLabel("Departs").fill(options.departsAt);
  await page.getByLabel("Returns").fill(options.returnsAt);
  if (options.boat !== undefined) {
    // Selecting a boat initializes capacity to its total-occupant capacity.
    const select = page.locator('select[name="boatId"]');
    const value = await select
      .locator("option", { hasText: `${options.boat} (` })
      .first()
      .getAttribute("value");
    if (!value) throw new Error(`createTrip: no boat named ${options.boat}`);
    await select.selectOption(value);
  }
  if (options.capacity !== undefined) {
    await page.getByLabel("Passenger places").fill(String(options.capacity));
  }
  if (options.price !== undefined) {
    await page.getByLabel(/Price per diver/).fill(String(options.price));
  }
  if (options.cancellationWindowHours !== undefined) {
    await page.getByLabel("Free cancellation until").fill(String(options.cancellationWindowHours));
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
 * On the Trip surface, send a waiver to the first diver and return its relative
 * bearer path. With no E2E email provider, the send result offers a private-link
 * copy control; scope to the Trip roster to exclude crew and wait-list rows.
 */
export async function sendWaiverForFirstDiver(page: Page): Promise<string> {
  const diverSection = page.locator("#roster").filter({ visible: true });
  const row = await openFirstRosterRowWith(page, "Send waiver");
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();
  return waiverLinkFromResult(page, diverSection.getByRole("status"));
}

/** Open and return the first booking row that offers a currently folded control. */
export async function openFirstRosterRowWith(page: Page, control: string): Promise<Locator> {
  const row = page
    .locator('#roster li[id^="booking-"]')
    // `page.locator`, not `getByRole`: the fixture keeps role queries to
    // visible elements, and the control is folded away until the row opens.
    .filter({ has: page.locator("button", { hasText: new RegExp(`^\\s*${control}\\s*$`) }) })
    .first();
  await openRosterDetails(row);
  return row;
}

/** Open one diver's row on the Divers tab, where every fix for their seat waits. */
export async function openRosterRow(page: Page, diverName: string): Promise<Locator> {
  const row = page
    .locator('#roster li[id^="booking-"]')
    .filter({ visible: true })
    .filter({ has: page.getByRole("link", { name: diverName, exact: true }) });
  await openRosterDetails(row);
  return row;
}

/**
 * **The staff home's one heading** — the date, since ADR 20260919-one-idea's
 * decision I · Tide, slice 23a. It replaced "Good morning, Dana": the home is
 * the day, so the day is what the page is called, and a shop's name and a
 * staffer's own name are both already on the bar above it.
 *
 * A pattern rather than a fixed string, because it is today's date and the
 * suite runs every day. `\s`, not a space: a formatted date keeps its month
 * and day together with U+00A0, and a regex is matched against the raw text
 * (a role's accessible name is normalised, `toHaveText` with a regex is not).
 */
export const STAFF_DAY_HEADING = /^[A-Z][a-z]+\s\d{1,2}$/;

/** Allow the fixed eight-second hold and the send to finish (ADR 20260906-before-you-ask). */
export const HELD_SEND_TIMEOUT_MS = 20_000;

/**
 * Copy the private waiver link from the send result and return its relative
 * `/waivers/<token>` path. The URL is not displayed on the page; wait for
 * “Copied” before reading the permitted clipboard value.
 */
export async function waiverLinkFromResult(page: Page, resultNotice: Locator): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // Matched on all three of the control's states, not just its resting label: a
  // "Copy link" tap auto-copies on arrival, so the button may already read
  // "Copied" — or "Try again", if that first write landed outside a user
  // gesture. Clicking is right in every one of them, and the settled "Copied"
  // is what says the write resolved.
  const copy = resultNotice.getByRole("button", { name: /^(Copy link|Copied|Try again)$/ }).first();
  await copy.click();
  await expect(copy).toHaveAccessibleName("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const path = copied.startsWith("http") ? new URL(copied).pathname : copied;
  if (!path.startsWith("/waivers/")) {
    throw new Error(`expected a /waivers/ bearer link on the clipboard, got ${copied}`);
  }
  return path;
}

/**
 * Read the link after the caller activates the diver-record copy button. This
 * channel reports its resolved copy outcome in a toast instead of a result-strip button.
 */
export async function waiverLinkFromToast(page: Page): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(page.getByRole("status")).toHaveText(/^(Copied|Try again)$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const path = copied.startsWith("http") ? new URL(copied).pathname : copied;
  if (!path.startsWith("/waivers/")) {
    throw new Error(`expected a /waivers/ bearer link on the clipboard, got ${copied}`);
  }
  return path;
}

/** Bound the board crawl to 13 weekly hops (about a quarter year). */
const MAX_WEEK_HOPS = 13;

/**
 * Find the exact title link on the current board, following its explicit
 * next-week pager for at most `MAX_WEEK_HOPS`. Wait for streamed board content
 * before counting links. This search does not wait for a just-submitted trip;
 * callers must first await the action's notice or redirect.
 */
async function walkBoardWeeksFor(page: Page, title: string | RegExp): Promise<Locator> {
  // Wait for the streamed builder before count(), which does not auto-wait.
  // Activity can retain a prior builder, so search only the visible board/hooks.
  await page.locator("[data-schedule-builder]").filter({ visible: true }).waitFor();
  const board = page.locator("[data-week-board]").filter({ visible: true });
  for (let hops = 0; hops < MAX_WEEK_HOPS; hops++) {
    const link = board.getByRole("link", { name: title, exact: true });
    if ((await link.count()) > 0) return link.first();
    // Follow the explicit next-week link so pager order/copy cannot change the
    // target; navigate by href even when the link is off-screen.
    const next = board.locator('a[data-week-step="next"]');
    if ((await next.count()) === 0) break;
    const nextHref = await next.getAttribute("href");
    if (!nextHref) break;
    await page.goto(nextHref);
    await page.locator("[data-schedule-builder]").filter({ visible: true }).waitFor();
  }
  throw new Error(`trip "${title}" not found on the schedule board after paging`);
}

/** Open a shop's board and find a trip, optionally starting at a known week. */
export async function findTripOnBoard(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
  options: { daysOut?: number } = {},
): Promise<Locator> {
  // Start near a known departure to avoid rendering every earlier week.
  const week = options.daysOut === undefined ? "" : `?week=${daysFromNow(options.daysOut)}`;
  await page.goto(`/shop/${shopSlug}/schedule/board${week}`);
  return walkBoardWeeksFor(page, title);
}

/** Return the card href without clicking and racing its navigation. */
export async function tripPathByTitle(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
  options: { daysOut?: number } = {},
): Promise<string> {
  const link = await findTripOnBoard(page, shopSlug, title, options);
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`no trip card found for ${title}`);
  return href;
}

/**
 * Open the counter for the boat a diver is on, the way the desk finds it:
 * Today's arrival lookup, then the match's own row, which lands on that
 * departure's Divers tab — the roster carries the desk's taps once arrivals
 * open. Returns the trip id read off the landing URL.
 */
export async function openCounterFor(page: Page, shopSlug: string, diverName: string) {
  await page.goto(`/shop/${shopSlug}?q=${encodeURIComponent(diverName)}`);
  await page
    .getByRole("link", { name: new RegExp(`check-in for ${escapeRegExp(diverName)}$`) })
    .first()
    .click();
  await page.waitForURL(new RegExp(`/shop/${shopSlug}/trips/[0-9a-f-]{36}(\\?[^#]*)?(#.*)?$`));
  // The nav follows the page: a departure lights Schedule, which claims it
  // (issue #2252). A sidebar left on Today is a stale router, not a slow one.
  await page
    .locator("a[aria-current]")
    .filter({ hasText: "Schedule", visible: true })
    .first()
    .waitFor();
  const tripId = new URL(page.url()).pathname.match(/\/trips\/([0-9a-f-]{36})$/)?.[1];
  if (!tripId) throw new Error(`no trip id in ${page.url()} after opening ${diverName}'s counter`);
  return tripId;
}

/** The counter for one boat: the departure's Divers tab, the trip root. */
export function counterPath(shopSlug: string, tripId: string): string {
  return `/shop/${shopSlug}/trips/${tripId}`;
}

/**
 * The departure door's counter mode: the new-diver form for a walk-in on this
 * boat (`SEAT_SURFACES.departure.walkIn`). The Divers tab's own search reaches
 * it through "Add as a walk-in"; tests that are not about that link go straight
 * to it.
 */
export function walkInFormPath(shopSlug: string, tripId: string): string {
  return `/shop/${shopSlug}/divers/new?surface=departure&walkIn=true&tripId=${tripId}`;
}

/**
 * Seat a returning diver from the boat's Divers tab: search, then the row's own
 * add button. This is the roster's door, so the seat lands as an ordinary
 * "Diver added…" (`notice=diver-added…`).
 */
export async function seatFromRoster(page: Page, tripId: string, name: string): Promise<void> {
  await page.goto(counterPath("blue-mantis", tripId));
  const find = page.getByRole("searchbox", { name: "Find a returning diver" });
  await find.fill(name);
  await find.press("Enter");
  await page.getByRole("button", { name: `Add ${name} to the trip` }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}\\?notice=(diver|walkin)-added`));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A seeded departure's trip id, found the way staff reach it. `daysOut` is the
 * seed's own offset for the departure (`at(31, …)`): the board opens on that
 * week instead of crawling to it from this one.
 */
export async function seededTripId(
  page: Page,
  shopSlug: string,
  title: string,
  options: { daysOut?: number } = {},
): Promise<string> {
  const href = await tripPathByTitle(page, shopSlug, title, options);
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
/** Get the same settings rail at any viewport width. */
export async function openSettingsRail(page: Page): Promise<Locator> {
  const rail = page.getByRole("navigation", { name: "Settings sections" });
  await expect(rail).toBeVisible();
  return rail;
}

export async function openSettingsRow(page: Page, heading: string) {
  const rail = await openSettingsRail(page);
  await rail.getByRole("link", { name: heading, exact: true }).click();
  const details = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { level: 3, name: heading, exact: true }) })
    .first();
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute("open", "");
}

/**
 * Open a Trip roster card's "Details" disclosure.
 *
 * Every seat is one line (owner, 2026-10-05): its blockers and advisories
 * are sentences under the name, and everything the row can *do* — the waiver
 * control, the payment selector, the emergency contact form, the private
 * notes, "Remove booking" — waits behind the row's one disclosure with the
 * reference facts.
 *
 * The disclosure is uncontrolled — its `open` is native DOM state React does
 * not touch — so this checks before clicking rather than toggling blindly,
 * exactly like `openPrivateNotes` in add-diver.spec.ts.
 */
/** Open the rare booking operations only when a flow actually needs them. */
export async function openBookingActions(row: Locator): Promise<void> {
  await openRosterDetails(row);
  await openIfClosed(
    row
      .locator("details")
      .filter({ has: row.page().locator(":scope > summary", { hasText: "Booking actions" }) }),
  );
}

export async function openRosterDetails(row: Locator): Promise<void> {
  // The row's own disclosure, named by its mark — not the desk's "Not here"
  // door, which is also a direct `<details>` of the row once arrivals open.
  await openIfClosed(
    row
      .locator(":scope > details")
      .filter({ has: row.page().locator('summary[aria-label^="Details for "]') }),
  );
}

/**
 * Open a Trip roster card's private-notes disclosure — a sibling of the
 * "Details" one above, not nested inside it, because writing a note about a
 * diver is desk work a staffer starts from the card rather than reference.
 *
 * The same check-before-click matters more here than anywhere else on the
 * roster: adding a note no longer navigates, so the disclosure a spec opened to
 * write one is *still open* when it comes back to delete it. Clicking blind
 * would close it and take the Delete button with it.
 */
export async function openRosterNotes(row: Locator): Promise<void> {
  await openRosterDetails(row);
  await openIfClosed(
    row
      .locator(":scope > details details")
      .filter({ hasText: /Private staff notes|Add a private note/ })
      .first(),
  );
}

/**
 * One roll-call row on the boat manifest, by the person it names.
 *
 * The row's name is not a heading any more (ADR
 * 20260827-the-departure-is-two-working-surfaces, slice 5a): the whole name
 * column is the person's `<summary>`, and a heading is not phrasing content a
 * summary may hold beside an index and a caret. Specs used to anchor on the
 * `<h3>` for a real reason — a bare `hasText` also matched whichever *other*
 * row happened to carry the name in a buddy chip, and that misread Omar's row
 * as Sam's on this suite's first CI run. Scoping to `> ul > li` restores that
 * guarantee from the other end: within the roster list a person's name appears
 * on their own row and nowhere else.
 */
export function manifestRow(page: Page, name: string): Locator {
  return page.locator("#roll-call-list > ul > li").filter({
    has: page.locator('button[aria-haspopup="dialog"]', { hasText: name }),
  });
}

/**
 * Wait until the manifest's offline copy has been saved in the background.
 *
 * Specs used to wait on the "Open offline roll call" link, which since slice
 * 5a lives inside the collapsed "On this phone" group and is therefore not
 * visible at rest (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 2 — device settings are "ashore, not here"). The freshness pill is
 * the better signal anyway and is deliberately *not* behind the tap: a stale
 * copy that looks current is the failure mode the whole mechanism exists to
 * prevent, so its state rides the summary line.
 */
export async function offlineCopySaved(page: Page): Promise<void> {
  await expect(page.getByText(/(Fresh|Aging|Stale) copy/)).toBeVisible();
}

/**
 * Open the manifest's boat check — the pre-departure safety list, which rests
 * as one line stating how many of how many are checked (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 2: the items are a
 * "one tap away" concern; the check itself happens once, before the boat
 * leaves).
 */
export async function openBoatCheck(page: Page): Promise<void> {
  await openIfClosed(
    page
      .locator("details")
      .filter({ has: page.locator("#pre-departure-check-heading") })
      .first(),
  );
}

/** Open the manifest's "On this phone" group — offline detail, push, toggles. */
export async function openOnThisPhone(page: Page): Promise<void> {
  await openIfClosed(
    page
      .locator("details")
      .filter({ has: page.locator("#offline-heading") })
      .first(),
  );
}

/**
 * Open a roll-call row's person panel — the deliberate first step of the
 * two-step that records "not back aboard", and the way to every reference fact
 * the row tucks away (contact, medical, notes, buddy team).
 */
export async function openManifestPerson(row: Locator): Promise<void> {
  const body = row.locator("xpath=ancestor::body");
  // A sheet just closed stays mounted, `inert`, for its exit animation
  // (`useDialogBehaviour`): its × is out of the accessibility tree, so only a
  // sheet still open is closed here, and one on its way out is waited away.
  const openDialog = body.locator('[role="dialog"]:not([inert])');
  if (await openDialog.count()) {
    await openDialog.getByRole("button", { name: "Close person details" }).click();
  }
  await expect(body.locator('[role="dialog"]')).toHaveCount(0);
  const trigger = row.locator('button[aria-haspopup="dialog"]').first();
  // The sheet opens client-side only: a click on the server-rendered trigger
  // before hydration (a fresh load, or the router's hard-navigation fallback
  // when an RSC fetch fails) is dropped, and aria-expanded never turns.
  await expect(trigger).toHaveAttribute("data-hydrated", "true");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/**
 * Open a departure's activity log, which lives on its Details tab
 * (`?view=details`) beside "Promote this trip", not under the roster. Call it
 * from any tab of the departure; it leaves the page on Details, so a spec that
 * goes on to work the roster returns with `openTripTab(page, "Trip")`.
 */
export async function openTripActivity(page: Page): Promise<void> {
  await page.waitForURL(TRIP_SURFACE_URL);
  const root = new URL(page.url()).pathname.match(/^(.*\/trips\/[^/?#]+)/)?.[1];
  if (!root)
    throw new Error(`openTripActivity called from ${page.url()}, which is not a departure`);
  await page.goto(`${root}?view=details`);
  await page.waitForURL(/\?view=details/);
  await openIfClosed(
    page
      .locator("details")
      .filter({ hasText: /^Activity/ })
      .filter({ visible: true })
      .first(),
  );
}

/**
 * Open one file group on a diver's record (`/shop/<slug>/divers/<personId>`).
 *
 * Every group there — Certification records, Waiver, Gear and sizes, Diver
 * notes, Conversation, Activity — is a closed `<details>` door at
 * every width, and opens itself only for open work (a `?notice=` aimed at it,
 * an unanswered message, a held medical review, a standing can't-fill flag,
 * existing notes). A spec that reaches for a control inside one therefore opens
 * the group first.
 *
 * Idempotent, like every opener here: a group the page already rendered open is
 * left alone rather than toggled shut. The group is found by its accessible
 * name because the label is the `<section aria-label>` and the group's own
 * heading — one string, whichever end you come at it from.
 */
export async function openDiverFileGroup(page: Page, label: string): Promise<Locator> {
  const group = page.getByRole("region", { name: label, exact: true });
  const details = group.locator("details").first();
  await expect(details).toBeVisible();
  await openIfClosed(details);
  return details;
}

/**
 * Open the Gear and sizes group's "Can’t fill a size?" disclosure — the H-06
 * flag, which is a link-weight door inside the group now rather than a standing
 * form under the facts. Opens the group itself first, so a caller needs one
 * call for the two doors between it and the flag.
 *
 * Absent once a flag is up: a raised flag states itself and its way out in the
 * open, so there is nothing to disclose.
 */
export async function openCantFillASize(page: Page): Promise<void> {
  const gear = await openDiverFileGroup(page, "Gear and sizes");
  await openIfClosed(gear.locator("details").filter({ hasText: "Can’t fill a size?" }).first());
}

/**
 * Open every boat's "and N more" under Today's Needs you (`foldBoatRows`).
 *
 * A boat with more than six rows shows five and folds its chores behind the
 * fold; a spec after a row that can fold (a bounced email, "seats open, N want
 * in") opens it first. Call after the page has rendered Needs you.
 */
export async function openTodayBoatFolds(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
  const folds = page.locator("details").filter({
    has: page.locator("> summary", { hasText: /^and \d+ more$/ }),
  });
  // diveday:allow-e2e-hygiene empty-all: no fold is a boat of six rows or fewer, all shown; the caller then waits for its own row, which fails loudly if it is missing.
  for (const fold of await folds.all()) await openIfClosed(fold);
}

/**
 * Native `open` is DOM state React never touches, so check before toggling.
 *
 * `> summary`, not `summary`: these panels contain other disclosures (the
 * emergency-contact edit form is one), and a descendant `<summary>` would make
 * this ambiguous under strict mode — or, worse, click the wrong one and leave
 * the panel shut. A `<details>` is opened only by its own direct summary.
 */
export async function openIfClosed(details: Locator): Promise<void> {
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator("> summary").click();
  await disclosureSettled(details);
}

/**
 * **Wait for a disclosure's body to finish arriving, not merely to be open.**
 *
 * Since the body animates in (`details::details-content` in globals.css), the
 * frame where `open` flips is *not* the frame where the content is laid out:
 * `content-visibility` transitions discretely, so for one frame the panel still
 * occupies no height. A spec that opens a disclosure and immediately measures
 * anything positional reads the page as it was a frame ago — which is how
 * `add-diver.spec.ts` came to record a scroll position 235px above where the
 * notes box actually settled, and then fail its own "the page did not jump"
 * assertion by that margin.
 *
 * Waiting on the animation's end state rather than on a duration: opacity is
 * `1` only once the arrival has run, and Playwright polls it. A reader with
 * `prefers-reduced-motion` gets `1` on the first poll, which is the same
 * answer one frame earlier.
 */
export async function disclosureSettled(details: Locator): Promise<void> {
  await expect
    .poll(() =>
      details.evaluate((el) => {
        const transitioning = el.getAnimations().some((animation) => {
          const effect = animation.effect;
          return (
            effect instanceof KeyframeEffect &&
            effect.pseudoElement === "::details-content" &&
            animation.playState !== "finished" &&
            animation.playState !== "idle"
          );
        });
        return getComputedStyle(el, "::details-content").opacity === "1" && !transitioning;
      }),
    )
    .toBe(true);
}

/**
 * Open one departure **inside the embed widget**, by the route a visitor takes.
 *
 * The widget shows the next four departures and a link to the full schedule
 * (issue #805), so a spec that wants a specific trip — one it just created, or
 * a seeded course a few days out — can no longer click it in the frame. It
 * follows the widget's own way out, finds the trip on the real page, and comes
 * back into the frame at that trip.
 *
 * That is the visitor's path rather than a shortcut around the change, and it
 * exercises the link while it is there. The full schedule opens in a new tab by
 * design — a page loaded *inside* a 900px frame is the nested scroll the widget
 * exists to avoid — so this closes it and returns the caller to the embed.
 */
export async function openTripInEmbed(page: Page, title: string | RegExp): Promise<void> {
  const [fullSchedule] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "See the full schedule" }).click(),
  ]);
  await fullSchedule
    .locator("li, a")
    .filter({ hasText: title })
    .filter({ visible: true })
    .first()
    .click();
  // The destination's own URL shape, not a duration: the click is a client
  // navigation, and reading `url()` before it settles hands back the schedule.
  await fullSchedule.waitForURL(/\/trips\//);
  const tripPath = new URL(fullSchedule.url()).pathname;
  await fullSchedule.close();
  await page.goto(`${tripPath}?embed=1`, { waitUntil: "domcontentloaded" });
}

/**
 * Open the "Mark signed on paper" form inside `scope`, once React owns the
 * trigger. The form opens client-side only, so a click that lands before
 * hydration is swallowed and the spec waits on a form that never comes
 * (`PaperWaiverControl` publishes the staff surfaces' `data-hydrated` flag).
 */
export async function openPaperWaiverForm(scope: Page | Locator) {
  const trigger = scope.getByRole("button", { name: "Mark signed on paper" });
  await expect(trigger).toHaveAttribute("data-hydrated", "true");
  await trigger.click();
}

/**
 * Write a course form on the waivers page and wait for its save (ADR
 * 20261008-course-forms). The new-form door is a native `<details>`, so its
 * fields render once its summary is clicked, with no hydration to wait on.
 */
export async function writeCourseForm(page: Page, title: string, body: string): Promise<void> {
  await page.goto("/shop/blue-mantis/waivers#course-form-new");
  // The fragment reveals both disclosures. Toggling while the client reveal
  // is still arriving can close the destination that this journey needs open.
  const definitions = page.locator("#course-forms").filter({ visible: true });
  const newForm = page.locator("#course-form-new").filter({ visible: true });
  await expect(definitions).toHaveAttribute("open", "");
  await expect(newForm).toHaveAttribute("open", "");
  await disclosureSettled(definitions);
  await disclosureSettled(newForm);
  await page.locator("#course-form-title-new").fill(title);
  await page.locator("#course-form-body-new").fill(body);
  await page.getByRole("button", { name: "Add form" }).click();
  // The exact title: `hasText` is a case-insensitive substring, so "Safe diving practices"
  // matched the demo's own "Standard Safe Diving Practices Statement of Understanding" before
  // the save landed, and the next navigation could cancel the save.
  await expect(
    page.locator("#course-forms summary").getByText(title, { exact: true }),
  ).toBeVisible();
}

/** Choose a written course form on a course's page and wait for the save. */
export async function requireCourseForm(
  page: Page,
  courseSlug: string,
  title: string,
): Promise<void> {
  await page.goto(`/shop/blue-mantis/courses/${courseSlug}/edit`);
  // A closed row of the course page's one form (visual review 2026-10-24, A11).
  const forms = page.locator("#forms");
  await forms.locator("> summary").click();
  await forms.getByRole("checkbox", { name: title, exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Course page saved")).toBeVisible();
}

/**
 * Schedule a session of Open Water Diver with an instructor on its crew, so
 * it takes bookings, and return the staff path of its Divers tab.
 */
export async function scheduleCrewedOpenWaterSession(
  page: Page,
  title: string,
  daysOut: number,
): Promise<string> {
  await createTrip(page, {
    course: "Open Water Diver",
    title,
    date: daysFromNow(daysOut),
    departsAt: "08:00",
    returnsAt: "17:00",
  });
  const tripPath = await tripPathByTitle(page, "blue-mantis", new RegExp(`^${title}$`));
  await page.goto(tripPath);
  await openTripAbout(page);
  // The refusal line is server-rendered, so seeing it says the Details tab
  // has painted; the picker is controlled, so a pick before hydration no-ops.
  await expect(
    page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
  ).toBeVisible();
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
  return tripPath;
}

/**
 * Book the last-listed Open Water session as a signed-out visitor and return
 * the prep link's path. The last one is the session a spec just scheduled:
 * sessions list soonest first, and a spec schedules past every seeded one.
 */
export async function bookOpenWaterSession(
  page: Page,
  name: string,
  email: string,
): Promise<string> {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  await page.getByRole("link", { name: "Book this date" }).last().click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
  return new URL(page.url()).pathname;
}
