import { readFileSync } from "node:fs";

/**
 * Keep the concrete, phone-sized part of design principle 2 testable. This is
 * deliberately a small guard for the surfaces named by the decision, not a
 * sweep over every quiet caption in the product.
 */
const read = (path) => readFileSync(path, "utf8");
const failures = [];
const includes = (path, needle, label) => {
  if (!read(path).includes(needle)) failures.push(`${label}: missing ${needle}`);
};

includes(
  "docs/design/principles.md",
  "Critical text is any text a person reads to make a decision or to identify a record",
  "design principle 2",
);

const tabBar = read("src/components/StaffTabBar.tsx");
if ((tabBar.match(/text-base font-medium leading-tight/g) ?? []).length < 2) {
  failures.push("phone tab bar labels must remain 16px");
}

// The shopfront's own destinations, for the same reason as the dock's: a
// destination label is a control's own label. This read `text-sm sm:text-base`
// until 2026-08-28, with a comment arguing that navigation is not critical
// text — which is why the rule is mechanical here now rather than remembered.
const publicNav = read("src/components/PublicShopNav.tsx");
if (!/const linkClass =\s*\n?\s*"[^"]*\btext-base\b/.test(publicNav)) {
  failures.push("shopfront nav labels must be 16px at every width");
}
if (/const linkClass =\s*\n?\s*"[^"]*\btext-sm\b/.test(publicNav)) {
  failures.push("shopfront nav labels must not drop to 14px on phones");
}

// The orders table became a day ledger with the same recomposition (ADR
// 20260827-clearwater-surface-language, slice 6f), so the three needles moved
// with the rows they measure — the guard follows the surface, not the file the
// surface used to live in.
const orders = read("src/app/shop/[shopSlug]/orders/_components/OrdersLedger.tsx");
for (const [needle, label] of [
  ["truncate text-base font-medium sm:w-56 sm:shrink-0", "orders person names"],
  ["truncate text-base text-muted sm:text-sm", "orders phone trip titles"],
  ["min-w-20 text-end text-base font-semibold tabular-nums", "orders amounts"],
]) {
  if (!orders.includes(needle)) failures.push(`${label} must be 16px on phones`);
}

// The public schedule's day rule moved into the week ledger when the
// storefront recomposed (ADR 20260827-clearwater-surface-language, slice 6i);
// the 16px floor on the date chips travelled with it.
const schedule = read("src/app/s/[shopSlug]/_components/WeekLedger.tsx");
for (const needle of [
  "text-base font-bold tracking-[0.18em] uppercase",
  "text-base font-medium tracking-[0.18em] text-muted uppercase",
]) {
  if (!schedule.includes(needle))
    failures.push("public schedule date chips must be 16px on phones");
}
// A row's seat state and price are what a diver decides on — critical text by
// principle 2's own definition (a status word, a money amount), pinned at the
// 16px floor the same way the orders ledger's amounts are (2026-08-28
// diver-views review, findings 1–2).
for (const [needle, label] of [
  ["text-base text-muted tabular-nums", "public schedule seat counts"],
  ["text-base font-semibold tabular-nums", "public schedule row prices"],
]) {
  if (!schedule.includes(needle)) failures.push(`${label} must be 16px on phones`);
}

if (failures.length) {
  console.error(failures.map((failure) => `critical-text: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("critical-text: named phone surfaces keep critical text at 16px");
}
