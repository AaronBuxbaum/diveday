import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

/**
 * READ_ONLY holds here: the command palette navigates, and the divers list filters from
 * the URL. Typing into either writes nothing.
 */

signedInAsOwner();

test("the command palette finds a diver by name and ⌘K jumps to a page shortcut", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // The nav Search button opens the palette (phone users have no ⌘K).
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });
  await expect(box).toBeFocused();

  await box.fill("Priya");
  const option = page.getByRole("option", { name: /Priya Sharma/ });
  await expect(option).toBeVisible();

  // Keyboard-only: first result is active, Enter navigates to the person record.
  await box.press("Enter");
  await expect(page).toHaveURL(/\/divers\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: /Priya Sharma/ })).toBeVisible();

  // ⌘K reopens the palette anywhere, and a "Go to" shortcut jumps to a page.
  await page.keyboard.press("ControlOrMeta+k");
  const reopened = page.getByRole("combobox", { name: /Search divers/ });
  await expect(reopened).toBeFocused();
  // "Not ready" is not a destination any more — it was a page, then Today's
  // by-departure view, and the shop home is now one chronological spine where a
  // blocked diver is a row on their boat's station (ADR
  // 20260827-clearwater-surface-language, decision 4). The palette offers no
  // second row landing on Today's own URL.
  await reopened.fill("Not ready");
  await expect(page.getByRole("option", { name: "Not ready" })).toHaveCount(0);
  await reopened.fill("Today");
  await page.getByRole("option", { name: "Today" }).first().click();
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
});

test("the command palette also finds dive sites, courses, and every gated nav destination", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });

  await box.fill("Spiegel Grove");
  const siteOption = page.getByRole("option", { name: "Spiegel Grove", exact: true });
  await expect(siteOption).toBeVisible();
  await siteOption.click();
  await expect(page).toHaveURL(/\/dive-sites\/[a-f0-9-]+$/);

  await page.keyboard.press("ControlOrMeta+k");
  const reopened = page.getByRole("combobox", { name: /Search divers/ });
  await reopened.fill("Open Water Diver");
  const courseOption = page.getByRole("option", { name: "Open Water Diver", exact: true });
  await expect(courseOption).toBeVisible();
  await courseOption.click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/edit$/);

  // The owner role sees every gated destination, including the reports/promos
  // pair that's hidden from non-owner/manager staff.
  await page.keyboard.press("ControlOrMeta+k");
  const shortcuts = page.getByRole("combobox", { name: /Search divers/ });
  for (const [query, urlPattern] of [
    ["Check-in", /\/check-in$/],
    ["Staffing", /\/staffing$/],
    ["Dive sites", /\/dive-sites$/],
    ["Courses", /\/courses$/],
    ["Reviews", /\/reviews$/],
    ["Reports", /\/reports$/],
    ["Promo codes", /\/promos$/],
    // Both used to exist in only one of the palette/nav pair; they come from
    // the shared destination registry now, so each is reachable from both.
    ["Orders", /\/orders$/],
    ["Team", /\/settings\/team$/],
    // The global seat-a-diver door. It was hand-written into the palette
    // itself until it earned a registry entry of its own, so this row proves
    // the palette reads the shared destination registry. Not that the nav
    // does: `addBooking` is `navGroup: null` (it is an action, and the board
    // keeps its own button), so no header tab has ever named it.
    ["Add a booking", /\/bookings\/new$/],
  ] as const) {
    await shortcuts.fill(query);
    await page.getByRole("option", { name: query, exact: true }).click();
    await expect(page).toHaveURL(urlPattern);
    await page.keyboard.press("ControlOrMeta+k");
  }
});

/**
 * **Type what the page calls itself, not what the tab calls it.**
 *
 * The "Go to" rows are built from the nav's vocabulary and eight staff pages
 * are written in the product's, so a staffer who thinks of Reports as "How's
 * your month" and typed that got nothing back — the page was reachable only by
 * a word they never read on it (issue #824). The row still *says* the nav
 * label: two names on one row is a list you have to read twice.
 */
test("the command palette finds a page by the headline it wears", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });

  for (const [headline, label, urlPattern] of [
    ["How's your month", "Reports", /\/reports$/],
    ["What divers said", "Reviews", /\/reviews$/],
    ["Discounts a diver can type", "Promo codes", /\/promos$/],
  ] as const) {
    await box.fill(headline);
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(urlPattern);
    // And the page confirms it, in the word that was typed *and* the one that
    // was clicked: the eyebrow is the nav label, the h1 is the headline.
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: headline })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
  }
});

/**
 * "Add diver" matches every query by construction — it offers to create a
 * person named whatever you typed — so left in the Divers group it outranked
 * real commands: typing "Sign out" proposed creating a diver called "Sign out"
 * above the actual Sign out row, and Enter took it.
 */
test("the command palette keeps Add diver last, under every real match", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });
  // Scoped to the palette: the shop home's own `<select>` controls contribute
  // native `<option>` elements, which carry the same implicit role.
  const options = page.getByRole("dialog").getByRole("option");

  await box.fill("Sign out");
  await expect(options.last()).toHaveAccessibleName("Add diver");
  await expect(options.first()).toHaveAccessibleName("Sign out");

  // A query that matches a real diver puts them above it too, so the first
  // Enter never lands on "create a second Priya".
  await box.fill("Priya");
  await expect(options.first()).toHaveAccessibleName(/Priya Sharma/);
  await expect(options.last()).toHaveAccessibleName("Add diver");
});

/**
 * **Today's boat, not October's.** `trips` is a forward-looking table, so the
 * trips group's old `desc(startsAt)` sort spent all eight of its slots on the
 * furthest-future matches: the departure sailing this afternoon — the single
 * most likely reason anyone opens the palette and types a trip name — was
 * truncated out of the results entirely (issue #772). The shop runs the same
 * charter over and over, so the title alone cannot tell the departures apart;
 * the date on the row is what says which one the ordering picked.
 */
test("the palette's trip results lead with the departure nearest to now", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });
  const options = page.getByRole("dialog").getByRole("option");

  // A title the demo shop reuses across a run of past departures and one that
  // sails today, so this asserts which of them the eight slots go to.
  await box.fill("Molasses & French");
  await expect(options.first()).toHaveAccessibleName("Two-Tank Reef — Molasses & French");

  // Composed from the frozen clock rather than written out, so the spec keeps
  // meaning the same thing when that instant moves — the shop's own zone,
  // because that is the zone the row renders in.
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(e2eNow());
  await expect(options.first()).toContainText(today);
});

test("the divers list filters live as you type, no submit", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByRole("searchbox", { name: "Search divers" });
  // The extended roster is well past one default page, sorted alphabetically —
  // Priya isn't on it unsearched. Confirm the unfiltered roster loaded at all
  // (the first alphabetical name is a stable enough proxy), then exercise the
  // live filter that actually finds her.
  await expect(page.getByRole("cell", { name: "Adaeze Nwosu" })).toBeVisible();

  await search.fill("zzz-no-such-diver");
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  await search.fill("Priya");
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();
});
