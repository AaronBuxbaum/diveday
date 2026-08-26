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

const orders = read("src/app/shop/[shopSlug]/orders/page.tsx");
for (const [needle, label] of [
  ["text-base font-medium text-foreground", "orders person names"],
  ["text-base text-muted sm:hidden", "orders phone trip titles"],
  ['<Td numeric align="middle" className="text-base sm:text-sm">', "orders amounts"],
]) {
  if (!orders.includes(needle)) failures.push(`${label} must be 16px on phones`);
}

const schedule = read("src/app/s/[shopSlug]/page.tsx");
for (const needle of [
  "text-base font-bold tracking-[0.18em] uppercase",
  "text-base font-medium tracking-[0.18em] text-muted uppercase",
]) {
  if (!schedule.includes(needle))
    failures.push("public schedule date chips must be 16px on phones");
}

if (failures.length) {
  console.error(failures.map((failure) => `critical-text: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("critical-text: named phone surfaces keep critical text at 16px");
}
