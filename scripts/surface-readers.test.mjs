import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf, resolveSpecifier } from "./check-architecture.mjs";
import { surfaceReaders } from "./surface-readers.mjs";

async function readers(page, files) {
  const root = await mkdtemp(path.join(tmpdir(), "surface-readers-"));
  files = { ...files, "src/app/shop/example/page.tsx": page };
  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return [
    ...(await surfaceReaders(root, "src/app/shop/example/page.tsx", {
      importsOf,
      resolveSpecifier,
    })),
  ].sort();
}

const mixed = {
  "src/features/trips/example/index.ts":
    'export { read as surface } from "./store";\nexport { choice } from "./rules";\nexport type { Shape } from "./store";',
  "src/features/trips/example/store.ts": "export const read = () => 1; export type Shape = string;",
  "src/features/trips/example/rules.ts": "export const choice = 1;",
};

describe("staff surface readers across feature contracts", () => {
  it("counts a selected store export but leaves a pure export from the same index alone", async () => {
    expect(await readers('import { surface } from "@/features/trips/example";', mixed)).toEqual([
      "@/features/trips/example",
    ]);
    expect(await readers('import { choice } from "@/features/trips/example";', mixed)).toEqual([]);
    expect(await readers('import { type Shape } from "@/features/trips/example";', mixed)).toEqual(
      [],
    );
  });

  it("retains direct DB reads and catches a second surface after migration", async () => {
    expect(
      await readers(
        'import { read } from "@/db/first";\nimport { surface } from "@/features/trips/example";',
        mixed,
      ),
    ).toEqual(["@/db/first", "@/features/trips/example"]);
  });

  it("counts a facade as one surface even when its stores compose several readers", async () => {
    const files = {
      ...mixed,
      "src/features/trips/example/index.ts": 'export { surface } from "./page.store";',
      "src/features/trips/example/page.store.ts":
        'import { read } from "@/db/first";\nimport { other } from "@/db/second";\nexport const surface = () => read() + other();',
    };
    expect(await readers('import { surface } from "@/features/trips/example";', files)).toEqual([
      "@/features/trips/example",
    ]);
  });

  it("follows named aliases and old indexes, with type-only data contracts remaining pure", async () => {
    const files = {
      ...mixed,
      "src/features/trips/example/index.ts":
        'export { load as surface } from "./loader";\nexport { choice } from "./rules";',
      "src/features/trips/example/loader.ts":
        'import { getDb } from "@/db/client";\nexport const load = () => getDb();',
      "src/features/trips/example/rules.ts":
        'import type { AppDb } from "@/db/client";\nexport const choice = 1;',
    };
    expect(
      await readers(
        'import "./styles";\nimport { surface as data } from "@/features/trips/example";',
        files,
      ),
    ).toEqual(["@/features/trips/example"]);
    expect(await readers('import { choice } from "@/features/trips/example";', files)).toEqual([]);
  });

  it("treats namespace consumption conservatively and handles export cycles", async () => {
    expect(
      await readers('import { choice } from "@/features/trips/example";', {
        ...mixed,
        "src/features/trips/example/index.ts": 'export * from "./rules";\nexport * from "./store";',
      }),
    ).toEqual([]);
    expect(await readers('import * as example from "@/features/trips/example";', mixed)).toEqual([
      "@/features/trips/example",
    ]);
    expect(
      await readers('import { choice } from "@/features/trips/example";', {
        "src/features/trips/example/index.ts": 'export * from "./cycle";',
        "src/features/trips/example/cycle.ts": 'export * from "./index";',
      }),
    ).toEqual([]);
  });
});

it("keeps the named live session gate beside one surface reader", async () => {
  expect(
    await readers(
      'import { requireShopSurface } from "@/features/accounts/session";\nimport { surface } from "@/features/trips/example";',
      {
        ...mixed,
        "src/features/accounts/session.ts":
          'import { roles } from "@/db/authz";\nexport function requireShopSurface() { return roles(); }',
      },
    ),
  ).toEqual(["@/features/trips/example"]);
  // Naming an unrelated store export after the gate does not exempt that reader.
  expect(
    await readers('import { requireShopSurface } from "@/features/accounts/imposter";', {
      "src/features/accounts/imposter/index.ts": 'export { requireShopSurface } from "./store";',
      "src/features/accounts/imposter/store.ts": "export function requireShopSurface() {}",
    }),
  ).toEqual(["@/features/accounts/imposter"]);
});
