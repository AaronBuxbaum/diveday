import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow, findTripOnBoard, openRosterDetails, openTripTab, rosterRow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";

/**
 * **"Check eLearning with PADI", done by the DiveDay browser extension**
 * (H-106).
 *
 * The real extension cannot run in CI, and the PADI Pros' Site is not ours to
 * hit from a test. So this stands in for it at the one seam the app sees: the
 * marker on `<html>` and the `postMessage` request and reply
 * (`src/lib/cert-check-extension.ts`). The reply is the text PADI's page might
 * show for the student it was asked about; the verdict, the materials tick
 * and the Undo are the real ones.
 */
async function installFakeExtension(page: Page) {
  await page.addInitScript(() => {
    const announce = () => {
      document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
      window.dispatchEvent(new Event("diveday-cert-check-ready"));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announce);
    } else {
      announce();
    }
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.source !== "diveday-page" || data.type !== "elearning-check") return;
      const { firstName, lastName, email, courseTitle } = data.query;
      window.postMessage(
        {
          source: "diveday-cert-check",
          type: "agency-check-result",
          requestId: data.requestId,
          ok: true,
          pageText: `Student\tEmail\tCourse\tStatus\n${firstName} ${lastName}\t${email}\t${courseTitle} Online\tComplete`,
        },
        window.location.origin,
      );
    });
  });
}

test("PADI showing the eLearning finished ticks the student's materials, and Undo takes it back", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await installFakeExtension(page);

  const trip = await findTripOnBoard(page, SHOP, /Open Water Diver — three-day course/);
  await trip.click();
  await openTripTab(page, "Trip");

  // A new student on the session: a name and the email PADI knows them by.
  const student = `Lena Ortiz${e2eNow().getTime()}`;
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill(student);
  await page.getByLabel("Email").fill(`lena-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

  const row = rosterRow(page, student);
  await expect(row.getByText("Materials not done")).toBeVisible();
  await openRosterDetails(row);

  await row.getByRole("button", { name: "Check eLearning with PADI" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "PADI shows the eLearning finished. Materials marked done." });
  await expect(toast).toBeVisible();
  await expect(row.getByText("Materials not done")).toHaveCount(0);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByText("Materials not done")).toBeVisible();
});
