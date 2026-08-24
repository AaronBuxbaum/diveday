import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, openTripInEmbed, signOut } from "./helpers";

/**
 * The embed widget (docs ADR 20260726-schedule-embed): a shop pastes the
 * schedule into its own website, so the two things that must hold are (1) the
 * embed route actually renders compact and framable, and (2) nothing else on
 * the site became framable as a side effect of adding that exception.
 */
test("the schedule embed renders without page chrome and allows framing", async ({ page }) => {
  const response = await page.goto("/s/blue-mantis?embed=1");
  expect(response?.headers()["x-frame-options"]).toBeUndefined();
  // The exception is `frame-ancestors` alone: an embedded page keeps the rest
  // of the policy, which used to be nothing at all (issue #718).
  expect(response?.headers()["content-security-policy"]).not.toContain("frame-ancestors");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).not.toBeVisible();
});

test("a non-embed page still denies framing", async ({ page }) => {
  const response = await page.goto("/s/blue-mantis");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("a repeated embed param can't smuggle framing past what the page actually renders", async ({
  page,
}) => {
  // searchParams.get() would silently take just the first "1" here while the
  // page's own searchParams prop sees the whole repeated param as an array
  // (never "1") and renders full chrome — the proxy must deny framing in
  // lockstep, not grant the exception on a value the page itself refused.
  const response = await page.goto("/s/blue-mantis?embed=1&embed=0");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("embedded pages stay chrome-free even for a signed-in staff member", async ({ page }) => {
    // A shop owner might click their own embed link while signed in — the
    // iframe on their external site must never expose the staff nav, demo
    // banner, or offline-manifest sync regardless of who's viewing it.
    await page.goto("/s/blue-mantis?embed=1");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Today" })).not.toBeVisible();
  });

  test("booking through the embed keeps embed mode through the confirmation", async ({ page }) => {
    const title = `Embed Booking Check ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/schedule/board?add=full");
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(6));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:00");
    await page.getByLabel("Seats").fill("6");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await signOut(page);

    // **Through the widget's own way out.** The embed shows the next four
    // departures (issue #805), and this trip is six days out — past the window
    // on a seeded shop that runs a boat a day.
    await page.goto("/s/blue-mantis?embed=1", { waitUntil: "domcontentloaded" });
    await openTripInEmbed(page, title);
    await expect(page).toHaveURL(/embed=1/);
    await expect(page.getByRole("link", { name: "← All trips" })).toHaveCount(0);

    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Embed Diver");
    await page.getByLabel("Email", { exact: true }).fill(`embed-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();

    await expect(page.getByRole("heading", { name: /You’re on the boat, Embed/ })).toBeVisible();
    // The redirect after a successful book-now-pay-later booking must have
    // carried embed=1 forward, or the confirmation reloads into full chrome.
    await expect(page).toHaveURL(/embed=1/);
    await expect(page.getByRole("link", { name: "← All trips" })).toHaveCount(0);
    const backLink = page.getByRole("link", { name: "Back to the schedule" });
    await expect(backLink).toHaveAttribute("href", /embed=1/);

    // The one door out of the frame, followed for real. It points at a *route*
    // rather than a `/ready/<token>` minted while this page rendered: a
    // readiness token is stored hashed, so the page cannot read an existing one
    // back, and minting per render wrote a row per reload and eventually
    // retired the readiness link `bookSpot` had already emailed. The route
    // trades this booking's confirm token for the capability at tap time.
    const readinessLink = page.getByRole("link", { name: /readiness page/ });
    await expect(readinessLink).toHaveAttribute("href", /\/ready\?booking=/);
    await readinessLink.click();
    // Landed on a real capability page — the token in the path is the one the
    // route just issued, and it opens the readiness page rather than the
    // "this link isn't available" notice a dead capability would render.
    await expect(page).toHaveURL(/\/ready\/[^/?]+$/);
    await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
  });
});

test("the embed widget carries a discreet Powered-by-DiveDay attribution link with UTM params", async ({
  page,
}) => {
  // Human-discovery footer (task: embed attribution) — small, at the bottom,
  // and still zero JSON-LD (docs ADR 20260726-schedule-embed / the embed
  // canonicalizes to the standalone page, see reviews.spec.ts's parallel
  // assertion on the base case).
  await page.goto("/s/blue-mantis?embed=1");
  const attribution = page.getByRole("link", { name: "Powered by DiveDay" });
  await expect(attribution).toBeVisible();
  const href = await attribution.getAttribute("href");
  expect(href).toContain("utm_source=embed");
  expect(href).toContain("utm_medium=widget");
  expect(href).toContain("utm_campaign=blue-mantis");
  // Intentionally not filtered by visibility: <script> elements never have a
  // layout box, so `.filter({ visible: true })` would always yield 0 matches
  // regardless of whether a JSON-LD script is actually present, defeating
  // this assertion. Also reached via a fresh `page.goto` above, not a
  // client-side navigation, so there's no prior Activity tree to leak here.
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});

test("the non-embed schedule page carries no Powered-by-DiveDay attribution link", async ({
  page,
}) => {
  // The footer is embed-only — the standalone page already carries DiveDay
  // branding via its own chrome, and this link exists purely for a diver who
  // discovers the widget on a shop's own site.
  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("link", { name: "Powered by DiveDay" })).toHaveCount(0);
});

// The fleet now runs against a configured non-loopback `APP_HOST`
// (playwright.config.ts `serverEnv`), so `publicAppUrl()` resolves and this
// page renders the branch a real deploy shows: two generated snippets built
// from the shop's own public schedule URL. Previously the fleet could only
// ever reach the "hosting isn't configured" branch, so the snippet strings —
// the entire point of the page — had never been exercised end to end.
test.describe("settings/embed, as owner", () => {
  signedInAsOwner();

  test("settings/embed generates both snippets against the configured public origin", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/embed");
    await expect(page.getByRole("heading", { name: "Website embed" })).toBeVisible();
    await expect(page.getByText(/configured public hosting address/)).toHaveCount(0);

    // Both snippets target the *public* namespace for this shop, never a
    // /shop/** staff path (ADR 20260803-public-shop-namespace), and the origin
    // is the configured one rather than the worker's own loopback base URL —
    // a snippet a shop pastes into its website has to survive leaving this box.
    const embedCode = await page.getByLabel("Embed code").inputValue();
    expect(embedCode).toContain('<iframe src="https://');
    expect(embedCode).toContain("/s/blue-mantis?embed=1");
    expect(embedCode).not.toContain("/shop/blue-mantis");
    // The crawlable backlink lives outside the iframe, carrying the shop's
    // campaign params — the same attribution the widget itself renders.
    expect(embedCode).toContain("utm_source=embed");
    expect(embedCode).toContain("utm_campaign=blue-mantis");

    // The button snippet is deliberately the plain schedule URL, not the embed
    // one: it's a link a browser navigates to, never a frame.
    const buttonCode = await page.getByLabel("Button code").inputValue();
    expect(buttonCode).toContain("/s/blue-mantis");
    expect(buttonCode).not.toContain("embed=1");
    expect(buttonCode).toContain("Book a dive");

    await expect(page.getByRole("link", { name: "your public schedule" })).toHaveAttribute(
      "href",
      /^https:\/\/[^/]+\/s\/blue-mantis$/,
    );
  });
});

/**
 * The diver surfaces moved out of `/shop` into `/s` (ADR
 * 20260803-public-shop-namespace). Everything printed on a counter, mailed to
 * a diver, or pasted into a shop's own website still points at the old URLs
 * and always will, so the permanent redirects are load-bearing product
 * behaviour — including for an iframe, which has to survive the hop *and*
 * still be allowed to frame the page it lands on.
 */
test.describe("the old /shop public URLs", () => {
  test("308 to the new public namespace, query string intact", async ({ request }) => {
    const schedule = await request.get("/shop/blue-mantis/schedule?month=2026-09", {
      maxRedirects: 0,
    });
    expect(schedule.status()).toBe(308);
    expect(schedule.headers().location).toBe("/s/blue-mantis?month=2026-09");

    const embed = await request.get("/shop/blue-mantis/schedule?embed=1", { maxRedirects: 0 });
    expect(embed.status()).toBe(308);
    expect(embed.headers().location).toBe("/s/blue-mantis?embed=1");

    const course = await request.get("/shop/blue-mantis/courses/open-water-diver", {
      maxRedirects: 0,
    });
    expect(course.status()).toBe(308);
    expect(course.headers().location).toBe("/s/blue-mantis/courses/open-water-diver");
  });

  test("never swallow the staff routes that share their path space", async ({ request }) => {
    for (const path of [
      "/shop/blue-mantis/schedule/board",
      "/shop/blue-mantis/courses",
      "/shop/blue-mantis/courses/open-water-diver/edit",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      // Signed out, so each is Auth.js's own sign-in redirect (`pages.signIn`
      // in src/lib/auth.config.ts) — never the 308 into the public namespace,
      // and not a 500 or a served page either, which `not.toBe(308)` alone
      // would have waved through.
      expect(response.status(), `${path} must bounce to sign-in`).toBeGreaterThanOrEqual(302);
      expect(response.status()).toBeLessThanOrEqual(307);
      expect(response.headers().location).toContain("/sign-in");
    }
  });

  test("an iframe pointed at the old embed URL still renders framable", async ({ page }) => {
    // The whole point of a permanent redirect here: a shop that pasted the
    // snippet a year ago never edits it again. Follow the hop for real and
    // check the *landing* response carries the framing exception.
    const response = await page.goto("/shop/blue-mantis/schedule?embed=1");
    expect(new URL(page.url()).pathname).toBe("/s/blue-mantis");
    expect(new URL(page.url()).search).toBe("?embed=1");
    expect(response?.headers()["x-frame-options"]).toBeUndefined();
    // As above: the exception is `frame-ancestors` alone (issue #718).
    expect(response?.headers()["content-security-policy"]).not.toContain("frame-ancestors");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link")
      .first()
      .waitFor();
  });

  test("an old trip link lands on the diver's booking page", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    const tripHref = await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link")
      .first()
      .getAttribute("href");
    const tripId = tripHref?.split("/").at(-1);
    expect(tripId).toBeTruthy();

    await page.goto(`/shop/blue-mantis/schedule/${tripId}`);
    expect(new URL(page.url()).pathname).toBe(`/s/blue-mantis/trips/${tripId}`);
    await expect(page.getByRole("link", { name: "← All trips" })).toBeVisible();
  });
});
