import { expect, test } from "./fixtures";

/**
 * Cross-shop tenant isolation on `/shop/[shopSlug]/**`.
 *
 * The bug class this exists to catch is the one the shop layout used to have:
 * the shell resolves its shop from the **URL slug** (`getShopBySlug`) while
 * every staff page below it reads its rows from the **session**
 * (`session.user.shopId`). Nothing reconciled the two, so a staffer signed
 * into shop A who opened `/shop/shop-b/anything` got a page of A's data
 * wrapped in B's chrome — B's name, B's next-departure link, and B's
 * pending-work badge counts (reviews awaiting moderation, and blocked divers,
 * which include medical review). Those counts are another tenant's
 * operational data, and no page-level gate could ever catch them because the
 * layout is what reads them.
 *
 * The invariant now: staff chrome and counts are scoped to the session's own
 * shop, and a cross-tenant visit to a staff route is a 404 rather than a
 * two-shop mixture. The one deliberate exception is the public allowlist
 * (`isPublicShopRoute` — the schedule and the course pages), which anyone may
 * read, including staff of a different shop; that half is guarded here too,
 * because a fix that 404s everything would break every shop's public booking
 * page for anyone who happens to be signed in elsewhere.
 */

// Seeded Blue Mantis facts (src/db/seed.ts) that must not surface to another
// tenant: the shop's own name, and a diver on its roster.
const OTHER_SHOP_NAME = "Blue Mantis Divers";
const OTHER_SHOP_DIVER = "Priya Sharma";

// Every staff surface named in the route map that a second shop's owner could
// plausibly walk to by editing the slug in the address bar.
const STAFF_PATHS = [
  "",
  "/divers",
  "/check-in",
  "/waivers",
  "/orders",
  "/schedule/board",
  "/reviews",
  "/blockers",
  // The highest-value staff surfaces by data sensitivity: team roster and
  // export live under settings, reports aggregate revenue, staffing shows
  // who works when.
  "/settings",
  "/settings/team",
  "/settings/export",
  "/reports",
  "/promos",
  "/staffing",
  "/dive-sites",
];

test("a second shop's owner reaches none of Blue Mantis's staff surfaces", async ({ page }) => {
  // Onboarding, then ~19 sequential navigations. Same aggregate-cost
  // reasoning as booking.spec.ts's chained flows: each step is fast, the sum
  // is past the 15s default.
  test.setTimeout(90_000);

  // Mint the second tenant through the real sign-up flow — it ends with us
  // signed in as that shop's owner, which is exactly the actor this spec is
  // about. The slug is unique per run because an onboarded shop is a real
  // trial shop (`isDemo: false` in src/app/onboard/actions.ts), so unlike a
  // minted demo it survives `/api/test/reset`'s `purgeMintedDemoShops`; the
  // worker's database is in-memory and per-run, so it costs nothing to leave
  // behind. Same approach as onboard.spec.ts.
  const unique = `tenant-iso-${Date.now()}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Tenant Iso E2E");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Rina Vasquez");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));
  // Staff chrome does render — for their *own* shop. Without this the 404s
  // below could just as well mean "this account is not staff anywhere".
  // Scoped to the header: the primary destinations render twice in the DOM
  // (header strip and the phone dock), one visible per breakpoint.
  await expect(page.locator("header").getByRole("navigation", { name: "Primary" })).toBeVisible();

  // The public schedule stays public, for this signed-in outsider as much as
  // for an anonymous visitor. Since the namespace split (ADR
  // 20260803-public-shop-namespace) it lives at /s/<slug>; the legacy staff-
  // namespace URL rides the 308 there, query and all. This is the regression
  // guard that fails first if the tenant check below is ever widened to
  // "any mismatched slug is a 404" — a 404 here would strand real divers.
  const scheduleResponse = await page.goto("/shop/blue-mantis/schedule");
  expect(scheduleResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/s\/blue-mantis$/);
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  // …and they get the *visitor's* chrome on it: the shop's own public header,
  // never Blue Mantis's staff nav or its pending-work counts.
  await expect(page.getByRole("link", { name: OTHER_SHOP_NAME }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Not ready" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Check-in" })).toHaveCount(0);

  // A real Blue Mantis trip id, read off that same public page — the strongest
  // form of the check, since a trip-scoped staff route is handed a genuinely
  // valid id belonging to the other shop and must still refuse.
  const tripHref = await page
    .locator('a[href^="/s/blue-mantis/trips/"]')
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  // The card links straight at the booking form's `#book` anchor, so the id is
  // the last path segment, not the last URL segment.
  const tripId = tripHref?.split("#")[0]?.split("/").at(-1);
  expect(tripId).toMatch(/^[0-9a-f-]{36}$/i);

  for (const suffix of [
    ...STAFF_PATHS,
    `/trips/${tripId}`,
    `/trips/${tripId}/manifest`,
    `/trips/${tripId}/guests`,
  ]) {
    const path = `/shop/blue-mantis${suffix}`;
    await page.goto(path);
    // The rendered refusal, not the HTTP status: `cacheComponents` streams a
    // shell first, so a `notFound()` raised while the dynamic part of the
    // route renders arrives after the 200 is already on the wire. The
    // not-found *page* is what the person actually gets, and it is what a
    // regression here would replace with a two-shop mixture. The second
    // argument to `expect` names the path in the failure message, since every
    // iteration of this loop asserts the same thing.
    await expect(
      page.getByRole("heading", { name: "We couldn’t find that page" }),
      path,
    ).toBeVisible();
    // Nothing of the other tenant leaks onto it: not the shop's identity
    // (which the staff header would have shown), not its pending-work nav, and
    // not a single row of its roster.
    await expect(page.getByText(OTHER_SHOP_NAME), path).toHaveCount(0);
    await expect(page.getByText(OTHER_SHOP_DIVER), path).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" }), path).toHaveCount(0);
  }

  // A hand-supplied x-diveday-path claiming a public route must not soften
  // the refusal. Since the namespace split the staff shell doesn't read the
  // path header at all — the tenant check runs on the session and slug alone —
  // but the probe stays: it is the regression test that would catch any future
  // reader trusting a client-supplied copy of the header.
  const spoofed = await page.request.get("/shop/blue-mantis/divers", {
    headers: { "x-diveday-path": "/shop/blue-mantis/schedule" },
  });
  const spoofedBody = await spoofed.text();
  expect(spoofedBody).toContain("We couldn’t find that page");
  expect(spoofedBody).not.toContain(OTHER_SHOP_DIVER);

  // Their own console is untouched by any of it.
  await page.goto(`/shop/${unique}/divers`);
  await expect(page.getByRole("heading", { level: 1, name: "Divers" })).toBeVisible();
  await expect(page.getByText(OTHER_SHOP_DIVER)).toHaveCount(0);
});
