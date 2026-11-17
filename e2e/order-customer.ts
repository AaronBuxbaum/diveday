import type { Locator, Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect } from "./fixtures";

const staff = staffTranslator("en-US");

/**
 * Choose an order's customer the way staff do (issue #4601): type part of the
 * name into the picker and take the match. `name` is the person's full name.
 */
export async function chooseOrderCustomer(scope: Page | Locator, name: string) {
  await scope.getByLabel(staff("orders.new.customerLabel"), { exact: true }).fill(name);
  await scope
    .getByRole("listitem")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(
    scope.getByRole("button", { name: staff("orders.new.changeCustomer"), exact: true }),
  ).toBeVisible();
}

/** The customer the form will send: a person id, `walk-in`, or nothing. */
export function chosenOrderCustomer(scope: Page | Locator) {
  return scope.locator('input[type="hidden"][name="personId"]');
}
