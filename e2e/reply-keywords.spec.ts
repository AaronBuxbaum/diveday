import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, signInAsOwner, signOut } from "./helpers";

/**
 * **A diver replies `C` and gives up their seat** (ADR 20260909-reply-keywords).
 *
 * The whole round trip, over the real surfaces: a booking made from the public
 * page, a `C` delivered on the inbound path, the shop's inbox showing what the
 * one letter meant, the confirmation code read out of the diver's own record,
 * and the seat gone from the roster.
 *
 * **The code is read off the staff record rather than computed here**, which is
 * the point: it is signed server-side with a key a spec has no access to, so
 * the only way to have it is to have been sent it. That is the same evidence
 * the feature asks a diver for.
 *
 * `/api/test/inbound-message` is the only door: both real inbound webhooks
 * verify a provider signature, and the fleet blanks every provider credential
 * (`playwright.config.ts`). What it cannot show is a *delivered* reply — SES is
 * `disabledNotificationProvider` here, so the confirmation is recorded on the
 * record and the thread says it did not reach them, exactly as
 * `sendStaffReply` promises for a send that did not go.
 */
test.describe("reply keywords", () => {
  signedInAsOwner();

  test("a `C` names the departure, and the code that comes back releases the seat", async ({
    page,
    request,
  }) => {
    // A trip creation, a public booking, two sign-in transitions and three
    // staff pages before this test's own assertions start — the same aggregate
    // cost `refunds.spec.ts` sizes its timeout for.
    test.setTimeout(60_000);
    const title = `Keyword Cancel Trip ${e2eNow().getTime()}`;
    const email = `keyword-${e2eNow().getTime()}@example.com`;

    await createTrip(page, {
      title,
      date: daysFromNow(5),
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
    });

    // A brand-new diver, so the shop holds exactly one seat of theirs and a
    // `C` has one honest meaning.
    await signOut(page);
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name").fill("Nora Quinn");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

    // The first `C`. Nothing is cancelled by it, by design.
    const asked = await request.post("/api/test/inbound-message", {
      data: { shopSlug: "blue-mantis", from: email, channel: "email", body: "C" },
    });
    expect(asked.ok()).toBe(true);
    expect(await asked.json()).toMatchObject({ outcome: "awaiting_confirmation" });

    await signInAsOwner(page);
    // The inbox says what a message of one letter was asking for, which is the
    // whole reason the row carries anything beyond the diver's own words.
    await page.goto("/shop/blue-mantis/inbox");
    const row = page.getByRole("listitem").filter({ hasText: "Nora Quinn" }).first();
    await expect(row.getByText("Asked to cancel")).toBeVisible();
    await row.getByRole("link", { name: "Open the record for Nora Quinn" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/divers\//);

    // The confirmation, in the diver's own thread — and the departure named in
    // it, because a diver about to give up a seat is owed the sentence that
    // says which one.
    const conversation = page.getByRole("region", { name: "Conversation" });
    await expect(conversation.getByText(title)).toBeVisible();
    await expect(conversation.getByText(/Sent automatically/)).toBeVisible();
    const confirmation = await conversation.getByText(/Nothing has changed yet/).innerText();
    const code = confirmation.match(/Reply ([23456789A-HJKMNP-Z]{6}) in the next/)?.[1];
    expect(code).toBeTruthy();

    // The seat is still theirs until the code comes back.
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.locator("#roster").getByText("Nora Quinn")).toBeVisible();

    const confirmed = await request.post("/api/test/inbound-message", {
      data: { shopSlug: "blue-mantis", from: email, channel: "email", body: code },
    });
    expect(await confirmed.json()).toMatchObject({ outcome: "cancelled" });

    await page.reload();
    await expect(page.locator("#roster").getByText("Nora Quinn")).toHaveCount(0);

    // And a second `C` now has nothing to act on, which is what a diver who
    // taps twice gets rather than a second cancellation.
    const again = await request.post("/api/test/inbound-message", {
      data: { shopSlug: "blue-mantis", from: email, channel: "email", body: "C" },
    });
    expect(await again.json()).toMatchObject({ outcome: "nothing_to_cancel" });
  });

  test("a sentence is left to a person, and `M` stays on the worklist", async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    const title = `Keyword Move Trip ${e2eNow().getTime()}`;
    const email = `keyword-move-${e2eNow().getTime()}@example.com`;

    await createTrip(page, {
      title,
      date: daysFromNow(6),
      departsAt: "09:00",
      returnsAt: "12:30",
      capacity: 6,
    });

    await signOut(page);
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name").fill("Ivan Petrov");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Ivan/ })).toBeVisible();

    // A message that happens to contain the word: read as prose, not a command.
    const prose = await request.post("/api/test/inbound-message", {
      data: {
        shopSlug: "blue-mantis",
        from: email,
        channel: "email",
        body: "Can I cancel and move to the Sunday boat instead?",
      },
    });
    expect(await prose.json()).toMatchObject({ outcome: "not_a_keyword" });

    // `M` is a handoff, so the message stays where a staffer will find it.
    const move = await request.post("/api/test/inbound-message", {
      data: { shopSlug: "blue-mantis", from: email, channel: "email", body: "M" },
    });
    expect(await move.json()).toMatchObject({ outcome: "handed_off" });

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/inbox");
    const waiting = page.getByRole("heading", { name: /Waiting on you/ });
    await expect(waiting).toBeVisible();
    await expect(page.getByText("Asked to move")).toBeVisible();

    // The seat is untouched by either message.
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.locator("#roster").getByText("Ivan Petrov")).toBeVisible();
  });
});
