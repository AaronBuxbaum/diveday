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
    // Today establishes the reader's baseline through a server action on its
    // first visit. Wait for that transaction before the other staffer acts.
    const initialized = reader.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined &&
        new URL(response.url()).pathname === "/shop/blue-mantis",
    );
    await reader.goto("/shop/blue-mantis");
    expect((await initialized).status()).toBe(200);
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
    const seated = owner.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined &&
        new URL(response.url()).pathname === "/shop/blue-mantis/divers/new" &&
        response.headers()["x-action-redirect"]?.includes(`/trips/${tripId}`) === true,
    );
    await owner.getByRole("button", { name: "Add to boat" }).click();
    const seatResponse = await seated;
    expect(seatResponse.status()).toBe(200);
    const redirect = seatResponse.headers()["x-action-redirect"]?.split(";")[0];
    if (!redirect) throw new Error("Walk-in action did not redirect to its trip");
    expect(new URL(redirect, seatResponse.url()).pathname).toBe(
      `/shop/blue-mantis/trips/${tripId}`,
    );
    await reader.goto("/shop/blue-mantis");
    return { reader, readerContext };
  } catch (error) {
    await readerContext.close();
    throw error;
  }
}
