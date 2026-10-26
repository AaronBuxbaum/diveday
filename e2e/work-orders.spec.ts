import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openDiverFileGroup } from "./helpers";

const staffCopy = staffTranslator("en-US");

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
    const chooseAgain = page.getByRole("link", { name: "Choose somebody else" });
    await expect(chooseAgain).toBeVisible();
    const chooseAgainBox = await chooseAgain.boundingBox();
    if (!chooseAgainBox) throw new Error("Customer chooser link is missing");
    expect(chooseAgainBox.height).toBeGreaterThanOrEqual(44);

    // Nothing of his is on file yet in this spec's run, so the piece he
    // brought in is recorded first.
    await page.locator("details#add-piece > summary").click();
    await page.getByLabel("Kind").selectOption("regulator");
    await page.getByLabel("Make & model").fill("Apeks XTX50");
    await page.getByLabel("Serial number").fill("E2E-77001");
    await page.getByRole("button", { name: "Add to the record" }).click();
    await expect(page.getByText("On the record")).toBeVisible();

    // **A refusal keeps the paragraph** (fifth loop, item 14): sent without
    // a piece ticked, the form comes back saying so, with the customer's
    // words still in the box.
    await page.getByLabel("What the customer reports").fill("Second stage free-flows when wet.");
    await page.getByRole("button", { name: "Open the work order" }).click();
    await expect(page.getByText("Pick at least one piece.")).toBeVisible();
    await expect(page.getByLabel("What the customer reports")).toHaveValue(
      "Second stage free-flows when wet.",
    );

    await page.getByLabel(/Apeks XTX50/).check();
    await page.getByRole("button", { name: "Open the work order" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Diego Alvarez" })).toBeVisible();
    await expect(page.getByText("Work order opened")).toBeVisible();
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
    // The ticket's number, what the counter reads down the phone.
    await expect(page.getByText(/^#\d+$/).first()).toBeVisible();

    // On the bench: one button per move, the next step first.
    await page.getByRole("button", { name: "In progress" }).click();
    await expect(page.getByText("Status saved")).toBeVisible();
  });

  test("prices a ticket from its table, and corrects a line from its menu", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Breathes wet at depth/ })
      .first()
      .click();
    await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();

    await page.getByText(staffCopy("workOrders.detail.addPartOrLabor"), { exact: true }).click();
    await page.getByLabel("Description").last().fill("Second-stage service kit");
    await page.getByLabel("Price each").last().fill("42");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Line added")).toBeVisible();

    // The table is for reading; a figure changes behind the line's own menu.
    await page.getByRole("button", { name: "Change Second-stage service kit" }).last().click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("[data-row-menu]").getByLabel("Price each").fill("45");
    await page.locator("[data-row-menu]").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Line saved")).toBeVisible();
    await expect(page.getByRole("cell", { name: "$45.00" }).first()).toBeVisible();
  });

  test("a refused add keeps its figures across redirects and repeated additions return to the total", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Breathes wet at depth/ })
      .first()
      .click();
    const door = page.getByText(staffCopy("workOrders.detail.addPartOrLabor"), { exact: true });
    await door.click();
    const form = page.locator("form").filter({ has: page.locator("#new-line-description") });
    const description = form.getByLabel("Description", { exact: true });
    const amount = form.getByLabel("Price each", { exact: true });
    await amount.fill("bad");
    for (const refusedPart of ["First refused kit", "Second refused kit"]) {
      await description.fill(refusedPart);
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(
        page.getByText(staffCopy("workOrders.notice.invalidAmount"), { exact: true }),
      ).toBeVisible();
      await expect(
        form.getByText(staffCopy("workOrders.notice.invalidAmount"), { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(staffCopy("workOrders.notice.invalidAmount"), { exact: true }),
      ).toHaveCount(1);
      await expect(description).toHaveValue(refusedPart);
      await expect(amount).toHaveValue("bad");
    }
    for (const part of ["First counter kit", "Second counter kit"]) {
      if (!(await form.isVisible())) await door.click();
      await description.fill(part);
      await amount.fill("12");
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(
        page.getByText(staffCopy("workOrders.notice.lineAdded"), { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("cell", { name: part, exact: true })).toBeVisible();
      await expect(form).not.toBeVisible();
      await expect(page.locator("#work-order-total")).toBeFocused();
    }
  });

  test("alternate moves remain inside a ticket resized to phone width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Breathes wet at depth/ })
      .first()
      .click();
    const trigger = page.getByRole("button", {
      name: staffCopy("workOrders.detail.otherMoves"),
      exact: true,
    });
    await trigger.click();
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = page.locator("[data-more-menu-panel]");
    await expect.poll(async () => (await panel.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error("Alternate moves menu is missing");
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
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
    await expect(page.getByRole("status")).toHaveText(staffCopy("workOrders.notice.workRecorded"));
    await expect(page.getByRole("button", { name: "Record the work" })).toHaveCount(0);

    // Ready for its owner, then collected, and collected is the end of it.
    await page.getByRole("button", { name: "Ready for pickup" }).click();
    await expect(page.getByText("Status saved")).toBeVisible();
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
    await page.getByRole("link", { name: "Print claim tag" }).click();

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
    await openDiverFileGroup(page, "Gear they own");
    // The ticket sits under the piece it is for (Aaron, 2026-10-23).
    const bcd = page.getByRole("listitem").filter({ hasText: "BCD" }).first();
    await expect(bcd.getByRole("link", { name: /Inflator sticks open/ })).toBeVisible();
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
    await expect(page.getByText("Status saved")).toBeVisible();
    await expect(card.getByText("Not sent: messages aren’t set up")).toBeVisible();
    await expect(card.getByText("Goes to the customer when this ticket is ready.")).toHaveCount(0);
    await card.getByRole("button", { name: "Resend" }).click();
    await expect(
      card.getByText("Messages aren’t set up for this shop, so nothing went."),
    ).toBeVisible();
  });

  // A ticket that is ready with no message on record — set straight in the
  // database by the `?bench=1` trouble state, the way a status written outside
  // the move would leave it. This is the card's own third reading of the ready
  // line, and the page loading at all with it is the point: a screenshot of
  // this state once showed the error boundary instead of the ticket.
  test("a ready ticket with no message on record loads with its bill card", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-trouble-states?bench=1");
    await request.post("/api/test/seed-stripe-account");
    await page.goto("/shop/blue-mantis/gear/work-orders");
    await page
      .getByRole("link", { name: /Inflator sticks open/ })
      .first()
      .click();
    const card = page.getByRole("region", { name: "Bill and pickup" });
    await expect(card.getByText("Not sent yet")).toBeVisible();
    await expect(card.getByRole("button", { name: "Send ready message" })).toBeVisible();
    await expect(card.getByText("Total: $89.00")).toBeVisible();
    await expect(card.getByRole("button", { name: "Send the bill" })).toBeVisible();
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
    // Unconnected: the total and how to record it paid at pickup, and no bill.
    await expect(card.getByText("Paid at pickup:")).toBeVisible();
    await expect(card.getByRole("button", { name: "Cash" })).toBeVisible();
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

    await expect(page.getByText("Work order deleted")).toBeVisible();
    await page.goto("/shop/blue-mantis/gear/work-orders?view=deleted");
    await page
      .getByRole("button", { name: /Restore/ })
      .first()
      .click();
    await expect(page.getByText("Work order restored")).toBeVisible();
  });
});
