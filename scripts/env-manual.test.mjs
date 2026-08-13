import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];
const workspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "diveday-manual-"));
  directories.push(directory);
  return directory;
};
const envManual = (cwd) =>
  spawnSync("node", [join(process.cwd(), "scripts", "env-manual.mjs")], {
    cwd,
    encoding: "utf8",
  });

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("env-manual", () => {
  it("lifts the values only a human can supply out of a pre-split .env.local", () => {
    // The one-time migration. Nobody should have to re-paste a Stripe key
    // because the file it lived in changed name.
    const cwd = workspace();
    writeFileSync(
      join(cwd, ".env.local"),
      [
        "STRIPE_SECRET_KEY=sk_from_1password",
        "DATABASE_URL=postgres://neon/db",
        "PLACES_AWS_ACCESS_KEY_ID=AKIA_TYPED_BY_HAND",
        "",
      ].join("\n"),
    );

    const run = envManual(cwd);
    const manual = readFileSync(join(cwd, ".env.manual"), "utf8");

    expect(run.status).toBe(0);
    expect(manual).toContain("STRIPE_SECRET_KEY=sk_from_1password");
    expect(manual).toContain("DATABASE_URL=postgres://neon/db");
    // The hand-typed credential is left behind: the stack produces it, and this
    // file is not allowed to hold a second opinion about one.
    expect(manual).not.toContain("AKIA_TYPED_BY_HAND");
  });

  // The case that lived here covered a checked-in constant being carried into
  // .env.manual only when it differed from the default. There are no checked-in
  // constants any more -- DiveDay's own origin, sender, Connect client id and
  // Sentry DSN moved into the code that reads them (src/lib/configured.ts) --
  // so .env.manual carries exactly the manual keys, which the cases around
  // this one already cover.

  it("is idempotent, and never overwrites a value already set", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, ".env.manual"), "STRIPE_SECRET_KEY=sk_mine\n");

    envManual(cwd);
    const once = readFileSync(join(cwd, ".env.manual"), "utf8");
    envManual(cwd);
    const twice = readFileSync(join(cwd, ".env.manual"), "utf8");

    expect(once).toBe(twice);
    expect(twice).toContain("STRIPE_SECRET_KEY=sk_mine");
    // A key added to the registry since arrives blank rather than missing.
    expect(twice).toMatch(/^META_APP_ID=$/m);
  });

  it("scaffolds every manual key and nothing else", () => {
    const cwd = workspace();
    envManual(cwd);
    const manual = readFileSync(join(cwd, ".env.manual"), "utf8");

    expect(manual).toMatch(/^DATABASE_URL=$/m);
    expect(manual).toMatch(/^USAGE_NEON_ORG_ID=$/m);
    // Nothing minted, derived, or constant appears until someone overrides it.
    expect(manual).not.toMatch(/^PLACES_AWS_ACCESS_KEY_ID=/m);
    expect(manual).not.toMatch(/^AUTH_SECRET=/m);
    expect(manual).not.toMatch(/^APP_HOST=/m);
  });
});
