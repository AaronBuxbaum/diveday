import { expect, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * The first ten minutes — the golden path a brand-new shop walks from "never
 * heard of DiveDay an hour ago" to "divers can book me", pinned so it can
 * never silently regress.
 *
 * Phase 1 recruiting (docs/product/rollout.md) is the founder pitching real
 * shops with "you'll be bookable before this call ends", and this spec is what
 * keeps that sentence true: it walks the whole path a real owner walks —
 * sign-up, first departure, share link — and **asserts the step budget**, the
 * number of screens the owner must touch before divers can book. Wall-clock
 * time is machine-dependent; screens are not.
 *
 * If a change legitimately needs another screen in this path, raising the
 * budget is a product decision to make out loud in that PR, not a constant to
 * bump in passing.
 */
const SCREEN_BUDGET = 4;

test("a brand-new shop is bookable within the four-screen budget, and is shown the link that proves it", async ({
  page,
}) => {
  const unique = `ten-min-${Date.now()}`;
  const screens: string[] = [];
  const arrive = (label: string) => screens.push(label);

  // ── Screen 1: the sign-up form ────────────────────────────────────────────
  await page.goto("/onboard");
  arrive("onboard");

  // The shop link writes itself from the name — the one "invent something"
  // decision in sign-up is now a suggestion the owner can simply accept.
  await page
    .locator('input[name="shopName"]')
    .filter({ visible: true })
    .pressSequentially("Ten Minute Divers");
  await expect(page.locator('input[name="shopSlug"]').filter({ visible: true })).toHaveValue(
    "ten-minute-divers",
  );
  // This run needs a unique slug; typing one is the same "or edit it" path a
  // shop with an opinion takes, and the suggester must respect it from then on.
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  // Timezone was already detected from the device — no decision to make.
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  // ── Screen 2: Today, which owns "what do I do next" ─────────────────────
  await page.waitForURL(new RegExp(`/shop/${unique}$`));
  arrive("today (the first morning's setup ledger)");
  await expect(page.getByRole("heading", { name: "First morning" })).toBeVisible();
  // Exactly one open step carries the page's one primary (ADR
  // 20260827-first-light, decision 6).
  await expect(page.locator('[data-first-run-primary="true"]')).toHaveCount(1);
  await page.getByRole("link", { name: "Schedule a trip" }).click();

  // ── Screen 3: the board's add panel — four required fields, everything
  // else has a default, is optional, or is behind "More options" (ADR
  // 20260806-one-trip-create-form) ─────────────────────────────────────────
  await page.waitForURL(new RegExp(`/shop/${unique}/schedule/board\\?add=1$`));
  arrive("schedule board (add a departure)");
  const tomorrow = new Date(Date.parse(E2E_FROZEN_CLOCK) + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await page.locator('input[name="title"]').fill("Two-Tank Morning Reef");
  await page.locator('input[name="date"]').fill(tomorrow);
  await page.locator('input[name="startTime"]').fill("08:00");
  await page.locator('input[name="endTime"]').fill("12:30");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  // ── Screen 4: the bookable moment ────────────────────────────────────────
  // The first departure ever is the exact moment the checklist (and the link
  // it carried) leaves the page, so Today must say the milestone out loud and
  // hand over the link worth sharing — not a bare "it's on the board".
  await page.waitForURL(new RegExp(`/shop/${unique}\\?created=`));
  arrive("today (bookable + share link)");
  await expect(
    page.getByRole("heading", {
      name: /“Two-Tank Morning Reef” is on the board — your shop is bookable/,
    }),
  ).toBeVisible();
  await expect(page.getByText(`/s/${unique}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();

  // The budget: every screen the owner had to touch, counted honestly.
  expect(screens, `owner screens walked: ${screens.join(" → ")}`).toHaveLength(SCREEN_BUDGET);

  // ── The proof, as a diver sees it (past the finish line, not budgeted) ──
  await page.getByRole("link", { name: "See it the way your divers will" }).click();
  await page.waitForURL(new RegExp(`/s/${unique}$`));
  await expect(page.getByText("Two-Tank Morning Reef").first()).toBeVisible();
  await expect(page.getByText("12 spots left").first()).toBeVisible();

  // All the way to the seat: the trip page offers a real booking form.
  await page.locator(`a[href*="/s/${unique}/trips/"]`).first().click();
  await page.waitForURL(new RegExp(`/s/${unique}/trips/`));
  await expect(
    page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }),
  ).toBeVisible();
});

test("the second trip does not repeat the bookable moment", async ({ page }) => {
  const unique = `ten-min-again-${Date.now()}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Second Trip E2E");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await page.waitForURL(new RegExp(`/shop/${unique}$`));

  const tomorrow = new Date(Date.parse(E2E_FROZEN_CLOCK) + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const schedule = async (title: string, start: string, end: string) => {
    await page.goto(`/shop/${unique}/schedule/board?add=1`);
    await page.locator('input[name="title"]').fill(title);
    await page.locator('input[name="date"]').fill(tomorrow);
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.getByRole("button", { name: "Put it on the board" }).click();
  };

  // The first departure ever is the one time creating a trip leaves the board:
  // it is the moment the shop became bookable, and the share card that says so
  // lives on Today (ADR 20260806-one-trip-create-form).
  await schedule("First Ever", "08:00", "12:30");
  await page.waitForURL(new RegExp(`/shop/${unique}\\?created=`));
  await expect(page.getByRole("heading", { name: /your shop is bookable/ })).toBeVisible();

  // A shop's second trip is routine, not a milestone — it stays on the board it
  // was built on, named in the notice, and repeating the celebration would
  // teach owners to ignore it.
  await schedule("Afternoon Drift", "14:00", "17:00");
  await page.waitForURL(new RegExp(`/shop/${unique}/schedule/board\\?builder=added`));
  await expect(page.getByText("“Afternoon Drift” is on the board.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /your shop is bookable/ })).toHaveCount(0);
});

/**
 * **A departure *today* is not an empty shop.**
 *
 * `getTodayWork` hands back `nextDeparture` only when nothing sails today, so
 * for a whole year "no next departure" was read as "this shop has never had
 * one" — and a shop whose boat left this morning got the new-shop checklist
 * telling it to schedule its first trip, above the board listing the trip it
 * had just scheduled. Worse, the checklist suppresses the queue's all-clear
 * panel (#740), so the one screen saying the roster was in order vanished on
 * the exact morning it mattered. The two tests above never caught it because
 * both schedule for *tomorrow*, which is the case that always worked.
 */
test("a shop with a departure today is not treated as a shop with no departures", async ({
  page,
}) => {
  const unique = `ten-min-today-${Date.now()}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Sails Today E2E");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await page.waitForURL(new RegExp(`/shop/${unique}$`));
  await expect(page.getByRole("heading", { name: "First morning" })).toBeVisible();

  // Today, late enough in the day that it has not sailed yet under the frozen
  // clock — the ordinary case of a shop opening its own home page mid-morning.
  const today = E2E_FROZEN_CLOCK.slice(0, 10);
  await page.goto(`/shop/${unique}/schedule/board?add=1`);
  await page.locator('input[name="title"]').fill("Afternoon Two-Tank");
  await page.locator('input[name="date"]').fill(today);
  await page.locator('input[name="startTime"]').fill("16:00");
  await page.locator('input[name="endTime"]').fill("19:30");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await page.goto(`/shop/${unique}`);
  await expect(page.getByText("Afternoon Two-Tank").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "First morning" })).toHaveCount(0);

  // **And the work the setup ledger was suppressing is back, carrying the one
  // question it did not get answered before it left.**
  //
  // This shop is the exact case issue #835 is about: it put a trip on the
  // board without opening the Units row, so the ledger that was asking is gone
  // and the derived currency has never been confirmed. The row picks the
  // question up rather than letting it vanish — which is why this asserts real
  // work rather than "Nothing is waiting on you", the empty state it used to
  // reach here. It hangs off no boat, so it files under the desk group, in the
  // open (ADR 20260827-clearwater-surface-language, decision 4).
  await expect(page.getByText("At the desk")).toBeVisible();
  await expect(page.getByText(/currency and depth unit/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open units/ })).toBeVisible();
});
