import { expect, test } from "./fixtures";

/**
 * Leo (persona 15) — self-serve email unsubscribe, the general counterpart to
 * `last-minute-fill.spec.ts`'s last-minute-list unsubscribe: a person-level
 * opt-out covering `waitlist_invite` and `trip_recap`. The public last-minute
 * list form is reused only to create a real `people` row with a known email
 * (via `findOrCreatePerson`) — this test isn't exercising the last-minute
 * list itself, just the cheapest public path to a person who can then be
 * opted out of courtesy email.
 *
 * `/api/test/seed-courtesy-email-unsubscribe-token` mints a real
 * `person_courtesy_email_unsubscribe_tokens` row (test-only, gated
 * identically to `/api/test/reset`) so this drives the actual
 * `/unsubscribe/[token]` page and server action, since the real send flow
 * can't reach a live email in e2e and the token is otherwise only ever
 * readable from inside a `waitlist_invite`/`trip_recap` email and hashed at
 * rest.
 */
test("a diver can self-serve unsubscribe from courtesy email (wait-list openings, recaps)", async ({
  page,
  request,
}) => {
  await page.goto("/s/blue-mantis");
  await page.getByLabel("Name").fill("Priya Nair");
  await page.getByLabel("Email").fill("priya.courtesy.e2e@example.com");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  const seeded = await request.post("/api/test/seed-courtesy-email-unsubscribe-token", {
    data: { shopSlug: "blue-mantis", email: "priya.courtesy.e2e@example.com" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "Stop these emails?" })).toBeVisible();
  await expect(page.getByText("Blue Mantis Divers")).toBeVisible();
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();

  // Revisiting the same link is idempotent, not a dead link.
  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
});
