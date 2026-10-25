import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
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

const staff = staffTranslator("en-US");
const diver = diverTranslator("en-US");

test.describe("the dive arrival arc", () => {
  signedInAsOwner();

  test("carries arrival facts, party help, and the staff hand-off", async ({ page }) => {
    test.setTimeout(60_000);
    const title = `Arrival Arc ${e2eNow().getTime()}`;
    const helperName = "Marcus Webb";

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
    // Help can only promise someone assigned to this departure. A newly
    // created trip has no crew, so roster the helper before the diver asks.
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: helperName });
    await expect(page.getByRole("button", { name: `Unassign ${helperName}` })).toBeVisible();
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

    await openThreadStep(page, "dayof");
    await page.getByRole("radio", { name: "Carry my gear" }).check();
    await page.getByRole("button", { name: "Save day-of details" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved. The crew will see your answers" }),
    ).toBeVisible();

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis");
    // The demo seed keeps its own open help request (Diego's, from the desk
    // hand-off), so Today lists two; act on this diver's row only. The row
    // leads with the name, so the sentence does not repeat it.
    // A diver can also appear in cert, prep, email and contact rows. Keep
    // identity tied to the help kind even when completion removes its controls.
    const helpRow = page
      .getByRole("listitem")
      .filter({ hasText: "Arrival Diver" })
      .filter({ has: page.getByText(staff("today.actionKind.helpRequest"), { exact: true }) });
    await expect(helpRow).toHaveCount(1);
    await expect(helpRow.getByText("Asked for help: carry gear")).toBeVisible();
    await helpRow.getByRole("button", { name: "Arrange help" }).click();
    const crew = helpRow.getByLabel("Crew member");
    await expect(crew.locator("option").filter({ hasText: helperName })).toHaveText(helperName);
    await crew.selectOption({ label: helperName });
    await helpRow.getByRole("button", { name: "Confirm helper" }).click();
    await expect(
      helpRow.getByText(`${helperName} will help with carry gear.`, { exact: true }),
    ).toBeVisible();
    await helpRow.getByRole("button", { name: "Help completed" }).click();
    // The row leaves the active queue after completion; the page-level outcome
    // keeps Undo available after its unmount.
    await expect(page.getByText("Help marked complete.", { exact: true })).toBeVisible();
    await expect(helpRow).not.toBeVisible();

    const diverPage = await page.context().newPage();
    await diverPage.goto(readyPath);
    await openThreadStep(diverPage, "dayof");
    // A handled request names nobody: the helper may have left the boat since.
    await expect(diverPage.getByText(diver("ready.helpHandled"), { exact: true })).toBeVisible();
    await expect(diverPage.getByText(new RegExp(`${helperName} will help you at`))).toHaveCount(0);
    await diverPage.close();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(helpRow).toHaveCount(1);
    await expect(helpRow.getByText(`${helperName} will help with carry gear.`)).toBeVisible();

    await page.goto(readyPath);
    // The response lives in the day-of step's body, and at most one step is
    // open at rest — the spec opens it exactly as the diver would.
    await openThreadStep(page, "dayof");
    await expect(page.getByText(`${helperName} will help you at`, { exact: false })).toBeVisible();
  });
});
