import { createHash } from "node:crypto";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openThreadStep,
  openTripAbout,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * A **digest** of the code drawn into a saved card — the QR of that download's
 * own `arrival` token, so two downloads digesting the same would be two cards
 * carrying one credential.
 *
 * A digest rather than the `data:` URL itself, which is what this compared
 * first. Playwright prints both sides of a failed `not.toBe` into the run's
 * report, and both sides there are live bearer credentials: the database is
 * per-worker and ephemeral so nothing real was ever at stake, but a credential
 * in a CI artifact costs nothing to avoid (security review, 2026-09-12).
 */
function codeImageIn(cardHtml: string): string {
  const match = /src="(data:image\/png[^"]+)"/.exec(cardHtml);
  if (!match?.[1]) throw new Error("saved card carries no arrival code");
  return createHash("sha256").update(match[1]).digest("hex");
}

test.describe("the dive arrival arc", () => {
  signedInAsOwner();

  test("carries arrival facts, party help, and the staff hand-off", async ({ page }) => {
    test.setTimeout(60_000);
    const title = `Arrival Arc ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      // Help requests are a dock-day hand-off, so keep this departure on the
      // frozen shop-local day; the seeded clock is before the departure.
      date: daysFromNow(0),
      departsAt: "11:00",
      returnsAt: "14:00",
      capacity: 6,
    });
    const staffTripPath = await (async () => {
      const link = await findTripOnBoard(page, "blue-mantis", title);
      const href = await link.getAttribute("href");
      if (!href) throw new Error("created trip has no staff link");
      return href;
    })();
    const tripId = staffTripPath.split("/").at(-1);
    if (!tripId) throw new Error("created trip has no id");

    await page.goto(staffTripPath);
    await openTripAbout(page);
    await page.getByText("Edit details", { exact: true }).click();
    await page.locator('input[name="meetingPointLabel"]').fill("North Jetty Marina");
    await page.locator('input[name="meetingPointAddress"]').fill("12 Dock Rd");
    // By form name: "Landmark" is a substring of the photo control's own label
    // ("Landmark photo"), so a label match resolves to two elements.
    await page
      .locator('textarea[name="arrivalLandmark"]')
      .fill("Blue Mantis sign by the fuel dock");
    await page.getByLabel("What to look for").fill("Look for the yellow dive flag");
    await page.getByLabel("When you arrive").fill("Ask for Dana at the dock desk");
    await page.getByLabel("Parking note").fill("Use the north gravel lot");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Changes saved");

    await signOut(page);
    const publicPath = `/s/blue-mantis/trips/${tripId}`;
    await page.goto(publicPath);
    await expect(page.getByRole("heading", { name: "Where to go" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    await expect(
      page.getByText("Blue Mantis sign by the fuel dock", { exact: true }),
    ).not.toBeVisible();
    await expect(page.getByText("North Jetty Marina", { exact: true })).not.toBeVisible();
    await expect(page.getByText("12 Dock Rd", { exact: true })).not.toBeVisible();
    await expect(
      page.getByText("Look for the yellow dive flag", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByText("Ask for Dana at the dock desk", { exact: true }),
    ).not.toBeVisible();

    const publicCardResponse = await page.request.get(`${publicPath}/arrival-card`);
    expect(publicCardResponse.status()).toBe(404);

    await page.goto(publicPath);
    await bookASeatAndOpenThread(page, "Arrival Diver");
    const readyUrl = new URL(page.url());
    const readyPath = `${readyUrl.pathname}${readyUrl.search}`;
    const bookingToken = readyUrl.pathname.split("/").filter(Boolean).at(-1);
    expect(bookingToken).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Where to go" })).toBeVisible();
    await expect(
      page.getByText("Blue Mantis sign by the fuel dock", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("North Jetty Marina", { exact: true })).toBeVisible();
    await expect(page.getByText("12 Dock Rd", { exact: true })).toBeVisible();

    const cardUrl = `${publicPath}/arrival-card?booking=${encodeURIComponent(bookingToken ?? "")}`;
    const cardResponse = await page.request.get(cardUrl);
    expect(cardResponse.status()).toBe(200);
    expect(cardResponse.headers()["content-disposition"]).toMatch(/attachment/);
    const cardHtml = await cardResponse.text();
    expect(cardHtml).toContain("Blue Mantis sign by the fuel dock");
    // The arrival code rides the saved file, encoded into it rather than
    // fetched: the card is opened on a morning with no signal (issue #1600).
    expect(cardHtml).toContain("data:image/png");

    // **The diver who cannot find the card they printed** (issue #1729). The
    // control is offered only once a card has actually been saved, and the
    // download above is what saves one — so reopening the thread here is the
    // gate's own proof as well as the way to the control.
    const stopCode = page.getByRole("button", { name: "Stop the code on a saved card" });
    const confirmStop = page.getByRole("button", { name: "Yes, stop the code" });
    await page.goto(readyPath);
    await expect(stopCode).toBeVisible();
    await stopCode.click();
    await expect(
      page.getByText(
        "Stop the code on any card you saved or printed? It will not scan at the counter; save the card again for a new one.",
      ),
    ).toBeVisible();
    await confirmStop.click();
    await expect(page.getByRole("status")).toContainText(
      "Your old code no longer scans. Save the card again for a new one.",
    );
    // Both halves of the control are gone with the code they stopped — the
    // trigger *and* the armed confirm, so this cannot pass by the block merely
    // still being open. There is nothing left to stop until the next download.
    await expect(stopCode).toHaveCount(0);
    await expect(confirmStop).toHaveCount(0);
    await expect(page.getByText("Save arrival card")).toBeVisible();

    // Saving the card again gives a new one, which is the other half of the
    // sentence the confirm just promised. The code rides the file as a PNG of
    // that download's own token, so a different image is a different credential.
    const freshCard = await page.request.get(cardUrl);
    expect(freshCard.status()).toBe(200);
    const freshHtml = await freshCard.text();
    expect(codeImageIn(freshHtml)).not.toBe(codeImageIn(cardHtml));
    await page.goto(readyPath);
    await expect(stopCode).toBeVisible();

    await openThreadStep(page, "dayof");
    await page.getByRole("radio", { name: "Carry my gear" }).check();
    await page.getByRole("button", { name: "Save request" }).click();
    await expect(page.getByRole("status")).toContainText("Your request is with the crew.");

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis");
    await expect(page.getByText(/Arrival Diver asked for help/)).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText(/Arrival Diver is waiting for help/)).toBeVisible();
    await page.getByRole("button", { name: "Mark handled" }).click();
    // Wait for the write to *land* before navigating away: the action ends in
    // `revalidateAndRedirect(home, home)`, and Today lists only open requests,
    // so the row leaving is the destination's own proof. Without it the `goto`
    // below can preempt the in-flight action and the thread reads "acknowledged".
    await expect(page.getByText(/Arrival Diver is waiting for help/)).not.toBeVisible();

    await page.goto(readyPath);
    // The response lives in the day-of step's body, and at most one step is
    // open at rest — the spec opens it exactly as the diver would.
    await openThreadStep(page, "dayof");
    await expect(page.getByText("The crew handled this request.")).toBeVisible();
  });
});
