import sharp from "sharp";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { signOut } from "./helpers";

// The recap page (`/recap/[token]`) is a public, signed-token diver surface, the
// same shape as the readiness page: it must fail closed on a bad or forged
// token and reveal nothing. The happy-path rendering is covered by the
// getRecapPageData integration tests (src/db/recap.test.ts); here we prove the
// route is wired and the fail-closed notice shows.
test("a tampered recap token reveals nothing", async ({ page }) => {
  await page.goto("/recap/not-a-real-token");
  await expect(page.getByRole("heading", { name: /recap link isn.t available/ })).toBeVisible();
});

test("an oversize recap photo is rejected client-side before it ever reaches the server (CR-011)", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();

  // Assert stylized recap map is rendered (delight feature)
  await expect(page.getByLabel("Stylized recap navigation map of your dive sites")).toBeVisible();

  const photoInput = page.locator('input[name="photo"]').filter({ visible: true });
  await photoInput.setInputFiles({
    name: "recap.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(6 * 1024 * 1024), // over the 5 MB recap-photo limit
  });
  await expect(page.getByRole("alert").filter({ hasText: "over 5 MB" })).toBeVisible();
  // Rejected client-side: the picker itself is cleared, not just annotated —
  // a submit right after cannot silently carry the oversize file.
  await expect(photoInput).toHaveValue("");
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("the external review ask only appears once, right after a strong on-page rating (task 57)", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings");
    await page
      .getByRole("textbox", { name: "Review link" })
      .fill("https://g.page/r/blue-mantis/review");
    await page.getByRole("button", { name: "Save review link" }).click();
    await expect(page.getByText("Review link saved.")).toBeVisible();
    await signOut(page);

    // A review link is configured, but nothing was just submitted — no second
    // ask stacked underneath the on-page form.
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
    await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Leave a public review" })).toHaveCount(0);

    // A 3-star rating isn't "strong" — still no merged ask.
    await page.getByRole("radio", { name: "3 out of 5 stars" }).check();
    await page.getByRole("button", { name: "Leave my review" }).click();
    await expect(page.getByText("Thanks — your rating is up.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Leave a public review" })).toHaveCount(0);

    // A 5-star rating earns the one merged ask, folded into the success state.
    await page.getByRole("radio", { name: "5 out of 5 stars" }).check();
    await page.getByRole("button", { name: "Leave my review" }).click();
    await expect(page.getByText("Thanks — your rating is up.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Share it on Google too" })).toBeVisible();
    const reviewLink = page.getByRole("link", { name: "Leave a public review" });
    await expect(reviewLink).toBeVisible();
    await expect(reviewLink).toHaveAttribute("href", "https://g.page/r/blue-mantis/review");
    await expect(reviewLink).toHaveAttribute("target", "_blank");

    // Reloading the page (nothing "just submitted" on this request) drops the
    // ask again — it is a one-time follow-up, not a durable section.
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
    await expect(page.getByRole("link", { name: "Leave a public review" })).toHaveCount(0);
  });
});

test("the recap link itself has a share affordance, and its unfurl card reveals nothing for a bad token (task 59)", async ({
  page,
  request,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("button", { name: /Share this recap|Link copied/ })).toBeVisible();

  // A generic-content unfurl card renders even for a token that verifies to
  // nothing — no distinguishing a dead link from a real one at the image
  // layer either.
  const res = await request.get("/recap/not-a-real-token/opengraph-image");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("image/png");
});

test("comment moderation is disclosed before submitting, not discovered only after (task 54)", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(
    page.getByText("Ratings post right away; the shop reads written words first."),
  ).toBeVisible();
});

test("a booking cancelled after the recap page loaded gets an honest notice, not a lie about a bad rating or a bad file (task 56)", async ({
  page,
  staffStorageState,
}) => {
  // The diver's page loads while the booking is still active — the review
  // and photo forms render normally.
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();

  // Staff cancel the booking from a second, separately-authenticated
  // context — the diver's already-open tab (and its bound server actions)
  // has no idea yet, the exact race the code comments call out.
  const staffContext = await page
    .context()
    .browser()
    ?.newContext({ storageState: await staffStorageState("owner") });
  if (!staffContext) throw new Error("could not open a second browser context");
  const staffPage = makeActivitySafe(await staffContext.newPage());
  // The seed schedules several other trips under this same title (task 56's
  // fixture isn't the only "Two-Tank Reef — Molasses & French" departure),
  // so finding it by title on the schedule board is ambiguous. Priya
  // Sharma's own diver record links straight to her one still-scheduled
  // trip — unambiguous by construction.
  await staffPage.goto("/shop/blue-mantis/divers");
  await staffPage.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await staffPage
    .getByRole("row", { name: /Priya Sharma/ })
    .getByText("Priya Sharma")
    .click();
  await staffPage.getByRole("region", { name: "Upcoming trips" }).getByRole("link").first().click();
  await staffPage.waitForURL(/\/trips\//);
  const tripId = staffPage.url().match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error("could not resolve the reef trip id from the URL");
  // The roster lives on the Guests tab now, not the trip overview.
  await staffPage.goto(`/shop/blue-mantis/trips/${tripId}/guests`);
  const diverRow = staffPage.locator("li").filter({ hasText: "Priya Sharma" });
  // Two-tap InlineConfirm, not a native dialog: the first tap only arms it.
  await diverRow.getByRole("button", { name: "Remove booking" }).click();
  await diverRow.getByRole("button", { name: "Yes, remove booking" }).click();
  await expect(staffPage.getByRole("status")).toContainText("Booking cancelled");
  await staffContext.close();

  // Back on the diver's still-open page: submitting the rating now hits a
  // booking that never sailed. `getRecapPageData` fails the whole page
  // closed the same way it does for a bad token — but this branch still
  // says something true ("didn't sail"), not "pick a rating and try again"
  // forever, and not a made-up file-format complaint either.
  await page.getByRole("radio", { name: "5 out of 5 stars" }).check();
  await page.getByRole("button", { name: "Leave my review" }).click();
  await expect(
    page.getByText("This booking didn’t sail, so there’s no recap to rate or add a photo to."),
  ).toBeVisible();
});

test("a whole pick of photos submits in one request, not one page reload per photo (task 55)", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  const photoInput = page.locator('input[name="photo"]').filter({ visible: true });
  await expect(photoInput).toHaveAttribute("multiple", "");

  // Real, decodable JPEGs — the server validates content, not just the
  // declared mime type (certifications.spec.ts's CR-012), so a fake/zero
  // buffer never reaches the "no blob storage configured" branch this test
  // means to exercise; it dies earlier on a format rejection instead.
  const jpeg = async (rgb: { r: number; g: number; b: number }) =>
    sharp({ create: { width: 20, height: 15, channels: 3, background: rgb } })
      .jpeg()
      .toBuffer();
  await photoInput.setInputFiles([
    { name: "one.jpg", mimeType: "image/jpeg", buffer: await jpeg({ r: 20, g: 90, b: 160 }) },
    { name: "two.jpg", mimeType: "image/jpeg", buffer: await jpeg({ r: 160, g: 90, b: 20 }) },
  ]);
  await page.getByRole("button", { name: "Add to my recap" }).click();
  // The e2e fleet has no blob storage configured (see certifications.spec.ts's
  // CR-012 test) — even a real photo lands here rather than "added". The
  // point proven is that the whole multi-file batch round-trips through one
  // submit to one notice, not a per-file page reload.
  await expect(page.getByText("Photo uploads aren’t set up for this shop yet")).toBeVisible();
});
