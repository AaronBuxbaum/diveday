import { expect, type Locator, type Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { E2E_FROZEN_CLOCK } from "./servers";

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
  await page.locator("[data-identity-menu]").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign out? Confirm" }).click();
  await expect(page).toHaveURL(/\/$/);
  invalidateStaffStorageState();
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
 * Choose the party size on a public booking form, whichever control the boat's
 * remaining seats put there.
 *
 * The count is a **segmented row of radios up to six seats and a `<select>`
 * above that** (ADR 20260827-the-divers-thread, decision 2 —
 * `MAX_PUBLIC_PARTY_SIZE` is 20, and a twenty-segment track fits no phone), so
 * which shape a spec meets depends on how full the departure is, which is not
 * a fact any of these specs is about. Both shapes answer to one accessible
 * name, so the wait is shared; only the act differs.
 */
export async function choosePartySize(page: Page, count: number) {
  const control = page.getByLabel("Number of divers");
  await expect(control).toHaveAttribute("data-hydrated", "true");
  if ((await control.evaluate((node: Element) => node.tagName)) === "SELECT") {
    await control.selectOption(String(count));
    return;
  }
  const label = count === 1 ? "1 diver" : `${count} divers`;
  // Click the **label**, which is what a diver's thumb lands on, then assert
  // the input took the value. `check()` on the radio itself cannot work here
  // and cannot fail fast either: the input is `sr-only`, a 1px box lying under
  // the very `<label>` that wraps it, so Playwright's hit-target check finds
  // the label in front of its click point and retries that — "intercepts
  // pointer events" — until the whole test times out. Three specs and both
  // party-organizer captures died that way on 2026-08-28, each one a
  // three-minute hang rather than an assertion.
  //
  // The label is found by the **value of the radio it wraps**, never by its own
  // text: the segment showed "2 divers" until 2026-09-06 and shows "2" now, and
  // a helper keyed on that spelling took the same 30-second hang the moment it
  // changed (`courses.spec.ts`, CI on PR #1416). The accessible name is still
  // the plural sentence, which is what the assertion below reads.
  await control.locator(`label:has(input[value="${count}"])`).click();
  await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
}

/**
 * Answer "What's this dive for?" on the diver's own thread and save it.
 *
 * The question was five pills on the public booking form until 2026-09-06; it
 * is one `<select>` in the Day-of step of `/ready/<token>` now, asked after the
 * sale of the diver whose seat it is. Scoped to its own `<form>` because the
 * recency question sits in the same step behind a Save spelled the same word,
 * and waits on the page's own notice rather than a timeout — the redirect
 * carries no hash, so the confirmation is the only thing that says it landed.
 */
export async function saveDiveIntent(page: Page, label: string) {
  const step = await openThreadStep(page, "dayof");
  const form = step.locator("form").filter({ hasText: "What’s this dive for?" });
  await form.getByLabel("What’s this dive for?").selectOption({ label });
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The crew will know what you came for" }),
  ).toBeVisible();
}

/**
 * Book one seat on the departure whose public page is already open, and land
 * on the diver's own thread (`/ready/<token>`).
 *
 * The trip page stopped carrying the packing list and the dive briefings on
 * 2026-08-28 (ADR 20260827-the-divers-thread, decision 2 — the page sells, then
 * closes; what to bring and what you'll see down there are *preparation*, and
 * preparation belongs to a diver who has a seat). A spec about that reading
 * therefore has to hold one.
 */
export async function bookASeatAndOpenThread(page: Page, name: string, email?: string) {
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    // A caller passes one when it has to *say* the address afterwards — a
    // test-only seed route that resolves a diver by email, say. Otherwise the
    // derived one keeps every booking this makes distinct without a caller
    // having to care.
    .fill(
      email ?? `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${e2eNow().getTime()}@example.com`,
    );
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
}

/**
 * The thread page's **one status statement** — "2 of 4 done · Next: Gear and
 * sizes" (ADR 20260827-the-divers-thread, decision 3, slice 7c).
 *
 * The stable anchor for "the prep state has rendered". Specs used to wait on
 * the heading "Your pre-trip checklist", which went with the card that carried
 * it; every remaining heading on the page is either the trip's own title or a
 * step name only some bookings have.
 *
 * A `data-testid` through `page.locator` rather than `getByTestId`, because
 * counting it is half of what it pins: exactly one element on the page may say
 * the booking's status.
 */
export function threadStatus(page: Page): Locator {
  return page.locator('[data-testid="thread-status"]');
}

/**
 * Open one step of the thread's spine and hand back its `<details>`.
 *
 * **At most one step is open at rest**, so a spec that wants the rental form,
 * the recency select or a card-entry disclosure has to open its step first —
 * exactly as a diver does. The steps share one native `<details name>`
 * accordion, so opening one closes whichever was open.
 *
 * Scoped through `data-thread-step` and `page.locator`: `e2e/fixtures.ts`
 * filters every `getBy*` to visible nodes, which a closed disclosure's
 * contents are not.
 */
export async function openThreadStep(page: Page, step: string): Promise<Locator> {
  // Direct children, not descendants, in BOTH steps below. Slice 7c put per-card
  // disclosures inside a step body, so a descendant selector matches the step *and*
  // the cards within it, and Playwright refuses the ambiguity. The certification
  // step is the one that proves it: its body holds "Add your certification" and
  // "Add your nitrox card", so a descendant `summary` search finds three.
  const details = page.locator(`[data-thread-step="${step}"] > details`);
  await details.waitFor();
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return details;
  await details.locator(":scope > summary").click();
  // Wait on the disclosure's own state, never on the form inside it: a step
  // whose body is slow to lay out is still open the instant the tap lands.
  await expect(details).toHaveAttribute("open", "");
  return details;
}

/**
 * Open one of the after-state's quiet doors and hand back its `<details>`.
 *
 * The thread's third state (ADR 20260827-the-divers-thread, decision 4) keeps
 * photos, the tip and the Google hand-off behind hairline `<details>` rows, so
 * a spec that wants the uploader or the tip presets opens its door first —
 * exactly as a diver does. Same construction and same reasoning as
 * {@link openThreadStep} above; the doors are not an accordion group, so
 * opening one leaves the others as they were.
 */
export async function openRecapDoor(page: Page, door: string): Promise<Locator> {
  const details = page.locator(`[data-recap-door="${door}"] details`);
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
 * Move between a departure's surfaces.
 *
 * **There is no tab strip any more** (ADR 20260919-one-idea, slice 23c). The
 * packing list reads on the departure page itself, and the manifest is reached
 * from one chip in the sky band. `/prep` survives as its own route because the
 * paper day composes it, and it renders the same `PrepBody` — so a capture
 * taken there still photographs the real thing, on a page that is only the
 * list rather than the whole departure.
 *
 * So this navigates by URL rather than by clicking a strip that is gone. It is
 * deliberately not a `getByRole("link")` on the band's Manifest chip: a helper
 * every spec leans on should put the caller on a surface, and
 * `boat-loop.spec.ts` is where the chip itself is the subject.
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
  if (url.pathname === target) return;
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
  return page.getByRole("region", { name: "Guests" }).locator("li").filter({ hasText: diverName });
}

const TRIP_ROOT_URL = /\/trips\/[^/?#]+(?:[?#]|$)/;
/** Any of a departure's surfaces — the root itself, or one of its sub-pages. */
const TRIP_SURFACE_URL = /\/trips\/[^/?#]+/;

/** Open the Trip surface's compact About disclosure before using its details. */
export async function openTripAbout(page: Page): Promise<Locator> {
  const about = page.locator("details#about");
  await expect(about).toBeVisible();
  if ((await about.getAttribute("open")) === null) {
    await about.locator(":scope > summary").click();
  }
  await expect(about).toHaveAttribute("open", "");
  return about;
}

/**
 * Open the About panel's "More for this departure" list — where the rare and
 * destructive acts live (the weather blow-out, cancelling the departure, the
 * series-wide writes). Opens the panel itself first.
 */
export async function openTripMore(page: Page): Promise<Locator> {
  await openTripAbout(page);
  const list = page.locator("details#about-more");
  if ((await list.getAttribute("open")) === null) {
    await list.locator(":scope > summary").click();
  }
  await expect(list).toHaveAttribute("open", "");
  return list;
}

/**
 * Open one About row's editor — the departure's crew, its price, the days it
 * runs. A row opens itself only while its subject has open work, so a settled
 * one (a boat with crew on it) takes a tap. Opens the panel itself first.
 */
export async function openTripAboutRow(page: Page, id: string): Promise<Locator> {
  await openTripAbout(page);
  const row = page.locator(`details#${id}`);
  await expect(row).toBeVisible();
  await openIfClosed(row);
  return row;
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
 * Send the waiver to the first diver on the open trip's Trip roster and
 * return the bearer link it hands back — a relative `/waivers/<token>` path.
 *
 * The e2e fleet configures no email provider, so the shared
 * `WaiverSendControl` always falls to its private-link affordance instead of
 * "Waiver sent to …", and that inline `role="status"` result is where the
 * link lives. The button label is matched exactly, and the whole thing is
 * scoped to the Trip roster so it can't pick up a crew or wait-list control
 * with a similar name.
 *
 * Caller must already be on the trip's Trip surface (`openTripTab(page,
 * "Trip")`); this deliberately does not navigate, because several specs
 * need the staff URL they were on to return to afterwards.
 */
export async function sendWaiverForFirstDiver(page: Page): Promise<string> {
  const diverSection = page.locator("#roster").filter({ visible: true });
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  return waiverLinkFromResult(page, diverSection.getByRole("status"));
}

/**
 * Take the bearer link out of a send control's result strip, the way a staffer
 * does: by asking for it.
 *
 * The strip used to print the URL as a live anchor, and every spec below read
 * its `href`. It no longer prints one at all — a bearer credential sitting on
 * screen at rest, under a sentence suggesting somebody share it, was three
 * mistakes in a row (see `WaiverSendControl`) — so the only route to the link
 * is the control that puts it on the clipboard. Which makes this the honest
 * test of the new behaviour rather than a workaround for it.
 *
 * "Copied" is the deterministic signal that the write resolved; nothing here
 * sleeps or retries. Reading the clipboard back needs the permission, which is
 * granted per context and is a no-op the second time.
 */
/**
 * How long a spec allows a held send's outcome to appear: the eight-second
 * hold every waiver, deal and wait-list send takes first (ADR
 * 20260906-before-you-ask, decision 2), then the send itself. Deterministic —
 * the hold is a fixed length the client counts down on its own clock — so it
 * is a bound, not a guess.
 */
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

export const HELD_SEND_TIMEOUT_MS = 20_000;

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
 * The diver record's own "Copy link" channel button, which behaves nothing
 * like `waiverLinkFromResult`'s roster control: the tap copies immediately
 * (no second confirming button inside a result strip to click), and the
 * outcome is a `Toast` — a plain, non-interactive `role="status"` line, not a
 * box with a control inside it. Caller has already clicked "Copy link";
 * this waits for that toast to settle to its own resolved text and reads the
 * clipboard, the same deterministic signal `waiverLinkFromResult` uses.
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

/**
 * How far the crawl below pages before it gives up: a quarter of a year, which
 * is past anything the seed or a spec schedules. The throw names the title, so
 * a spec that outruns it says which departure it was hunting.
 */
const MAX_WEEK_HOPS = 13;

/**
 * **Find a departure on the staff board, paging forward a week at a time**,
 * and answer with its title link — `.click()` it, or read
 * `.getAttribute("href")` to get the path without racing the click's own
 * navigation. The page must already be on the board.
 *
 * **It walks weeks now, not a cursor** (#1923). The board used to draw the
 * same departures twice — a cursor-paged vertical stream and, from `xl` up, a
 * seven-column week — and this crawl stepped the stream's `?after=` pager
 * because it was the only one of the two that could walk a whole horizon in
 * one grammar. The stream is gone, so the horizon is walked seven days at a
 * time through the week pager's own `?week=` href. That costs hops: a
 * departure six weeks out is six navigations rather than two cursor pages.
 *
 * **Which is also why a spec can no longer assume the trip it just made is on
 * the board it lands on.** `E2E_FROZEN_CLOCK` is a Tuesday, so `daysFromNow(6)`
 * is the following Monday — deterministically off the week the board opens to,
 * which is how ten specs went red at once rather than flaking. A spec that
 * wants a *particular* week rather than the first one holding a title says so
 * with `?week=<any date in it>` instead of calling this.
 *
 * **It searches settled content and never waits for a write.** Each week is
 * read with `count()`, so a caller that has just submitted the departure it is
 * hunting must put the action's own barrier in between — the `role="status"`
 * line naming the title, or `page.waitForURL` on the `?notice=` redirect. A
 * crawl started mid-flight walks straight past the week the trip is about to
 * land on and hunts it to the end of the horizon
 * (`.claude/rules/e2e.md`'s `action-race`).
 *
 * **The link is matched by its exact accessible name**, not by row text: an
 * unpriced departure's row also carries a "Set a price for {title}, {date}
 * {time}" link, and a title that is another title's prefix — `X` beside
 * `X (PM)`, which this suite's rename specs create on purpose — matches both
 * under a substring.
 */
async function walkBoardWeeksFor(page: Page, title: string | RegExp): Promise<Locator> {
  // The same barrier every page below gets: `goto` resolves into the segment's
  // loading.tsx skeleton while the real week streams in, and `count()` doesn't
  // auto-wait — so a slow stream-in reads as "no rows and no pager" and the
  // loop concludes the board ended (seen as a one-in-many-runs CI failure
  // hunting a seeded trip). The builder section exists only in the streamed
  // body, whatever the board holds, so its appearance proves the rows and the
  // pager are in the DOM.
  //
  // **By its `data-` hook, never by its accessible name.** The section's
  // `aria-label` is copy, so `getByRole("region", { name: "Schedule builder" })`
  // waits forever on a Spanish run — which is how three visual captures went
  // red the first time this crawl was shared with `openTripFromBoard`.
  await page.locator("[data-schedule-builder]").waitFor();
  for (let hops = 0; hops < MAX_WEEK_HOPS; hops++) {
    const link = page.locator("[data-week-board]").getByRole("link", { name: title, exact: true });
    if ((await link.count()) > 0) return link.first();
    // The step's own copy-free hook, not "a link with a week in its href": the
    // pager renders three of those — previous, next, and the way home — and a
    // positional pick among them is one reorder away from walking backwards
    // forever. A navigation rather than a click, so a step that has scrolled
    // out of view on a tall week is still followable.
    const next = page.locator('[data-week-board] a[data-week-step="next"]');
    if ((await next.count()) === 0) break;
    const nextHref = await next.getAttribute("href");
    if (!nextHref) break;
    await page.goto(nextHref);
    await page.locator("[data-schedule-builder]").waitFor();
  }
  throw new Error(`trip "${title}" not found on the schedule board after paging`);
}

/** The same crawl, from the top of the board rather than wherever the page is. */
export async function findTripOnBoard(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
): Promise<Locator> {
  await page.goto(`/shop/${shopSlug}/schedule/board`);
  return walkBoardWeeksFor(page, title);
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
 * A seeded diver's person id, found the way staff reach them — through the
 * roster's own search rather than a fixture constant, so a re-seed that gives
 * them a new id changes nothing here.
 */
export async function seededDiverId(
  page: Page,
  shopSlug: string,
  fullName: string,
): Promise<string> {
  await page.goto(`/shop/${shopSlug}/divers?q=${encodeURIComponent(fullName)}`);
  const href = await page
    .getByRole("link", { name: fullName, exact: true })
    .first()
    .getAttribute("href");
  const personId = href?.match(/\/divers\/([0-9a-f-]+)/i)?.[1];
  if (!personId) throw new Error(`could not read a person id for ${fullName}`);
  return personId;
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
 * Open a Trip roster card's "Details" disclosure.
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
  await openIfClosed(
    row
      .locator("details")
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
  const existingDialog = body.getByRole("dialog");
  if (await existingDialog.count()) {
    await existingDialog.getByRole("button", { name: "Close person details" }).click();
    await expect(existingDialog).toHaveCount(0);
  }
  const trigger = row.locator('button[aria-haspopup="dialog"]').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Open the Guests page activity log when a spec needs to inspect its audit trail. */
export async function openTripActivity(page: Page): Promise<void> {
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
 * notes, Conversation, Dive support, Activity — is a closed `<details>` door at
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
      details.evaluate((el) => getComputedStyle(el, "::details-content").opacity).catch(() => "1"),
    )
    .toBe("1");
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
