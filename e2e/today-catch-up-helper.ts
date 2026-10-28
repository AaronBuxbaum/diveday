import type { Browser, Page } from "@playwright/test";
import { expect, makeActivitySafe } from "./fixtures";
import { walkInFormPath } from "./helpers";

/** One staffer reads Today, another seats a walk-in, then the reader returns. */
export async function todayCatchUpScenario(
  browser: Browser,
  owner: Page,
  workerBaseURL: string,
  readerStorageState: string,
) {
  const readerContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: readerStorageState,
  });
  const reader = makeActivitySafe(await readerContext.newPage());
  try {
    await reader.goto("/shop/blue-mantis");
    const href = await reader
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .getAttribute("href");
    const tripId = href?.match(/\/trips\/([0-9a-f-]+)/i)?.[1];
    if (!tripId) throw new Error("Today departure link has no trip ID");
    const confirmed = owner.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/staff-activity",
    );
    await owner.goto(walkInFormPath("blue-mantis", tripId));
    expect((await confirmed).status()).toBe(200);
    await expect(owner.getByRole("alertdialog", { name: "Session paused" })).toHaveCount(0);
    await owner.getByLabel("Full name").fill("Today Catchup Diver");
    await expect(owner.getByLabel("Full name")).toHaveValue("Today Catchup Diver");
    await owner.getByRole("button", { name: "Add to boat" }).click();
    await owner.waitForURL(new RegExp(`/trips/${tripId}`));
    await reader.goto("/shop/blue-mantis");
    return { reader, readerContext };
  } catch (error) {
    await readerContext.close();
    throw error;
  }
}
