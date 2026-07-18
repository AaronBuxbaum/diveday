#!/usr/bin/env node
/**
 * Generate the real in-app screenshots used by the public marketing pages.
 *
 * The output intentionally lives in public/marketing so a review can inspect
 * the exact image that the homepage, product page, and pricing page will use.
 * It never uses a hand-built lookalike of the product surface.
 *
 * Usage:
 *   pnpm dev
 *   node scripts/capture-marketing-screenshots.mjs
 *
 * Optional:
 *   BASE_URL=https://preview.example.com node scripts/capture-marketing-screenshots.mjs
 *   OUT_DIR=public/marketing node scripts/capture-marketing-screenshots.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT_DIR = process.env.OUT_DIR ?? "public/marketing";
const DEMO_SHOP_SLUG = "blue-mantis";
const STAFF = {
  owner: { email: "dana@bluemantis.example", password: "dev-owner-password" },
  captain: { email: "sal@bluemantis.example", password: "dev-captain-password" },
};

const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (fs.existsSync(sandboxChromium) ? sandboxChromium : undefined);

function output(name) {
  return path.join(OUT_DIR, `${name}.png`);
}

async function assertServer() {
  try {
    await fetch(BASE_URL, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(`No app is available at ${BASE_URL}. Start it first with pnpm dev.`);
  }
}

async function signIn(page, person) {
  await page.goto(new URL("/sign-in", BASE_URL).href, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`/shop/${DEMO_SHOP_SLUG}`));
  await page.waitForLoadState("networkidle");
}

async function openReefTrip(page) {
  await page
    .getByRole("link", { name: /Two-Tank Reef/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
}

async function captureDiverBooking(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(new URL(`/shop/${DEMO_SHOP_SLUG}/schedule`, BASE_URL).href, {
    waitUntil: "networkidle",
  });
  await page.locator("main").screenshot({ path: output("diver-booking") });
  await context.close();
}

async function captureFrontDeskReadiness(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  await signIn(page, STAFF.owner);
  await openReefTrip(page);
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Readiness" }) });
  await section.screenshot({ path: output("front-desk-readiness") });
  await context.close();
}

async function captureCaptainRollCall(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  await signIn(page, STAFF.captain);
  await openReefTrip(page);
  await page.getByRole("link", { name: "Open boat manifest" }).click();
  await page.waitForLoadState("networkidle");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Roll call" }) });
  await section.screenshot({ path: output("captain-roll-call") });
  await context.close();
}

await assertServer();
fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  await captureDiverBooking(browser);
  await captureFrontDeskReadiness(browser);
  await captureCaptainRollCall(browser);
  console.log(`Wrote marketing screenshots to ${OUT_DIR}`);
} finally {
  await browser.close();
}
