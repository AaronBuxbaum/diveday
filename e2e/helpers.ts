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
  await control.getByText(label, { exact: true }).click();
  await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
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
export async function bookASeatAndOpenThread(page: Page, name: string) {
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${e2eNow().getTime()}@example.com`);
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
 * Move between a trip record's surfaces (`TripSubNav` — Trip, Manifest,
 * Prep). The nav is labelled "Trip" and its links are plain
 * `<Link>`s, so the click resolves client-side: waiting on the tab's own path
 * segment here is what keeps a caller's first assertion from racing the
 * in-flight transition. The active tab renders as an inert `<span>`, so
 * calling this for the tab you are already on would hang — navigate, don't
 * re-select.
 */
export async function openTripTab(page: Page, tab: "Trip" | "Manifest" | "Prep") {
  const link = page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: tab });
  // Trip is now the canonical root surface. A board link already lands there,
  // so the helper treats an already-active Trip tab as a successful no-op;
  // Manifest and Prep remain explicit navigations.
  if (tab === "Trip" && (await link.count()) === 0) {
    await expect(page).toHaveURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
    return;
  }
  await link.click();
  await page.waitForURL(
    tab === "Trip" ? /\/trips\/[^/?#]+(?:[?#]|$)/ : new RegExp(`/${tab.toLowerCase()}(\\?|#|$)`),
  );
}

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
 * The schedule board pages a fixed number of departures at a time and has no
 * text search — a trip scheduled far enough out (or created earlier in the
 * same test) can land past the first page. Pages through "Show later
 * departures" until a trip card matching `title` appears, then returns its
 * link locator — call `.click()`, or `.getAttribute("href")` to read the
 * path without racing the click's own navigation.
 *
 * **The board is two compositions, and this crawl walks the stream.** From
 * `xl` (1280px) up the board draws one week as seven columns and the
 * cursor-paged stream is `display:none` behind it (H-63, ADR
 * 20260827-clearwater-surface-language); below that the stream is the board.
 * The stream is in the DOM at every width and is the only one of the two that
 * can walk a whole horizon in one grammar — the week pages seven days at a
 * time — so the crawl reads it either way, and steps by URL rather than by
 * clicking a pager that at desktop is out of the accessibility tree entirely.
 * The returned link is the one the reader can actually *see* where either
 * composition shows the departure, so a `.click()` never lands on the hidden
 * twin; where neither paints it (a desktop board whose visible week is not the
 * one the trip sits in) it is still the right href.
 */
export async function findTripOnBoard(
  page: Page,
  shopSlug: string,
  title: string | RegExp,
): Promise<Locator> {
  await page.goto(`/shop/${shopSlug}/schedule/board`);
  // The same barrier every page below gets: `goto` resolves into the segment's
  // loading.tsx skeleton while the real list streams in, and `count()` doesn't
  // auto-wait — so a slow stream-in read as "no cards and no pager" and the
  // loop concluded the board ended (seen as a one-in-many-runs CI failure
  // hunting a seeded trip). The builder section exists only in the streamed
  // body, whatever the board holds, so its appearance proves the cards and
  // pager are in the DOM. (The old wait target, the "Schedule overview" stat
  // row, left the page with the KPI tiles.)
  await page.getByRole("region", { name: "Schedule builder" }).waitFor();
  for (let hops = 0; hops < 15; hops++) {
    const link = page.locator(`a[href^="/shop/${shopSlug}/trips/"]`).filter({ hasText: title });
    // The visible copy first: both compositions render the same departure with
    // the same href, and at any width one of the two is `display:none`. A
    // caller that clicks what it gets back has to be handed the one on screen.
    const onScreen = link.filter({ visible: true });
    if ((await onScreen.count()) > 0) return onScreen.first();
    if ((await link.count()) > 0) return link.first();
    // An attribute, not a role query. From `xl` up this pager sits inside the
    // hidden day stream: it is in the DOM carrying the href that names the next
    // cursor page, but out of the accessibility tree, so the crawl would
    // conclude the board ended on page one. `includeHidden: true` looks like
    // the answer and is not — `e2e/fixtures.ts` wraps every `getByRole` in
    // `.filter({ visible: true })`, which discards the option silently, and a
    // first fix that passed it went red on CI unchanged (visual shard 2/4,
    // "not found on the schedule board after paging"). `page.locator` is the
    // one query the fixture leaves alone.
    const later = page.locator("a[data-board-pager='next']");
    if ((await later.count()) === 0) break;
    const nextHref = await later.getAttribute("href");
    if (!nextHref) break;
    // A navigation rather than a click, for the same reason: the link cannot
    // be clicked at a width that does not paint it. The barrier after it is
    // the one above — the builder section exists only in the streamed body, so
    // its appearance proves this page's cards and pager are in the DOM rather
    // than the linkless skeleton.
    await page.goto(nextHref);
    await page.getByRole("region", { name: "Schedule builder" }).waitFor();
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
  return page
    .locator("#roll-call-list > ul > li")
    .filter({ has: page.locator("summary", { hasText: name }) });
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
  await openIfClosed(row.locator("details").first());
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
