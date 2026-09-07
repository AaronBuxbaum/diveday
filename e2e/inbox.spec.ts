import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * **The two-way inbox, staff side** (ADR 20260907-two-way-inbox): what divers
 * wrote back lands in one shop inbox and on the diver's own record, and the
 * shop answers from the record in the channel the diver wrote in.
 *
 * The seed (`src/db/seed-inbox.ts`) puts one of each state on the board — an
 * unanswered email from a diver on file, an unanswered WhatsApp inside Meta's
 * 24-hour window, an answered email thread, and a message from an address
 * nobody holds — so every branch this spec reads is a real row rather than
 * something the spec had to build first.
 *
 * **The send itself is not asserted here.** This deployment has no SES and no
 * WhatsApp credentials, so every channel answers `not_configured`; a reply that
 * actually goes out is proven in `src/db/staff-reply.test.ts`, against a
 * provider a unit test can hold. What the browser is for is the composer being
 * bound to the right message, on the right channel, and the refusal landing
 * beside the box rather than two screens up.
 */

test.describe("as owner", () => {
  signedInAsOwner();

  test("the inbox splits what is waiting from what is answered", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await expect(
      page.getByRole("heading", { level: 1, name: "What divers wrote back" }),
    ).toBeVisible();

    // Scoped to `main`: the staff header and the phone dock are lists too.
    const rows = page.getByRole("main").getByRole("listitem");
    // Unanswered first, newest first inside each half — the answered thread
    // is last, which is the seam this page is ordered around.
    await expect(rows).toContainText([
      "Diego Alvarez",
      "Priya Sharma",
      "Unknown sender",
      "Lena Fischer",
    ]);
    await expect(page.getByRole("heading", { name: "Waiting on you" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Answered" })).toBeVisible();

    // A message nobody's address matched has no record to open, so no door.
    const stranger = rows.filter({ hasText: "Unknown sender" });
    await expect(stranger.getByRole("link")).toHaveCount(0);
    // An answered row keeps no "Mark answered": there is nothing left to say.
    await expect(
      rows.filter({ hasText: "Lena Fischer" }).getByRole("button", { name: "Mark answered" }),
    ).toHaveCount(0);
  });

  test("marking a message answered moves it out of the waiting group", async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    const rows = page.getByRole("main").getByRole("listitem");
    const stranger = rows.filter({ hasText: "Unknown sender" });
    await expect(stranger.getByRole("button", { name: "Mark answered" })).toBeVisible();
    await stranger.getByRole("button", { name: "Mark answered" }).click();

    // The row keeps its place on the page and loses the act that only an
    // unanswered message carries — that move *is* the confirmation, which is
    // why nothing says "answered" in words.
    await expect(
      rows.filter({ hasText: "Unknown sender" }).getByRole("button", { name: "Mark answered" }),
    ).toHaveCount(0);
  });

  test("deleting a message takes it off the inbox", async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    const rows = page.getByRole("main").getByRole("listitem");
    await rows
      .filter({ hasText: "Unknown sender" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(rows.filter({ hasText: "Unknown sender" })).toHaveCount(0);
  });

  test("a row opens the diver's record, where the conversation is", async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Priya Sharma" })
      .getByRole("link", { name: "Open record" })
      .click();

    // The thread group opens itself when somebody is waiting on an answer.
    await expect(page.getByText("Could I switch to the afternoon boat")).toBeVisible();
    // The channel is the diver's, and the label is where the surface says so —
    // there is no channel picker, because a diver who wrote by email is not
    // asking to be texted.
    await expect(page.getByLabel("Write back by Email")).toBeVisible();
  });

  test("a refused reply answers beside the box it was typed in", async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Priya Sharma" })
      .getByRole("link", { name: "Open record" })
      .click();
    await expect(page.getByLabel("Write back by Email")).toBeVisible();

    await page.getByLabel("Write back by Email").fill("The 1pm boat has room. See you there.");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // No SES on this deployment, so the honest answer is that nothing is
    // connected — and it is said **in the form's own action row**, which is
    // what this scoping asserts: the refusal is inside the Messages group, not
    // in a banner two screens up at the top of a 6,400px record.
    await expect(page.getByTestId("diver-file-group-messages").getByRole("alert")).toContainText(
      "This shop has no sender connected for that channel.",
    );
    // And the message stays unanswered, because it is.
    await page.goto("/shop/blue-mantis/inbox");
    await expect(
      page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: "Priya Sharma" })
        .getByRole("button", { name: "Mark answered" }),
    ).toBeVisible();
  });

  test("a WhatsApp conversation is answered on WhatsApp", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Diego Alvarez" })
      .getByRole("link", { name: "Open record" })
      .click();
    // Seeded 90 minutes before the frozen clock, so Meta's window is open and
    // the box is offered rather than the closed-window line.
    await expect(page.getByLabel("Write back by WhatsApp")).toBeVisible();
  });

  test("Today counts what nobody has answered and points at the inbox", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    const row = page.getByText("3 messages are waiting on you");
    await expect(row).toBeVisible();
    await expect(page.getByRole("link", { name: "Open messages" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/inbox",
    );
  });
});
