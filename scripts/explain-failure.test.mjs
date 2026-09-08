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

  /**
   * The bystander. Unlike every other signature here it does not describe the
   * failure — it rides along in a passing-or-failing e2e run's output and looks
   * far more alarming than it is (issue 1560), so the answer's whole job is to
   * send the reader back to the real failure rather than into React's internals.
   */
  it("names the stream-cancel line as a bystander, not a cause", () => {
    const explanation = explanationFor(
      "pnpm e2e e2e/gear.spec.ts",
      "[WebServer] ⨯ Error: The destination stream closed early.\n  digest: '843112864'",
    );
    expect(explanation).toMatch(/not your failure/i);
    expect(explanation).toMatch(/Look elsewhere/);
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
