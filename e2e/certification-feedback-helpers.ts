import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect } from "./fixtures";
import {
  bookASeatAndOpenThread,
  openRosterDetails,
  openThreadStep,
  rosterRow,
  seededTripId,
} from "./helpers";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");
export const AUDIT_DIVER = "Certification Audit Diver";
export const savedLowerCard = () =>
  diver("ready.certSavedInsufficient", { held: "Open Water", level: "Advanced Open Water" });
export const staffLowerCard = () =>
  staff("shared.readiness.blockers.certificationInsufficientUnverified", {
    held: "Open Water",
    level: "Advanced Open Water",
  });

/** A real submission on an isolated shop's Deep Wreck departure, followed by a fresh read. */
export async function submitLowerCard(page: Page, slug: string) {
  const tripId = await seededTripId(page, slug, "Deep Wreck Charter — the Duane on EANx");
  await page.goto(`/s/${slug}/trips/${tripId}`);
  await bookASeatAndOpenThread(page, AUDIT_DIVER, "cert-audit@example.com");
  const certification = await openThreadStep(page, "certification");
  const entry = certification
    .locator("details")
    .filter({ has: page.getByText(diver("ready.certHeading"), { exact: true }) });
  await entry.locator("summary").click();
  await entry.getByLabel("Training agency").selectOption("padi");
  await entry.getByLabel("Level", { exact: true }).selectOption("open_water");
  await entry.getByLabel("Certification number").fill("DEMO-AUDIT-NOT-REAL");
  await entry.getByRole("button", { name: "Add my certification" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Certification added" })).toBeVisible();
  const readyPath = new URL(page.url()).pathname;
  await page.goto(readyPath);
  const saved = await openThreadStep(page, "certification");
  await expect(saved.getByText(savedLowerCard())).toBeVisible();
  await expect(
    saved.getByText(diver("ready.specialtyHeading", { specialty: "Deep" })),
  ).toBeVisible();
  await expect(saved.getByText(diver("ready.nitroxCertHeading"))).toBeVisible();
  await expect(saved.getByText(diver("ready.certNotYetLead"))).toHaveCount(0);
  return { tripId, readyPath };
}

export async function checkLowerCardRoster(page: Page, slug: string, tripId: string) {
  await page.goto(`/shop/${slug}/trips/${tripId}`);
  const row = rosterRow(page, AUDIT_DIVER);
  await openRosterDetails(row);
  await expect(row.getByText(staffLowerCard())).toBeVisible();
  await expect(row.getByText(staff("shared.readiness.blockers.certificationMissing"))).toHaveCount(
    0,
  );
  await expect(
    row.getByText(staff("shared.readiness.blockers.specialtyMissing", { specialty: "Deep" })),
  ).toBeVisible();
  await expect(row.getByText(staff("shared.readiness.blockers.nitroxMissing"))).toBeVisible();
}
