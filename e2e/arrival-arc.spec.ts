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
    await page.getByLabel("Landmark").fill("Blue Mantis sign by the fuel dock");
    await page.getByLabel("What to look for").fill("Look for the yellow dive flag");
    await page.getByLabel("When you arrive").fill("Ask for Dana at the dock desk");
    await page.getByLabel("Parking note").fill("Use the north gravel lot");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Changes saved");

    await signOut(page);
    const publicPath = `/s/blue-mantis/trips/${tripId}`;
    await page.goto(publicPath);
    const arrival = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Where to go" }) });
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    await expect(arrival).toContainText("Blue Mantis sign by the fuel dock");
    await expect(arrival).toContainText("Look for the yellow dive flag");
    await expect(arrival).toContainText("Ask for Dana at the dock desk");
    await expect(arrival.getByRole("link", { name: "Save arrival card" })).toHaveAttribute(
      "download",
      "",
    );

    const cardResponse = await page.request.get(`${publicPath}/arrival-card`);
    expect(cardResponse.status()).toBe(200);
    expect(cardResponse.headers()["content-disposition"]).toMatch(/attachment/);
    expect(await cardResponse.text()).toContain("Blue Mantis sign by the fuel dock");

    await page.goto(publicPath);
    await bookASeatAndOpenThread(page, "Arrival Diver");
    const readyPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: "Where to go" })).toBeVisible();
    await expect(page.getByText("Blue Mantis sign by the fuel dock")).toBeVisible();

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
    await expect(page.getByText("The crew handled this request.")).toBeVisible();
  });
});
