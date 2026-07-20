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
      "src/app/waivers/[token]",
      "src/app/shop/[shopSlug]/waivers",
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
  certifications: {
    goal: "Build certification evidence and a fail-closed readiness result shared by staff, divers, and manifests.",
    docs: [
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/product/next-steps.md",
      "docs/design/principles.md",
      "docs/architecture/overview.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/readiness.ts",
      "src/lib/readiness.ts",
      "src/app/shop/[shopSlug]/divers/[personId]",
      "src/app/shop/[shopSlug]/trips/[id]",
    ],
    tests: ["src/lib/readiness.test.ts", "src/db/readiness.test.ts", "e2e"],
    invariants: [
      "Requirements and evidence are separate; missing configuration fails closed.",
      "Only verified, unexpired evidence at or above the required level can clear a diver.",
      "Every readiness blocker is typed and human-readable.",
      "Tenant-scope card capture, review, and readiness queries.",
    ],
    validate: [
      "pnpm test -- src/lib/readiness.test.ts src/db/readiness.test.ts --reporter=dot",
      "pnpm check",
      "pnpm e2e -- --reporter=line",
    ],
  },
  "rental-fit": {
    goal: "Maintain rental fit and the derived per-trip prep list (tanks, kit, nitrox split).",
    docs: [
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/product/next-steps.md",
      "docs/design/principles.md",
      "docs/architecture/overview.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/rental-fit.ts",
      "src/db/nitrox.ts",
      "src/lib/dive-prep.ts",
      "src/app/shop/[shopSlug]/trips/[id]/prep",
    ],
    tests: ["src/lib/dive-prep.test.ts", "src/db/nitrox.test.ts", "e2e/nitrox.spec.ts"],
    invariants: [
      "Scuba tracks no equipment inventory: a fit is a size record, never an allocation.",
      "One tank per diver per planned dive — the count is never short of the dive plan.",
      "A nitrox request requires a verified card at write time, and is re-checked on every read.",
      "A diver with no fit on file is named on the prep list, never silently omitted.",
    ],
    validate: [
      "pnpm test -- src/lib/dive-prep.test.ts --reporter=dot",
      "pnpm check",
      "pnpm e2e -- e2e/nitrox.spec.ts --reporter=line",
    ],
  },
  manifests: {
    goal: "Build M6 manifests and roll call from the shared fail-closed readiness result.",
    docs: [
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/product/next-steps.md",
      "docs/design/principles.md",
      "docs/architecture/overview.md",
      "docs/architecture/decisions/20260718-offline-manifest-snapshots.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/readiness.ts",
      "src/db/manifests.ts",
      "src/lib/readiness.ts",
      "src/lib/manifests.ts",
      "src/lib/offline-manifests.ts",
      "src/lib/offline-manifest-store.ts",
      "src/app/shop/[shopSlug]/trips/[id]/manifest",
      "src/app/offline-manifest",
    ],
    tests: [
      "src/db/readiness.test.ts",
      "src/db/manifests.test.ts",
      "src/lib/manifests.test.ts",
      "src/lib/offline-manifests.test.ts",
      "e2e/manifest.spec.ts",
    ],
    invariants: [
      "Every active booking is represented, including incomplete or blocked records.",
      "Readiness stays fail-closed and is never recomputed differently in the manifest UI.",
      "Boarding changes are explicit, time-stamped, tenant-scoped, and auditable.",
      "Offline copies are encrypted, explicit, freshness-labeled, expiring, and never an editable roster.",
      "Offline events are idempotent; live readiness is rechecked and newer server history wins.",
      "Departure and every after-dive checkpoint keep independent roll-call state.",
      "Phone/sunlight use requires large controls, text labels, and no color-only status.",
    ],
    validate: [
      "pnpm test -- src/db/readiness.test.ts src/db/manifests.test.ts src/lib/manifests.test.ts src/lib/offline-manifests.test.ts --reporter=dot",
      "pnpm check",
      "pnpm e2e -- --reporter=line",
    ],
  },
  nitrox: {
    goal: "Build M7 nitrox fill logging with a verified-card gate and a derived, fail-closed MOD.",
    docs: [
      "docs/product/roadmap.md",
      "docs/product/glossary.md",
      "docs/product/human-decisions.md",
      "docs/design/principles.md",
    ],
    code: [
      "src/db/schema.ts",
      "src/db/nitrox.ts",
      "src/db/nitrox.test.ts",
      "src/lib/nitrox.ts",
      "src/app/shop/[shopSlug]/trips/[id]/nitrox",
    ],
    tests: ["src/lib/nitrox.test.ts", "src/db/nitrox.test.ts", "e2e"],
    invariants: [
      "Only a verified nitrox card lets a diver receive an EANx fill; the gate is enforced at write time.",
      "Only a valid recreational EANx mix (22–40% O2) is accepted; out-of-band values fail closed.",
      "MOD is derived from the mix and ppO2 ceiling, never taken from the caller.",
      "Tenant-scope every card, tank, and fill; a fill is append-only evidence.",
      "Nitrox is a safety-critical surface — it needs a dive-domain-expert review (V-05).",
    ],
    validate: [
      "pnpm test -- src/lib/nitrox.test.ts src/db/nitrox.test.ts --reporter=dot",
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
      "src/db/trips.ts",
      "src/db/shops.ts",
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
      "src/app/shop/[shopSlug]/schedule",
      "src/app/shop/[shopSlug]/trips",
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
