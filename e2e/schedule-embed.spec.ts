import { expect, signedInAsOwner, test } from "./fixtures";
import { acceptAgeAttestation, e2eNow, openTripInEmbed, threadStatus } from "./helpers";

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

  // **The shopfront stops at the frame** (ADR
  // 20260827-clearwater-surface-language, decision 8). `?embed=1` keeps the
  // list-first window issue #805 made it: no identity band, no next-boat card,
  // and neither shelf — every one of which would spend a third of a 900px
  // frame on something the shop's own page around it already says.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Next boat with space" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Courses" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What divers say" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "All reviews" })).toHaveCount(0);
  // The list itself is still there, and still the whole point.
  await expect(
    page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first(),
  ).toBeVisible();
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

test("a client cannot forge proxy headers to grant framing", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-diveday-embed-request": "1",
    "x-diveday-request-path": "/s/blue-mantis",
  });
  const response = await page.goto("/s/blue-mantis?embed=0");
  expect(response?.status()).toBe(200);
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
});

/**
 * **A diver booking inside the frame stays inside it.** No staff detour: the
 * test used to sign in, put a fresh departure on the board and sign out again
 * just to have a trip past the widget's four-departure window, which cost
 * about half its 15-second budget before the diver's half began and ran it
 * out under load (issue #2312: 14-15s measured on an idle machine). A seeded
 * departure past that window is the same subject, reached the same way.
 */
test("booking through the embed keeps embed mode through the confirmation", async ({ page }) => {
  // **Through the widget's own way out.** The embed shows the next four
  // departures (issue #805), and this course sits past that window.
  await page.goto("/s/blue-mantis?embed=1", { waitUntil: "domcontentloaded" });
  await openTripInEmbed(page, "Discover Scuba — Pool & Reef");
  await expect(page).toHaveURL(/embed=1/);
  await expect(page.getByRole("link", { name: "All trips", exact: true })).toHaveCount(0);

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Embed Diver");
  await page.getByLabel("Email", { exact: true }).fill(`embed-${e2eNow().getTime()}@example.com`);
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();

  await expect(page.getByRole("heading", { name: /You’ve got a seat, Embed/ })).toBeVisible();
  // The redirect after a successful book-now-pay-later booking must have
  // carried embed=1 forward, or the confirmation reloads into full chrome.
  await expect(page).toHaveURL(/embed=1/);
  await expect(page.getByRole("link", { name: "All trips", exact: true })).toHaveCount(0);
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
  await expect(threadStatus(page)).toBeVisible();
});

test("the embed widget carries a discreet Powered-by-DiveDay attribution link with UTM params", async ({
  page,
}) => {
  // Human-discovery footer (task: embed attribution) — small, at the bottom,
  // and still zero JSON-LD (docs ADR 20260726-schedule-embed / the embed
  // canonicalizes to the standalone page, see reviews.spec.ts's parallel
  // assertion on the base case).
  await page.goto("/s/blue-mantis?embed=1");
  const attribution = page.getByRole("link", { name: "Bookings by DiveDay" });
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
  // The attribution link is embed-only: it exists purely for a diver who
  // discovers the widget on a shop's own site. The standalone page carries
  // DiveDay's credit in its own footer, in the same words since visual review
  // 2026-10-24 (B33), so the embed's link is told apart by its campaign
  // parameters, not its name.
  await page.goto("/s/blue-mantis");
  await expect(page.locator('a[href*="utm_source=embed"]')).toHaveCount(0);
  const footerCredit = page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Bookings by DiveDay" });
  await expect(footerCredit).toHaveAttribute("href", "/");
});

// The fleet now runs against a configured non-loopback `APP_HOST`
// (playwright.config.ts `serverEnv`), so `publicAppUrl()` resolves and this
// page renders the branch a real deploy shows: two generated snippets built
// from the shop's own public schedule URL. Previously the fleet could only
// ever reach the "hosting isn't configured" branch, so the snippet strings —
// the entire point of the page — had never been exercised end to end.
test.describe("settings/embed, as owner", () => {
  signedInAsOwner();

  test("settings/embed generates the snippet against the configured public origin", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/embed");
    await expect(page.getByRole("heading", { name: "Website embed" })).toBeVisible();
    await expect(page.getByText(/configured public hosting address/)).toHaveCount(0);

    // The snippet loads DiveDay's script from the *configured* origin rather
    // than the worker's own loopback base URL — a snippet a shop pastes into
    // its website has to survive leaving this box — and names the shop by its
    // public slug, never a /shop/** staff path (ADR
    // 20260803-public-shop-namespace). The crawlable credit link with the
    // shop's campaign params is added by the loader on the host page, and
    // e2e/embed-catalogue.spec.ts asserts it there.
    const snippet = page.getByLabel("Embed code");
    const embedCode = await snippet.inputValue();
    expect(embedCode).toContain('<script async src="https://');
    expect(embedCode).toContain('data-shop="blue-mantis"');
    expect(embedCode).not.toContain("/shop/blue-mantis");

    // The button kind is deliberately the plain schedule URL, not the embed
    // one: it's a link a browser navigates to, never a frame. (The tile is
    // the label; its radio is screen-reader-only.)
    await page
      .locator("label")
      .filter({ hasText: /^Button/ })
      .click();
    const buttonCode = await snippet.inputValue();
    expect(buttonCode).toContain("/s/blue-mantis");
    expect(buttonCode).not.toContain("embed=1");
    expect(buttonCode).toContain("Book a dive");

    await expect(page.getByRole("link", { name: "your public schedule" })).toHaveAttribute(
      "href",
      /^https:\/\/[^/]+\/s\/blue-mantis$/,
    );
  });
});
