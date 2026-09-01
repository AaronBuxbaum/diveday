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

    const cardResponse = await page.request.get(
      `${publicPath}/arrival-card?booking=${encodeURIComponent(bookingToken ?? "")}`,
    );
    expect(cardResponse.status()).toBe(200);
    expect(cardResponse.headers()["content-disposition"]).toMatch(/attachment/);
    expect(await cardResponse.text()).toContain("Blue Mantis sign by the fuel dock");

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

    await page.goto(readyPath);
    // The response lives in the day-of step's body, and at most one step is
    // open at rest — the spec opens it exactly as the diver would.
    await openThreadStep(page, "dayof");
    await expect(page.getByText("The crew handled this request.")).toBeVisible();
  });
});
