import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

/**
 * **A staffer reads what a diver wrote and answers it** (ADR
 * 20260907-two-way-inbox).
 *
 * The seed puts four messages in blue-mantis's inbox (`src/db/seed-inbox.ts`):
 * two unanswered, one already answered with the shop's reply beside it, and
 * one from an address nobody on the roster holds. So this walks the surface
 * the way a shop does — the worklist, the record behind a row, the
 * conversation, the composer — rather than seeding its own.
 *
 * **What it cannot assert is a delivered email.** The fleet blanks every
 * provider credential (`playwright.config.ts`), so SES is
 * `disabledNotificationProvider` here and every send comes back
 * `not_configured`. That is the honest end of this flow in this environment:
 * the reply is *recorded* on the record, the thread says it did not reach
 * them, and the message it answers stays unanswered — which is exactly what
 * `sendStaffReply` promises for a send that did not go. The sent path, with
 * its answered stamp, is pinned against an injected provider in
 * `src/db/staff-reply.test.ts`.
 */
test("a staffer reads the inbox, opens the record, and answers the diver", async ({ page }) => {
  // Three surfaces and a send in one flow — the worklist, the record behind a
  // row, and a server action that composes a message and asks a provider about
  // it. The suite's default timeout is sized for a single page's flow, and
  // this one measured past it on a loaded machine (`date-requests.spec.ts`
  // widens its own for the same reason).
  test.setTimeout(45_000);

  await page.goto("/shop/blue-mantis/inbox");
  await expect(page.getByRole("heading", { level: 1, name: "What divers wrote" })).toBeVisible();

  // The worklist shape: unanswered first, under a group carrying the count.
  await expect(page.getByRole("heading", { name: /Waiting on you/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Answered" })).toBeVisible();
  // A stranger's row has no record to open, so it shows the address instead.
  await expect(page.getByText("marta.keller@example.net")).toBeVisible();

  // The row is the door to the diver it belongs to.
  await page.getByRole("link", { name: "Open the record for Priya Sharma" }).click();
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/divers\//);

  // The group is a landmark of its own (`DiverFileGroupDisclosure` renders a
  // `<section aria-label>`), which is what lets this scope its assertions to
  // the conversation rather than to a record six sections long.
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText(/Could I switch to the afternoon boat/)).toBeVisible();

  // The composer names where the answer is going, not only how it will travel:
  // a diver can write from an address that is not the one on their record, and
  // a staffer should be able to see that before they send rather than after
  // (issue #1515). Exact, so the label carrying the address is what is asserted
  // rather than a substring that would also match the old channel-only text.
  const composer = page.getByLabel("Reply by email to priya.sharma@example.com", { exact: true });
  await expect(composer).toBeVisible();
  await composer.fill("Yes, you’re on the 1pm boat now. See you at the dock.");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The reply is on the record whatever the provider did, and this fleet has
  // no email provider at all — so the shop is told, in as many words, that the
  // diver did not get it.
  await expect(conversation.getByText(/you’re on the 1pm boat now/)).toBeVisible();
  await expect(
    page.getByText("Email is not switched on for this DiveDay setup, so nothing went out."),
  ).toBeVisible();
  await expect(conversation.getByText("This one did not reach them.")).toBeVisible();
});

/**
 * **A stranger's message is finished by deleting it** (issue #1506).
 *
 * Its own test rather than a tail on the flow above: that one already widens
 * its timeout for three surfaces and a send, and this walks one page.
 *
 * The seeded Marta row (`src/db/seed-inbox.ts`) is the shape this is about —
 * `person_id` null, unanswered, an address nobody on the roster holds — so it
 * has no record to open and no composer, and until this control it was the one
 * row in the worklist a staffer could not finish.
 */
test("a staffer deletes the message from a sender nobody on the roster holds", async ({ page }) => {
  // The control confirms first, and Playwright dismisses a native dialog by
  // default — so the handler goes on before the click, not after it.
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/shop/blue-mantis/inbox");
  await expect(page.getByText("marta.keller@example.net")).toBeVisible();

  await page
    .getByRole("button", { name: "Delete the message from marta.keller@example.net" })
    .click();

  // The action's own `?notice=` redirect is the wait: the click returns when
  // the request is sent, not when the write has landed.
  await page.waitForURL(/notice=deleted/);
  await expect(page.getByText("Message deleted.")).toBeVisible();
  await expect(page.getByText("marta.keller@example.net")).toHaveCount(0);
});
