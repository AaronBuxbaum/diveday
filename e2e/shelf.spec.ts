import { expect, test } from "./fixtures";
import { e2eNow, signInAsOwner } from "./helpers";

/**
 * **The diver's shelf** (slice 20t of ADR 20260908-one-hand): the standing door
 * onto a diver's own file at one shop, the greeting it leaves on that shop's
 * storefront, and the way to take that greeting off a phone.
 *
 * The three properties worth a browser are the ones no unit test can see: the
 * cookie is set by opening the shelf and read by the storefront, the storefront
 * without it is the page it has always been, and "Forget this phone" takes the
 * greeting away and leaves the link working.
 *
 * The link is minted through `/api/test/seed-shelf-token` — the same
 * `person_shelf_tokens` row the thread's door and the record's "Send the link"
 * write. Walking either of those would mean a departure that has come home or a
 * mail provider this fleet does not have, and neither is what these cases are
 * about.
 */

/** Book a seat so there is a diver, a booking, and a thread to come back to. */
async function bookASeat(page: import("@playwright/test").Page, email: string) {
  await page.goto("/s/blue-mantis");
  await page.getByRole("link", { name: /Reef/ }).first().click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Ravi Menon");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: /^Book/ }).click();
  await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
}

async function openShelf(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const seeded = await request.post("/api/test/seed-shelf-token", {
    data: { shopSlug: "blue-mantis", email },
  });
  expect(seeded.ok()).toBe(true);
  const { href } = (await seeded.json()) as { href: string };
  await visitShelf(page, href);
  return href;
}

/**
 * Open the shelf and wait until the phone has been remembered. The open is
 * counted by a server action fired from a client effect after the page mounts
 * (`RememberShelf`), not by the GET, so a test that navigates away the moment
 * the heading paints can leave before the count and the cookie are written.
 */
async function visitShelf(page: import("@playwright/test").Page, href: string) {
  const remembered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.startsWith("/shelf/"),
  );
  await page.goto(href);
  await page.getByRole("heading", { name: "Your shelf" }).waitFor();
  await remembered;
}

test("a diver opens their shelf, is greeted on the storefront, and forgets the phone", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const email = `ravi-shelf-${e2eNow().getTime()}@example.com`;
  await bookASeat(page, email);

  const shelfHref = await openShelf(page, request, email);

  // The file, and the one line about what is never on it.
  await expect(page.getByRole("heading", { name: "On file" })).toBeVisible();
  await expect(page.getByText("Never here: your medical answers.")).toBeVisible();
  // The seat they hold is the reason to come back, and its door is the thread.
  await expect(page.getByRole("button", { name: "Open your thread" })).toBeVisible();

  // The sizes are the diver's to correct, and they write the row the rental
  // ticket reads.
  await page.getByLabel("Wetsuit").fill("3mm L");
  await page.getByRole("button", { name: "Save sizes" }).click();
  await page.waitForURL(/saved=sizes/);
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Wetsuit")).toHaveValue("3mm L");

  // **The greeting.** Opening the shelf set the cookie; the storefront reads it
  // and greets by first name with which visit the next one is.
  await page.goto("/s/blue-mantis");
  await expect(page.getByText(/Welcome back, Ravi\./)).toBeVisible();
  const yours = page.getByRole("region", { name: "Yours" });
  await expect(yours).toBeVisible();
  await expect(yours.getByRole("button", { name: "Your shelf" })).toBeVisible();

  // **Forget this phone** clears the greeting and nothing else.
  await page.goto(shelfHref);
  await page.getByRole("button", { name: "Forget this phone" }).click();
  await page.waitForURL(/forgot=1/);
  await expect(page.getByText("Forgotten.")).toBeVisible();

  await page.goto("/s/blue-mantis");
  await expect(page.getByText(/Welcome back, Ravi\./)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Yours" })).toHaveCount(0);

  // The link itself still works — forgetting a phone is not closing a file.
  await page.goto(shelfHref);
  await expect(page.getByRole("heading", { name: "Your shelf" })).toBeVisible();
});

test("the storefront is unchanged for a visitor with no shelf cookie", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("region", { name: "Yours" })).toHaveCount(0);
  await expect(page.getByText(/Welcome back,/)).toHaveCount(0);
  // The shipped page is still there behind the absence.
  await expect(page.getByRole("heading", { name: "Blue Mantis Divers" })).toBeVisible();
});

test("the diver record's file gains one row saying how the link is doing", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();

  const shelf = page.getByRole("region", { name: "Shelf" });
  await expect(shelf.getByText("Not sent")).toBeVisible();

  // Mint and open a link, exactly as the two shipped doors do.
  const seeded = await request.post("/api/test/seed-shelf-token", {
    data: { shopSlug: "blue-mantis", email: "priya.sharma@example.com" },
  });
  expect(seeded.ok()).toBe(true);
  const { href } = (await seeded.json()) as { href: string };
  await visitShelf(page, href);

  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  const opened = page.getByRole("region", { name: "Shelf" });
  await expect(opened.getByText("1 open")).toBeVisible();
  await opened.getByText("Shelf", { exact: true }).click();
  await expect(opened.getByText("1 phone holds it")).toBeVisible();
  await expect(opened.getByRole("button", { name: "Send the link" })).toBeVisible();
});

test("a dead shelf link says so and offers no self-serve rescue", async ({ page }) => {
  await page.goto("/shelf/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This link has run out" })).toBeVisible();
  await expect(page.getByText("Ask your dive shop for a fresh one.")).toBeVisible();
});
