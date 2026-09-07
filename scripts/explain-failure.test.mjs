import { describe, expect, it } from "vitest";

import { explanationFor, SIGNATURES } from "./explain-failure.mjs";

/**
 * A signpost is only useful if it points somewhere: every answer names a skill, a script, an
 * ADR, or a command. And it is only tolerable if it stays silent for the ordinary failure,
 * which is nearly all of them.
 */

describe("the written answers", () => {
  it("recognises the failures the debug skill already explains", () => {
    expect(
      explanationFor("pnpm dev", "⨯ Another next dev server is already running at .next/dev/lock"),
    ).toMatch(/\.next\/dev\/lock/);
    expect(explanationFor("pnpm build", ".pglite is already open by process 4242")).toMatch(
      /data-dir-lock/,
    );
    expect(
      explanationFor("pnpm build", "Error: blocking-prerender-dynamic at /shop/[shopSlug]"),
    ).toMatch(/instant-navigation/);
    expect(explanationFor("curl localhost:3000", "connect ECONNREFUSED 127.0.0.1:3000")).toMatch(
      /OOM/,
    );
    expect(
      explanationFor("pnpm test src/db/x.test.ts", 'relation "gear_items" does not exist'),
    ).toMatch(/db:generate/);
  });

  it("every answer points at something a session can open or run", () => {
    for (const { explain } of SIGNATURES) {
      expect(explain).toMatch(/skill|scripts\/|ADR|src\/|`pnpm |`node /);
    }
  });
});

describe("staying quiet", () => {
  it("says nothing for an ordinary failure", () => {
    expect(explanationFor("pnpm typecheck", "src/x.ts(3,1): error TS2322")).toBeNull();
    expect(explanationFor("ls /nope", "ls: cannot access '/nope'")).toBeNull();
    expect(explanationFor(undefined, undefined)).toBeNull();
  });

  it("says nothing on top of a guard's own refusal, which already explained itself", () => {
    expect(
      explanationFor(
        "pnpm dev",
        "Refused by scripts/guard-bash.mjs: Another next dev server is already running",
      ),
    ).toBeNull();
  });
});
