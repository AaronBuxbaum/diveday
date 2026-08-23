import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, signOut } from "./helpers";

test.describe("staff-prepared trip", () => {
  signedInAsOwner();

  test("a booked diver's readiness page lets them act, answers its questions, and releases the seat", async ({
    page,
  }) => {
    // Unique title for this spec's own trip; the e2eNow() suffix keeps every
    // test-side timestamp anchored to the frozen clock (helpers.ts).
    // Isolation from other specs — including the visual suite — comes from
    // the per-test demo reset in fixtures.ts.
    const title = `Readiness Run ${e2eNow().getTime()}`;

    // Staff puts a trip on the board.
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:00",
      capacity: 6,
    });
    await signOut(page);

    // A visitor books it.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    // Scoped to the trip list itself, the page's one stable anchor for
    // departures — day rules and other lists on the page never carry a
    // trip's title.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
    // Same frozen-clock suffix convention as the trip title above.
    await page.getByLabel("Email", { exact: true }).fill(`nemo-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();

    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
    // Gear is a checklist row like the rest now, not a section under its own
    // heading further down the page.
    await expect(page.getByRole("heading", { name: "Gear and setup" })).toBeVisible();
    // The emergency contact is the waiver's question, and only the waiver's
    // (issue 627). Asking twice for one fact is how a diver ends up correcting
    // the copy the crew is not reading.
    await expect(page.getByRole("heading", { name: "Emergency contact" })).toHaveCount(0);

    // The diver's own words to the crew: its own category, saved on its own, so
    // it cannot blank the sizes beside it (issue 627).
    await page.getByLabel("Anything else the crew should know?").fill("Titanium hip, I run heavy.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved — the crew will see that" }),
    ).toBeVisible();
    // Read back off the control itself, which is what the diver comes back to.
    await expect(page.getByLabel("Anything else the crew should know?")).toHaveValue(
      "Titanium hip, I run heavy.",
    );

    // Where the diver is actually going, and how to reach the people who will
    // be there. This page used to close on a one-line "Questions? Reach out to
    // {shop}" that named the shop and left the address to be hunted for.
    const shopCard = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Your dive shop" }) });
    await expect(shopCard.getByText("Blue Mantis Divers")).toBeVisible();
    await expect(shopCard.getByText("100 Ocean Drive")).toBeVisible();
    await expect(shopCard.getByText("Key Largo, FL 33037")).toBeVisible();
    await expect(shopCard.getByRole("link", { name: "hello@demo.invalid" })).toHaveAttribute(
      "href",
      "mailto:hello@demo.invalid",
    );
    // The map is a plain roadmap embed built from the shop's own address —
    // never a guessed location. The e2e context aborts maps.google.com
    // requests (fixtures.ts), so this asserts the frame, not its contents.
    await expect(shopCard.locator('iframe[title="Map of Blue Mantis Divers"]')).toHaveAttribute(
      "src",
      /100%20Ocean%20Drive/,
    );

    // The question no form asked until 2026-08-21 (ADR
    // 20260821-currency-is-what-catches-people). It gates nothing, so what is
    // worth proving is that the answer round-trips and the row settles.
    await page
      .getByLabel("When did you last dive?")
      .selectOption({ label: "More than five years ago" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Thanks — the crew will see that" }),
    ).toBeVisible();
    await expect(page.getByText("More than five years ago")).toBeVisible();

    // The diver releases their own seat (ADR
    // 20260821-the-diver-may-release-their-own-seat). Cancelling revokes this
    // very token, so the confirmation the diver lands on is served through the
    // relaxed-revocation branch — which is the half of this that a unit test
    // cannot reach. Asserted last because it ends the booking; every check
    // above needs a live seat.
    await page.getByRole("button", { name: "Cancel my spot" }).click();
    await page.getByRole("button", { name: "Yes, cancel my spot" }).click();
    await expect(page.getByRole("heading", { name: "This booking was cancelled" })).toBeVisible();

    // **And the same dead token, opened again later, names the shop.**
    //
    // `?cancelled=1` is what the redirect above carries; a diver coming back to
    // the bookmarked URL, or opening the link out of an old email, arrives
    // without it — and used to get four words telling them to ask a shop the
    // page would not name. `/ready` is the link in the 24-hour reminder, so
    // that is the ordinary way to reach it (issue #801).
    const readyUrl = new URL(page.url());
    readyUrl.search = "";
    await page.goto(readyUrl.toString());
    await expect(
      page.getByRole("heading", { name: /readiness link isn.t available/ }),
    ).toBeVisible();
    await expect(page.getByText(/Blue Mantis Divers/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Blue Mantis Divers" })).toHaveAttribute(
      "href",
      "mailto:hello@demo.invalid",
    );

    // And the seat is genuinely back on the boat, not merely hidden from the
    // diver: the six-seat departure reads as six again, not five.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("list", { name: "Upcoming trips" }).locator("li").filter({ hasText: title }),
    ).toContainText("6 spots left");
  });
});

test("a tampered readiness token reveals nothing", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
});

/**
 * The readiness page carries the day itself, not just what is left to do.
 *
 * The link a shop actually sends the night before is this one, and it used to
 * answer "what's outstanding?" and nothing else — no packing list, and a strip
 * of site names where the public trip page had a briefing per tank. A diver had
 * to go and find the trip page for the two things they read on the drive down
 * (2026-08-06 review). The checklist is still the page's job; this rides below
 * it, and the thin site peek it duplicated is gone.
 */
test("a booked diver's readiness page carries the packing list and the dive briefings", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // A seeded two-tank charter, so there are real dives at real sites to brief.
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Ada Marlowe");
  await page.getByLabel("Email", { exact: true }).fill(`ada-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  // What to put in the bag, and what each tank actually dives.
  await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();
  // Including the suit. This page renders no conditions card — it is rental
  // fit and paperwork — so if the packing list stays quiet, the page a diver
  // reads the morning they sail says nothing about the water they are getting
  // into. The booking page states it under the reading instead; here it has
  // nowhere else to go (src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx).
  await expect(page.getByText(/most divers are comfortable in a 3 mm/i)).toBeVisible();
  await expect(page.getByText("Dive briefings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your two-tank plan" })).toBeVisible();
  await expect(page.getByText("Molasses Reef").first()).toBeVisible();

  // And the checklist is still the page's own job, above all of it.
  await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
});
