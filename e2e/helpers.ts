import { expect, type Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { E2E_FROZEN_CLOCK } from "./servers";

/** Sign in through the dev credential form as the seeded owner. */
export async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/**
 * Sign out through ShopNav's two-tap InlineConfirmButton (UX-persona task
 * 81): the first tap only arms the button and relabels it to the confirm
 * state without submitting, so a single click here would leave the session
 * signed in and every caller's next assertion hanging.
 */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign out? Confirm" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * "Now" as the server sees it. The e2e fleet freezes its clock at
 * E2E_FROZEN_CLOCK (playwright.config.ts → src/lib/clock.ts), so any date a
 * test computes for a form input, or any year it asserts against a
 * server-rendered calendar, must be relative to *that* instant — not the real
 * wall clock. Anchoring here is what keeps date-driven specs (and the visual
 * regression baselines) passing identically in 2026 and in 2030.
 */
export function e2eNow(): Date {
  return new Date(E2E_FROZEN_CLOCK);
}

/** An ISO date (YYYY-MM-DD) `days` from the frozen clock, for date inputs. */
export function daysFromNow(days: number): string {
  return new Date(e2eNow().getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Sign in through the dev credential form as any seeded staff login. */
export async function signInAs(page: Page, login: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(login.email);
  await page.getByLabel("Password").fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/**
 * Open a departure from the staff schedule board.
 *
 * The board is the schedule builder (src/app/shop/[shopSlug]/schedule/_components),
 * where a row carries its own Move/Copy/Remove controls and only the title is a
 * link — so clicking the row itself lands on padding and navigates nowhere.
 * Every spec that starts "from the board, open trip X" goes through here rather
 * than re-deriving that.
 */
export async function openTripFromBoard(page: Page, title: string) {
  await page
    .getByRole("listitem")
    .filter({ hasText: title })
    .first()
    // Exact match: an unpriced trip's card also carries a "Set a price for
    // {title}, {date} {time}" link (task 150) whose accessible name contains
    // the trip title as a substring — a non-exact name match would resolve
    // to both links and hit Playwright's strict-mode violation.
    .getByRole("link", { name: title, exact: true })
    .click();
  await expect(page).toHaveURL(/\/trips\//);
}
