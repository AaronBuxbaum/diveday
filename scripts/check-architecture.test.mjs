import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditBaseline, collectViolations, importsOf } from "./check-architecture.mjs";

// ---------------------------------------------------------------------------
// Throwaway trees shaped like the repo, because the thing under test is
// precisely "what does the scanner see on disk". Each helper writes one file
// into a fresh tmpdir root and hands the root to `collectViolations`.

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "check-architecture-"));
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents);
  }
  return root;
}

const flat = (violations) => [...violations.values()].flat();

describe("dependency direction", () => {
  it("catches a bare side-effect import — the ARCH-2 blind spot", async () => {
    // `import "@/app/x"` binds no name, so the original `from|import(|require(`
    // pattern never saw it. This is the regression probe for that fix.
    const root = await fixture({
      "src/lib/boot.ts": 'import "@/app/globals-side-effect";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      "src/lib/boot.ts: imports @/app/globals-side-effect",
    ]);
  });

  it("still catches the named, dynamic, and re-export forms", async () => {
    const root = await fixture({
      "src/lib/a.ts": 'import { x } from "@/features/crew-and-boats/calendar-sync";\n',
      "src/db/b.ts": 'const m = await import("@/app/actions/demo");\n',
      "src/db/c.ts": 'export * from "../app/page";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      "src/db/b.ts: imports @/app/actions/demo",
      "src/db/c.ts: imports ../app/page",
      "src/lib/a.ts: imports @/features/crew-and-boats/calendar-sync",
    ]);
  });

  it("holds src/components and src/i18n to the direction too", async () => {
    const root = await fixture({
      "src/components/Nav.tsx": 'import { act } from "@/app/actions/demo";\n',
      "src/i18n/labels.ts": 'import { Button } from "@/components/ui/button";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      "src/components/Nav.tsx: imports @/app/actions/demo",
      "src/i18n/labels.ts: imports @/components/ui/button",
    ]);
  });

  it("lets the allowed directions through", async () => {
    const root = await fixture({
      "src/components/Card.tsx": 'import { fmt } from "@/lib/format";\nimport t from "@/i18n/x";\n',
      "src/i18n/negotiate.ts": 'import { getDb } from "@/lib/clock";\n',
      "src/lib/format.ts": 'import path from "node:path";\nimport "./polyfill";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });
});

describe("the seams", () => {
  it("reads which imports are type-only, across lines", () => {
    const source = [
      'import type { A } from "@/db/a";',
      'import { type B, type C } from "@/db/b";',
      'import { type D, e } from "@/db/d";',
      "import {\n  type F,\n  g,\n} from '@/db/f';",
      'export type { H } from "@/db/h";',
      'export { i } from "@/db/i";',
      'import "@/db/side-effect";',
      'const j = await import("@/db/j");',
    ].join("\n");
    expect(importsOf(source)).toEqual([
      { specifier: "@/db/a", typeOnly: true },
      { specifier: "@/db/b", typeOnly: true },
      { specifier: "@/db/d", typeOnly: false },
      { specifier: "@/db/f", typeOnly: false },
      { specifier: "@/db/h", typeOnly: true },
      { specifier: "@/db/i", typeOnly: false },
      { specifier: "@/db/side-effect", typeOnly: false },
      { specifier: "@/db/j", typeOnly: false },
    ]);
  });

  it("lets src/lib name a db type and refuses a db value", async () => {
    const root = await fixture({
      "src/lib/shape.ts": 'import type { AppDb } from "@/db/client";\n',
      "src/lib/loader.ts": 'import { getDb } from "@/db/client";\n',
      "src/lib/lazy.ts": 'const m = await import("../db/recap");\n',
      "src/lib/loader.test.ts": 'import { createTestDb } from "@/db/client";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/lib/lazy.ts: value-imports ../db/recap"),
      expect.stringContaining("src/lib/loader.ts: value-imports @/db/client"),
    ]);
  });

  it("refuses a translator in src/lib and src/db, but lets a type and the message senders through", async () => {
    const root = await fixture({
      "src/lib/worded.ts": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
      "src/lib/typed.ts": 'import type { StaffTranslator } from "@/i18n/staff-messages";\n',
      "src/lib/notifications/email.ts":
        'import { staffTranslator } from "@/i18n/staff-messages";\n',
      "src/lib/worded.test.ts": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
      "src/db/sender.ts": 'import { messagesFor } from "../i18n/messages";\n',
      "src/components/Page.tsx": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/db/sender.ts: value-imports ../i18n/messages"),
      expect.stringContaining("src/lib/worded.ts: value-imports @/i18n/staff-messages"),
    ]);
  });

  it("refuses drizzle-orm under src/app, outside its tests and e2e fixture routes", async () => {
    const root = await fixture({
      "src/app/shop/actions.ts": 'import { eq } from "drizzle-orm";\n',
      "src/app/shop/types.ts": 'import type { SQL } from "drizzle-orm/sql";\n',
      "src/app/shop/actions.test.ts": 'import { eq } from "drizzle-orm";\n',
      "src/app/api/test/seed/route.ts": 'import { eq } from "drizzle-orm";\n',
      "src/db/reads.ts": 'import { eq } from "drizzle-orm";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/app/shop/actions.ts: imports drizzle-orm"),
      expect.stringContaining("src/app/shop/types.ts: imports drizzle-orm/sql"),
    ]);
  });

  it("refuses a drizzle-orm value under src/lib and lets the type through", async () => {
    const root = await fixture({
      "src/lib/ledger.ts": 'import { eq } from "drizzle-orm";\n',
      "src/lib/shapes.ts": 'import type { SQL } from "drizzle-orm";\n',
      "src/lib/ledger.test.ts": 'import { eq } from "drizzle-orm";\n',
      "src/db/ledger.ts": 'import { eq } from "drizzle-orm";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining("src/lib/ledger.ts: value-imports drizzle-orm"),
    ]);
  });

  it("refuses a translator value under src/db and lets the key type through", async () => {
    const root = await fixture({
      "src/db/words.ts": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
      "src/db/diver-words.ts": 'import { diverTranslator } from "@/i18n/messages";\n',
      "src/db/keys.ts": 'import type { StaffMessageKey } from "@/i18n/staff-messages";\n',
      "src/db/words.test.ts": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
      "src/app/words.ts": 'import { staffTranslator } from "@/i18n/staff-messages";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/db/diver-words.ts: value-imports @/i18n/messages"),
      expect.stringContaining("src/db/words.ts: value-imports @/i18n/staff-messages"),
    ]);
  });

  it("sends everything outside src/db through the trips barrel", async () => {
    const root = await fixture({
      "src/app/trip/page.tsx": 'import { getTripRecord } from "@/db/trips-record";\n',
      "src/components/Roster.tsx": 'import type { TripRoster } from "@/db/trips-manifest";\n',
      "src/app/trip/ok.tsx": 'import { getTripRecord } from "@/db/trips";\n',
      "src/app/trip/reader.tsx": 'import { getTripOverview } from "@/db/trip-overview";\n',
      "src/db/today.ts": 'import { listStaff } from "./trips-crew";\n',
      "src/app/trip/other.tsx": 'import { x } from "@/db/trip-promos";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/app/trip/page.tsx: imports @/db/trips-record"),
      expect.stringContaining("src/components/Roster.tsx: imports @/db/trips-manifest"),
    ]);
  });
});

describe("an index is a door", () => {
  it("refuses a file past the index of any src/lib or src/db directory that has one", async () => {
    const root = await fixture({
      "src/lib/storage/index.ts": "export const upload = 1;\n",
      "src/lib/storage/limits.ts": "export const MAX = 1;\n",
      "src/lib/storage/s3.ts": 'import { MAX } from "./limits";\n',
      "src/app/page.tsx": 'import { MAX } from "@/lib/storage/limits";\n',
      "src/components/Ok.tsx":
        'import { upload } from "@/lib/storage";\nimport { x } from "@/lib/storage/index";\n',
      "src/db/schema/index.ts": "export {};\n",
      "src/db/schema/people.ts": "export {};\n",
      "src/lib/other.ts": 'import type { P } from "@/db/schema/people";\n',
      "src/db/seed/index.ts": 'export { bringHome } from "./boat-at-sea";\n',
      "src/db/seed/boat-at-sea.ts": "export const bringHome = 1;\n",
      "src/db/demo-refresh.ts": 'import { bringHome } from "./seed/boat-at-sea";\n',
      "src/features/tick.ts": 'import { bringHome } from "@/db/seed";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining(
        'src/app/page.tsx: imports @/lib/storage/limits \u2014 src/lib/storage is a module, reach it through "@/lib/storage"',
      ),
      expect.stringContaining(
        'src/db/demo-refresh.ts: imports ./seed/boat-at-sea \u2014 src/db/seed is a module, reach it through "@/db/seed"',
      ),
      expect.stringContaining("src/lib/other.ts: imports @/db/schema/people"),
    ]);
  });

  it("leaves a directory with no index alone, and exempts tests", async () => {
    const root = await fixture({
      "src/lib/plain/a.ts": "export const a = 1;\n",
      "src/app/page.tsx": 'import { a } from "@/lib/plain/a";\n',
      "src/lib/door/index.ts": "export {};\n",
      "src/lib/door/inner.ts": "export const inner = 1;\n",
      "src/app/page.test.tsx": 'import { inner } from "@/lib/door/inner";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });
});

describe("feature areas and concept doors", () => {
  const area = {
    "src/features/crew-and-boats/README.md": "# crew and boats\n",
    "src/features/crew-and-boats/calendar-sync/index.ts": "export {};\n",
    "src/features/crew-and-boats/calendar-sync/internal.ts": 'import { x } from "./feed";\n',
    "src/features/crew-and-boats/calendar-sync/feed.ts": "export const x = 1;\n",
    "src/features/crew-and-boats/boats.ts": "export const boats = 1;\n",
    "src/features/crew-and-boats/boats.test.ts": "export {};\n",
  };
  // Specifiers are split so the real scanner (which walks scripts/ too) doesn't read these
  // fixture strings as imports of its own.
  const features = "@/features";

  it("flags a deep import even in side-effect form", async () => {
    const root = await fixture({
      ...area,
      "src/app/page.tsx": `import "${features}/crew-and-boats/calendar-sync/internal";\n`,
    });
    expect(flat(await collectViolations(root))).toEqual([
      `src/app/page.tsx: deep-imports ${features}/crew-and-boats/calendar-sync/internal — go through its door, "${features}/crew-and-boats/calendar-sync"`,
    ]);
  });

  it("opens a folder's index and a one-file concept, by alias, relative path or explicit extension", async () => {
    const root = await fixture({
      ...area,
      "src/app/page.tsx": [
        `import { a } from "${features}/crew-and-boats/calendar-sync";`,
        `import { b } from "${features}/crew-and-boats/calendar-sync/index";`,
        `import { c } from "${features}/crew-and-boats/boats";`,
        "",
      ].join("\n"),
      "scripts/boats.mjs": 'import { boats } from "../src/features/crew-and-boats/boats.ts";\n',
      // A sibling concept in the same area goes through the door too, relative or not.
      "src/features/crew-and-boats/crew.ts": 'import { x } from "./calendar-sync";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });

  it("holds the door between concepts of one area", async () => {
    const root = await fixture({
      ...area,
      "src/features/crew-and-boats/crew.ts": 'import { x } from "./calendar-sync/feed";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      `src/features/crew-and-boats/crew.ts: deep-imports ./calendar-sync/feed — go through its door, "${features}/crew-and-boats/calendar-sync"`,
    ]);
  });

  it("refuses an import of a bare area, which has no door", async () => {
    const root = await fixture({
      ...area,
      "src/app/page.tsx": `import "${features}/crew-and-boats";\n`,
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining(
        `src/app/page.tsx: imports ${features}/crew-and-boats — an area has no door`,
      ),
    ]);
  });

  it("requires a README per area and an index per concept folder, and no loose concept", async () => {
    const root = await fixture({
      "src/features/thing.ts": "export const x = 1;\n",
      "src/features/bare/concept/thing.ts": "export const x = 1;\n",
      "src/features/bare/one.ts": "export const one = 1;\n",
    });
    const violations = await collectViolations(root);
    expect([...violations.keys()].sort()).toEqual([
      "src/features/bare",
      "src/features/bare/concept",
      "src/features/thing.ts",
    ]);
    expect(violations.get("src/features/bare")).toEqual([
      expect.stringContaining("missing README.md"),
    ]);
    expect(violations.get("src/features/bare/concept")).toEqual([
      expect.stringContaining("missing index.ts"),
    ]);
  });
});

describe("the ratchet", () => {
  const violations = new Map([
    ["src/components/A.tsx", ["src/components/A.tsx: imports @/app/x"]],
    [
      "src/components/B.tsx",
      ["src/components/B.tsx: imports @/app/x", "src/components/B.tsx: imports @/app/y"],
    ],
  ]);

  it("is silent when the baseline matches reality", () => {
    expect(
      auditBaseline(violations, { "src/components/A.tsx": 1, "src/components/B.tsx": 2 }),
    ).toEqual([]);
  });

  it("fails a file with no baseline entry, listing the imports", () => {
    const failures = auditBaseline(violations, { "src/components/B.tsx": 2 });
    expect(failures).toEqual(["src/components/A.tsx: imports @/app/x"]);
  });

  it("fails a count that rose", () => {
    const failures = auditBaseline(violations, {
      "src/components/A.tsx": 1,
      "src/components/B.tsx": 1,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("baseline allows 1");
  });

  it("fails an unbanked reduction and a stale entry, so the baseline tracks reality", () => {
    const failures = auditBaseline(violations, {
      "src/components/A.tsx": 1,
      "src/components/B.tsx": 3,
      "src/components/Gone.tsx": 1,
    });
    expect(failures.some((f) => f.includes("down to 2 from 3"))).toBe(true);
    expect(failures.some((f) => f.includes("Gone.tsx: clean or gone"))).toBe(true);
  });
});

describe("server-only modules stay out of client bundles", () => {
  it("keeps partner OAuth credentials and clients out of browser bundles", async () => {
    const root = await fixture({
      "src/features/after-the-dive/logbook-connections/index.ts":
        "export const logbookProvider = 1; export type Config = string;",
      "src/features/after-the-dive/README.md": "# after the dive",
      "src/app/Form.tsx":
        '"use client";\nimport { logbookProvider } from "@/features/after-the-dive/logbook-connections";',
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining(
        "reaches server-only src/features/after-the-dive/logbook-connections/index.ts",
      ),
    ]);
  });

  const phone = 'import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";\n';
  it("keeps the full computer-file decoder out of CSV setup client bundles", async () => {
    const root = await fixture({
      "src/lib/computer-import/index.ts":
        "export const inspect = () => []; export type Mapping = string;",
      "src/app/Form.tsx": '"use client";\nimport { inspect } from "@/lib/computer-import";',
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining("reaches server-only src/lib/computer-import/index.ts"),
    ]);
  });
  it("permits computer-import types and a browser-safe CSV header primitive", async () => {
    const root = await fixture({
      "src/lib/computer-import/index.ts":
        "export const inspect = () => []; export type Mapping = string;",
      "src/lib/computer-csv-columns.ts": "export const inspectComputerCsvColumns = () => [];",
      "src/app/Form.tsx":
        '"use client";\nimport type { Mapping } from "@/lib/computer-import";\nimport { inspectComputerCsvColumns } from "@/lib/computer-csv-columns";',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });

  for (const [feature, file] of [
    ["messages/phone-line-type", "../phone-line-type.ts"],
    ["money/payments", "webhook.ts"],
  ]) {
    // A one-file concept is its own door; a folder concept publishes through its index.
    const folder = !file.startsWith("../");
    const contract = {
      [`src/features/${feature.split("/")[0]}/README.md`]: "Server-side feature fixture.",
      ...(folder
        ? {
            [`src/features/${feature}/index.ts`]: `export { sensitive } from "./${file.slice(0, -3)}";\nexport type { Secret } from "./${file.slice(0, -3)}";`,
            [`src/features/${feature}/${file}`]:
              "export const sensitive = 1; export type Secret = string;",
          }
        : {
            [`src/features/${feature}.ts`]:
              "export const sensitive = 1; export type Secret = string;",
          }),
    };
    const reached = folder ? `src/features/${feature}/${file}` : `src/features/${feature}.ts`;
    it(`refuses the ${feature} public index even without a transitive package dependency`, async () => {
      const root = await fixture({
        ...contract,
        "src/app/Form.tsx": `"use client";\nimport { sensitive } from "@/features/${feature}";`,
      });
      expect(flat(await collectViolations(root))).toEqual([
        expect.stringContaining(`reaches server-only ${reached}`),
      ]);
    });

    it(`leaves ${feature} types and use-server action stubs out of the browser graph`, async () => {
      const root = await fixture({
        ...contract,
        "src/app/actions.ts": `"use server";\nimport { sensitive } from "@/features/${feature}";`,
        "src/app/Form.tsx": `"use client";\nimport { act } from "@/app/actions";\nimport type { Secret } from "@/features/${feature}";`,
      });
      expect(flat(await collectViolations(root))).toEqual([]);
    });
  }

  it("refuses a use-client file that reaches line-type metadata through a helper", async () => {
    const root = await fixture({
      "src/lib/phone-line-type.ts": phone,
      "src/app/Form.tsx":
        '"use client";\nimport { canReceiveText } from "@/lib/phone-line-type";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining(
        'src/app/Form.tsx: a "use client" file reaches server-only libphonenumber-js/mobile',
      ),
    ]);
  });

  it("follows the chain through a helper and through the package itself", async () => {
    const root = await fixture({
      "src/lib/phone-line-type.ts": phone,
      "src/lib/delivery.ts": 'import { canReceiveText } from "./phone-line-type";\n',
      "src/app/A.tsx": '"use client";\nimport { x } from "@/lib/delivery";\n',
      "src/app/B.tsx": '"use client";\nimport { parse } from "libphonenumber-js/max";\n',
    });
    const violations = await collectViolations(root);
    expect([...violations.keys()].sort()).toEqual(["src/app/A.tsx", "src/app/B.tsx"]);
  });

  it("stops at a use-server module, which the browser gets as a call stub", async () => {
    const root = await fixture({
      "src/lib/payments/stripe-client.ts": "export const stripe = 1;\n",
      "src/lib/payments/checkout.ts": 'import { stripe } from "./stripe-client";\n',
      "src/app/actions.ts": '"use server";\nimport { x } from "@/lib/payments/checkout";\n',
      "src/app/Form.tsx": '"use client";\nimport { act } from "@/app/actions";\n',
      "src/app/Leaky.tsx": '"use client";\nimport { x } from "@/lib/payments/checkout";\n',
    });
    expect([...(await collectViolations(root)).keys()]).toEqual(["src/app/Leaky.tsx"]);
  });

  it("leaves alone a server file, a type-only import and a clean client file", async () => {
    const root = await fixture({
      "src/lib/phone-line-type.ts": phone,
      "src/lib/phone.ts": "export const CALLING_CODES = {};\n",
      "src/app/actions.ts":
        '"use server";\nimport { canReceiveText } from "@/lib/phone-line-type";\n',
      "src/app/Types.tsx":
        '"use client";\nimport type { canReceiveText } from "@/lib/phone-line-type";\nimport { CALLING_CODES } from "@/lib/phone";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });
});

describe("a staff page reads through one reader", () => {
  it("refuses a staff page that value-imports a second db module", async () => {
    const root = await fixture({
      "src/app/shop/[shopSlug]/orders/page.tsx":
        'import { getOrdersIndex } from "@/db/orders-index";\nimport { canPersonManageOrders } from "@/db/authz";\n',
      "src/app/shop/[shopSlug]/boats/page.tsx":
        'import { getBoatsPage } from "@/db/boats-page";\nimport type { Boat } from "@/db/boats";\n',
      "src/app/shop/[shopSlug]/boats/actions.ts":
        'import { editBoat } from "@/db/boats";\nimport { canPersonConfigureTrips } from "@/db/authz";\n',
      "src/app/s/[shopSlug]/page.tsx": 'import { a } from "@/db/a";\nimport { b } from "@/db/b";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining(
        "src/app/shop/[shopSlug]/orders/page.tsx: reads @/db/authz, @/db/orders-index",
      ),
    ]);
  });
});

describe("a table module writes by transition", () => {
  it("refuses an exported update or save in src/db and nothing else", async () => {
    const root = await fixture({
      "src/db/boats.ts":
        "export async function updateBoat() {}\nexport function saveBoatNote() {}\nexport async function editBoat() {}\nfunction updateLocal() {}\n",
      "src/db/boats.test.ts": "export async function updateBoat() {}\n",
      "src/lib/boats.ts": "export function updateBoat() {}\n",
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/db/boats.ts: exports saveBoatNote"),
      expect.stringContaining("src/db/boats.ts: exports updateBoat"),
    ]);
  });
});

describe("runtime boundaries after concept migration", () => {
  it("keeps exact integration-test subjects outside runtime dependency direction", async () => {
    const root = await fixture({
      "src/features/boarding/check-in/index.ts": 'export { read } from "./store";',
      "src/features/boarding/README.md": "# boarding",
      "src/features/boarding/check-in/store.ts": "export const read = () => 1;",
      "src/db/counter.test.ts": 'import { read } from "@/features/boarding/check-in/store";',
      "src/test/fixture.ts": 'import { read } from "@/features/boarding/check-in/store";',
      "src/db/production.ts": 'import { read } from "@/features/boarding/check-in";',
      "src/app/page.tsx": 'import { read } from "@/features/boarding/check-in/store";',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/app/page.tsx: deep-imports"),
      "src/db/production.ts: imports @/features/boarding/check-in",
    ]);
  });

  it("leaves pure feature state transformations outside table-write naming", async () => {
    const root = await fixture({
      "src/features/trips/README.md": "# trips",
      "src/features/trips/selection.ts": "export function updateSelection() {}",
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });

  it("keeps transition naming on a moved feature store", async () => {
    const root = await fixture({
      "src/features/trips/README.md": "# trips",
      "src/features/trips/notes/index.ts": 'export { saveNote } from "./store";',
      "src/features/trips/notes/store.ts": "export function saveNote() {}",
    });
    expect(flat(await collectViolations(root))).toEqual([
      expect.stringContaining("src/features/trips/notes/store.ts: exports saveNote"),
    ]);
  });
});

it("allows a native Node import of a concept folder's explicit index", async () => {
  const root = await fixture({
    "src/features/day/README.md": "# day",
    "src/features/day/world/index.ts": 'export { states } from "./rules";',
    "src/features/day/world/rules.ts": "export const states = [];",
    "scripts/states.mjs": 'import { states } from "../src/features/day/world/index.ts";',
  });
  expect(flat(await collectViolations(root))).toEqual([]);
});
