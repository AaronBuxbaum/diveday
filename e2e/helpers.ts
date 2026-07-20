import { expect, type Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

/** Sign in through the dev credential form as the seeded owner. */
export async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/** An ISO date (YYYY-MM-DD) `days` from now, for date inputs. */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
