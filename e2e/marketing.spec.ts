import { expect, test } from "./fixtures";

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Run the whole dive day, from booking to head count." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  // The portability story (safe to leave) is a first-class band on the homepage.
  await expect(
    page.getByRole("heading", { name: "Your data leaves with you — any day, no phone call." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Product" }).first().click();
  await expect(
    page.getByRole("heading", {
      name: "From the first booking to the last head count.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A manifest that stays useful after the signal disappears.",
    }),
  ).toBeVisible();
  // The money story and the full capability index — the two things a buyer
  // comparing DiveDay against an incumbent's feature page goes looking for.
  await expect(
    page.getByRole("heading", { name: "The money runs through your Stripe account, not ours." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "The whole list, plainly." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Booking and the public pages" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your records" })).toBeVisible();
  // The honest-no scope block and the demo CTA both land on the product page.
  await expect(page.getByRole("heading", { name: "What DiveDay doesn't do." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();

  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(
    page.getByRole("heading", { name: "One flat price for the whole shop." }),
  ).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  await expect(page.getByText(/The crew saves the manifest to their phone/)).toBeVisible();
  // The objection layer answers the deal-killers, and a skeptic can reach the
  // demo without committing to a trial form.
  await expect(
    page.getByRole("heading", {
      name: "DiveDay is new. What happens to my data if this doesn't work out?",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo first" })).toBeVisible();
});

test("the about page says who is behind DiveDay and what it won't pretend", async ({ page }) => {
  // Reachable from the footer on any marketing page — the conventional place a
  // buyer looks for who they're dealing with.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "About" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Built by divers, for divers.",
    }),
  ).toBeVisible();

  // The page earns trust by conceding, not by claiming: the honest-no block and
  // the named accountable human are the load-bearing parts.
  await expect(
    page.getByRole("heading", { name: "What we're not going to pretend." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "DiveDay is new." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "It doesn't do everything." })).toBeVisible();
  await expect(page.getByText("Aaron Buxbaum, founder")).toBeVisible();

  // Trust from a vendor with no install base is checkable, not asserted: each
  // rule ships with the demo action that proves it.
  await expect(
    page.getByRole("heading", { name: "Four rules, and you can check every one." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "It has to survive the dock." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No silent passes." })).toBeVisible();
  await expect(page.getByText("save a manifest to your phone")).toBeVisible();

  // A trust page that didn't land on the exit would be missing the point.
  await expect(
    page.getByRole("heading", { name: "Who you're actually buying from." }),
  ).toBeVisible();
  await expect(page.getByText(/No export fee, no support ticket/)).toBeVisible();

  // No fabricated proof anywhere on the page a buyer reads for credibility.
  const rendered = await page.locator("body").innerText();
  for (const pattern of [/trusted by/i, /\d+\+? (shops|customers|divers) (use|trust)/i]) {
    expect(rendered, `unfounded social proof matching ${pattern}`).not.toMatch(pattern);
  }

  // Demo-before-trial, same funnel order as every other marketing page.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a trial" }).last()).toBeVisible();
});

test("migration guides walk a shop from an incumbent export into the importer", async ({
  page,
}) => {
  // The switch surface is reachable from the footer on any marketing page.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Switch" }).click();

  await expect(page.getByRole("heading", { name: "The door swings both ways." })).toBeVisible();

  // The named incumbents each have a live guide (no coming-soon entries).
  for (const name of [
    /Switching from EVE/,
    /Switching from DiveShop360/,
    /Switching from DiveAdmin/,
    /Switching from Smartwaiver/,
    /Switching from FareHarbor/,
    /Switching from Rezdy/,
  ]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }

  await page.getByRole("link", { name: /Switching from EVE/ }).click();
  await expect(page.getByRole("heading", { name: "Moving your shop off EVE" })).toBeVisible();

  // The three-part promise: export click-path, the scope table, the importer.
  await expect(page.getByRole("heading", { name: "Get your data out of EVE" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across — and what doesn't" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();

  // The scope table is the importer's honesty table — a claimed waiver
  // acceptance is trusted, medical clearance included, and marked imported.
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();
  await expect(page.getByText("Stays behind").first()).toBeVisible();
  // Specialty cards moved into the green column and say what waits on staff.
  await expect(page.getByText("Specialty cards (deep, wreck, night, drysuit)")).toBeVisible();

  // Nothing on a published page may cite how *we* talk about a decision. The
  // honesty table and the guides render verbatim, so a note written for the next
  // agent ("see the imported-waiver ADR") would ship to a buyer as a dead end —
  // and this reads the rendered page, so it also catches copy a component
  // assembles rather than a data file. Unit-level guard: src/test/copy.ts.
  const rendered = await page.locator("body").innerText();
  for (const pattern of [
    /\bADRs?\b/,
    /\b20\d{6}-[a-z-]+\b/,
    /\bH-\d\d\b/,
    /\bCR-\d{3}\b/,
    /\bsrc\/[a-z]/,
    /dive-domain-expert|security-reviewer/,
  ]) {
    expect(rendered, `internal reference matching ${pattern} on a published page`).not.toMatch(
      pattern,
    );
  }

  // Demo-before-trial funnel and cited competitor claims both land on the guide.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: /DiveShop360 acquires EVE Diving/ })).toBeVisible();

  // Another live guide carries its own export path and a competitor-specific note.
  await page.goto("/switching/smartwaiver");
  await expect(
    page.getByRole("heading", { name: "Moving your waivers off Smartwaiver" }),
  ).toBeVisible();
  await expect(page.getByText(/For a Smartwaiver export:/)).toBeVisible();

  // FareHarbor is a booking channel, not a records system, so its guide is
  // coexist-led: keep the storefront and run the dive day, or leave the fee —
  // then the same export/scope/import mechanics every guide shares.
  await page.goto("/switching/fareharbor");
  await expect(
    page.getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep FareHarbor. Add the day it can't run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the per-booking fee behind." }),
  ).toBeVisible();
  // It still renders the shared three-part promise and the honesty table.
  await expect(
    page.getByRole("heading", { name: "Get your data out of FareHarbor" }),
  ).toBeVisible();
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();

  // Rezdy is the second booking-channel guide — same coexist template, its own
  // copy (a monthly-plus-per-booking model rather than FareHarbor's fee).
  await page.goto("/switching/rezdy");
  await expect(
    page.getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep Rezdy. Add the day it can't run." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Or leave the monthly fee and the per-booking cut behind." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get your data out of Rezdy" })).toBeVisible();

  // An unlisted incumbent has no page — no coming-soon shells.
  const response = await page.goto("/switching/checkfront");
  expect(response?.status()).toBe(404);
});

test("the spreadsheet guide brings a no-system shop across for free", async ({ page }) => {
  // Reachable from the hub — the largest under-served pool gets a front door.
  await page.goto("/switching");
  await page.getByRole("link", { name: /Coming from a spreadsheet/ }).click();
  await expect(
    page.getByRole("heading", { name: "The spreadsheet got you this far." }),
  ).toBeVisible();

  // The three-part shape, reframed for a shop with no vendor to leave:
  // ready your own sheet, the shared scope table, the importer.
  await expect(
    page.getByRole("heading", { name: "Does your sheet have these columns?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across — and what doesn't" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();

  // The starter template downloads a real CSV (not a dead link).
  const templateHref = await page
    .getByRole("link", { name: /Download the starter template/ })
    .getAttribute("href");
  expect(templateHref).toBe("/diveday-diver-import-template.csv");
  const template = await page.request.get(templateHref ?? "");
  expect(template.ok()).toBeTruthy();
  const templateBody = await template.text();
  // Nitrox needs its card-number column, or a "yes" flag lands nothing.
  expect(templateBody).toContain("certification_number");
  expect(templateBody).toContain("nitrox_certification_number");
  // Header-only: no example people to accidentally import into a real roster.
  expect(templateBody).not.toContain("@");

  // The scope table is the importer's honesty table — same safety spine.
  await expect(page.getByText("Signed waivers & medical clearance", { exact: true })).toBeVisible();

  // The owner-authorized concierge switch offer lands, phrased as a human
  // commitment, with a real handoff: an email link the shop can act on.
  await expect(
    page.getByRole("heading", { name: /switch you on — and off — ourselves/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Email us at/ })).toHaveAttribute(
    "href",
    /^mailto:switch@dive\.day/,
  );

  // Demo-before-trial funnel, same as every guide.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
});
