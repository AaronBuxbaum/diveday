import { expect, signedInAsOwner, test } from "./fixtures";
import { openDiverFileGroup } from "./helpers";

/**
 * The bench (ADR 20261008-gear-work-orders): opening a ticket on a diver's own
 * gear, working it, pricing it, and handing it back.
 *
 * Every write lands on blue-mantis on purpose — the work-order tables are
 * reset-owned (deleted and re-seeded by `/api/test/reset`, src/db/seed.ts), so
 * nothing a test opens here leaks into the next spec.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("opens a ticket at the counter and puts it on the bench", async ({ page }) => {
    // The bench is the Gear section's second tab, and the register is the
    // first: the two are one pillar.
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: "Work orders", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Work orders" })).toBeVisible();

    await page.getByRole("link", { name: "New work order" }).first().click();
    // The diver comes from the same person search the rest of the staff
    // surfaces use; `?diverq=` is the state that search leaves behind.
    await page.goto("/shop/blue-mantis/gear/work-orders/new?diverq=Diego+Alvarez");
    await page.getByRole("link", { name: "Diego Alvarez" }).first().click();

    // Nothing of his is on file yet in this spec's run, so the piece he
    // brought in is recorded first.
    await page.locator("summary#add-piece").click();
    await page.getByLabel("Kind").selectOption("regulator");
    await page.getByLabel("Make & model").fill("Apeks XTX50");
    await page.getByLabel("Serial number").fill("E2E-77001");
    await page.getByRole("button", { name: "Add to the record" }).click();
    await expect(page.getByText("On the record.")).toBeVisible();

    await page.getByLabel(/Apeks XTX50/).check();
    await page.getByLabel("What the customer reports").fill("Second stage free-flows when wet.");
    await page.getByRole("button", { name: "Open the work order" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Diego Alvarez" })).toBeVisible();
    await expect(page.getByText("Work order opened.")).toBeVisible();
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
    // The ticket's number, what the counter reads down the phone.
    await expect(page.getByText(/^#\d+$/).first()).toBeVisible();

    // On the bench: one button per move, the next step first.
    await page.getByRole("button", { name: "In progress" }).click();
    await expect(page.getByText("Status saved.")).toBeVisible();
  });

  test("prices a ticket from its table, and corrects a line from its menu", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Breathes wet at depth/ })
      .first()
      .click();
    await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();

    await page.getByLabel("Description").last().fill("Second-stage service kit");
    await page.getByLabel("Price each").last().fill("42");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Line added.")).toBeVisible();

    // The table is for reading; a figure changes behind the line's own menu.
    await page.getByRole("button", { name: "Change Second-stage service kit" }).last().click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("[data-row-menu]").getByLabel("Price each").fill("45");
    await page.locator("[data-row-menu]").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Line saved.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "$45.00" }).first()).toBeVisible();
  });

  test("records the work done, then hands the gear back", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Breathes wet at depth/ })
      .first()
      .click();
    await page.getByRole("heading", { level: 2, name: "Work done" }).waitFor();

    // The Work done record: the one act that moves a piece's due date, and
    // only with what the technician marks passed.
    await page.getByLabel("Service", { exact: true }).first().selectOption("passed");
    await page.getByRole("button", { name: "Record the work" }).click();
    await expect(page.getByText("Work recorded.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record the work" })).toHaveCount(0);

    // Ready for its owner, then collected, and collected is the end of it.
    await page.getByRole("button", { name: "Ready for pickup" }).click();
    await expect(page.getByText("Status saved.")).toBeVisible();
    await page.getByRole("button", { name: "Picked up" }).click();
    // The history is what answers "who said this was ready" a year later.
    await expect(page.getByText("Ready for pickup to Picked up")).toBeVisible();
    // A collected ticket has nowhere left to move.
    await expect(page.getByRole("button", { name: "In progress" })).toHaveCount(0);
  });

  test("prints a claim tag with no money on it", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /free-flows/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Claim tag" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we have" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you told us" })).toBeVisible();
    await expect(page.getByText(/^#\d+$/)).toBeVisible();
    // Not a receipt and not a waiver: no total, nothing to sign.
    await expect(page.getByText("Total:")).toHaveCount(0);
  });

  test("the diver's own record carries their gear and their tickets", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Inflator sticks open/ })
      .first()
      .click();
    // Wait for the ticket itself: a `textContent()` read straight off the
    // click can still be the board's own heading.
    await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();
    const owner = await page.getByRole("heading", { level: 1 }).textContent();
    // Reached through the diver search, because the list is paged and the
    // seeded owner of this ticket is not on its first page.
    await page.goto(`/shop/blue-mantis/divers?q=${encodeURIComponent(owner ?? "")}`);
    await page
      .getByRole("link", { name: owner ?? "" })
      .first()
      .click();

    // A file group like the others on the record, opened the way the rest of
    // the diver specs open one.
    await openDiverFileGroup(page, "Their own gear");
    await expect(page.getByRole("link", { name: /Inflator sticks open/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "New work order" })).toBeVisible();
  });

  /**
   * **What the customer hears, and what they owe** (ADR
   * 20261008-work-order-follow-up). Moving a ticket to ready records the
   * ready message on the ticket; this fleet has no mail provider, so the
   * record says so rather than claiming it went. The bill is the order path:
   * with no Stripe account the ticket only says where it is paid, and with the
   * test double's account it goes as far as Stripe, which this fleet cannot
   * reach (the boundary e2e/invoicing.spec.ts documents).
   */
  test("moving a ticket to ready records the message to the customer", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Inflator sticks open/ })
      .first()
      .click();
    await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();
    const card = page.getByRole("region", { name: "Bill and pickup" });
    await expect(card.getByText("Goes to the customer when this ticket is ready.")).toBeVisible();

    await page.getByRole("button", { name: "Ready for pickup" }).click();
    await expect(page.getByText("Status saved.")).toBeVisible();
    await expect(card.getByText("Not sent: messages aren’t set up")).toBeVisible();
    await expect(card.getByText("Goes to the customer when this ticket is ready.")).toHaveCount(0);
    await card.getByRole("button", { name: "Resend" }).click();
    await expect(
      card.getByText("Messages aren’t set up for this shop, so nothing went."),
    ).toBeVisible();
  });

  test("the bill goes through an order, and only once the shop can take money", async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Inflator sticks open/ })
      .first()
      .click();
    const card = page.getByRole("region", { name: "Bill and pickup" });
    // Unconnected: the total and where it is paid, and no button.
    await expect(card.getByText("Collected at the counter.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Send the bill" })).toHaveCount(0);

    // The test double: connected and charges-enabled, without calling Stripe.
    await request.post("/api/test/seed-stripe-account");
    await page.reload();
    await card.getByRole("button", { name: "Send the bill" }).click();
    await expect(
      card.getByText("Stripe couldn’t create that bill. Try again in a moment."),
    ).toBeVisible();
    // Nothing was linked, so the ticket still offers the bill.
    await expect(card.getByRole("button", { name: "Send the bill" })).toBeVisible();
  });

  test("deleting a ticket is soft, and the board offers it back", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Second stage free-flows on the surface/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Delete work order" }).click();

    await expect(page.getByText("Work order deleted.")).toBeVisible();
    await page.goto("/shop/blue-mantis/gear/work-orders?view=deleted");
    await page
      .getByRole("button", { name: /Restore/ })
      .first()
      .click();
    await expect(page.getByText("Work order restored.")).toBeVisible();
  });
});
