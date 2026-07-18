import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const shared = {
  avoid: ["pnpm-lock.yaml", "drizzle/", ".next/", "playwright-report/", "test-results/"],
  rules: [
    "Read tests before implementation when determining intended behavior.",
    "Keep routes thin; put framework-free domain rules in src/lib or the feature module.",
    "Run the narrowest useful test while iterating, then pnpm check before commit.",
    "Update docs in the same change when behavior, architecture, or domain language changes.",
  ],
};

const areas = {
  waivers: {
    goal: "Build the M3 waiver flow with immutable signed history and fail-closed medical referral states.",
    docs: [
      "docs/product/next-steps.md",
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/design/principles.md",
      "docs/architecture/overview.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/client.ts",
      "src/db/bookings.ts",
      "src/lib/authz.ts",
      "src/app/trips/[id]",
      "src/app/shop",
    ],
    tests: ["src/db/bookings.test.ts", "e2e"],
    invariants: [
      "Tenant-scope every record and query.",
      "Signed records are immutable; corrections create a new version.",
      "Referral-triggering medical answers fail closed.",
      "Submission must be idempotent and authorized.",
    ],
    validate: [
      "pnpm test -- src/db/bookings.test.ts --reporter=dot",
      "pnpm check",
      "pnpm e2e -- --reporter=line",
    ],
  },
  design: {
    goal: "Deliver a calm, clear, accessible interface that follows Scuba's semantic design system.",
    docs: [
      "docs/design/principles.md",
      "docs/product/vision.md",
      "docs/product/next-steps.md",
      "docs/architecture/decisions/0004-design-tokens.md",
    ],
    code: ["src/app/globals.css", "src/app", "src/components", "scripts/screenshot.mjs"],
    tests: ["e2e"],
    invariants: [
      "Use semantic tokens only; no raw colors in components.",
      "Inspect light/dark and phone/desktop output.",
      "Include empty, loading, validation, error, and success states.",
      "Keep touch targets and focus states accessible.",
    ],
    validate: [
      "pnpm lint",
      "pnpm typecheck",
      "node scripts/screenshot.mjs",
      "pnpm e2e -- --reporter=line",
    ],
  },
  database: {
    goal: "Change persistence safely while preserving tenant, capacity, and transactional invariants.",
    docs: [
      "docs/architecture/overview.md",
      "docs/architecture/decisions/0005-database.md",
      "docs/engineering/testing.md",
      "docs/product/glossary.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/client.ts",
      "src/db/queries.ts",
      "src/db/bookings.ts",
      "src/db/seed.ts",
    ],
    tests: ["src/db", "src/lib"],
    invariants: [
      "src/db/schema.ts is the source of truth; never infer schema from generated migrations.",
      "Every tenant-owned domain row carries shop_id.",
      "Capacity enforcement remains transactional.",
      "Schema changes include focused PGlite tests and generated migrations.",
    ],
    validate: [
      "pnpm test -- src/db --reporter=dot",
      "pnpm typecheck",
      "pnpm db:generate",
      "pnpm check",
    ],
  },
  bookings: {
    goal: "Extend booking behavior without weakening capacity, authorization, or user-facing recovery states.",
    docs: [
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/design/principles.md",
      "docs/architecture/overview.md",
    ],
    code: [
      "src/db/bookings.ts",
      "src/db/bookings.test.ts",
      "src/lib/trips.ts",
      "src/app/trips",
      "src/app/shop/trips",
    ],
    tests: ["src/db/bookings.test.ts", "e2e"],
    invariants: [
      "Capacity enforcement is transactional.",
      "Cancelled and past trips cannot accept bookings.",
      "Tenant and staff authorization checks stay explicit.",
    ],
    validate: [
      "pnpm test -- src/db/bookings.test.ts --reporter=dot",
      "pnpm check",
      "pnpm e2e -- --reporter=line",
    ],
  },
  auth: {
    goal: "Change authentication or authorization without creating edge/server divergence or tenant leakage.",
    docs: [
      "docs/architecture/decisions/0006-auth.md",
      "docs/architecture/overview.md",
      "docs/engineering/testing.md",
    ],
    code: [
      "src/lib/auth.config.ts",
      "src/lib/auth.ts",
      "src/lib/authz.ts",
      "src/lib/session.ts",
      "src/proxy.ts",
    ],
    tests: ["src/lib", "e2e"],
    invariants: [
      "Edge configuration remains edge-safe.",
      "Server actions and queries enforce authorization independently of route gating.",
      "Dev credentials never become production behavior.",
    ],
    validate: [
      "pnpm test -- src/lib --reporter=dot",
      "pnpm typecheck",
      "pnpm e2e -- --reporter=line",
    ],
  },
};

function usage() {
  console.error(
    `Usage: pnpm task:context -- <area>\nAreas: ${Object.keys(areas).sort().join(", ")}`,
  );
  process.exit(1);
}

const areaName = process.argv[2];
if (!areaName || !areas[areaName]) usage();
const area = areas[areaName];

async function annotate(items) {
  return Promise.all(
    items.map(async (item) => {
      try {
        await access(path.join(ROOT, item));
        return item;
      } catch {
        return `${item} (planned or not present yet)`;
      }
    }),
  );
}

const sections = [
  ["Goal", [area.goal]],
  ["Read", await annotate(area.docs)],
  ["Likely code", await annotate(area.code)],
  ["Tests as specification", await annotate(area.tests)],
  ["Invariants", area.invariants],
  ["Focused validation", area.validate],
  ["Do not read", shared.avoid],
  ["Working rules", shared.rules],
];

console.log(`# Task context: ${areaName}`);
for (const [heading, items] of sections) {
  console.log(`\n## ${heading}`);
  for (const item of items) console.log(`- ${item}`);
}
