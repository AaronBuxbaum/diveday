import { describe, expect, it } from "vitest";
import { classifyDatabaseFailure } from "./db-failure";

/**
 * The shape a real failure arrives in, pinned from an observed one.
 *
 * `publicRouteLookup(db, { kind: "shop", shopSlug: "a\0b" })` — the request
 * `/s/a%00b` makes — throws exactly this against PGlite: a `DrizzleQueryError`
 * whose message is the SQL plus the bound parameters, wrapping the driver's
 * own error, which is where the SQLSTATE lives. The classifier reads the chain
 * because of this; a version that looked only at the thrown error would find no
 * code and call every one of these an outage.
 */
function drizzleWrapped(code: string, message: string): Error {
  const driver = Object.assign(new Error(message), { code });
  // The parameter is built rather than typed: `pnpm check:repo` refuses a NUL
  // byte in a source file, and this one is the whole point of the example.
  const slug = `a${String.fromCharCode(0)}b`;
  return new Error(
    `Failed query: select "id" from "shops" where "shops"."slug" = $1\nparams: ${slug},1`,
    { cause: driver },
  );
}

describe("classifyDatabaseFailure", () => {
  it.each([
    // The observed one: `/s/a%00b`, class 22, data exception. A value the
    // caller sent, so nothing of ours is wrong — and one request per attacker
    // keystroke must not page.
    ["22021", 'invalid byte sequence for encoding "UTF8": 0x00'],
    // A second class-22 code, so a later simplification that re-broadens this
    // branch back out to "a server answered" fails rather than passing
    // quietly: the quiet half is the class, not a list of codes.
    ["22P05", 'character with byte sequence 0x81 in encoding "WIN1252" has no equivalent'],
  ])("reads %s as the caller's own bytes, at the code the server gave", (code, message) => {
    expect(classifyDatabaseFailure(drizzleWrapped(code, message))).toEqual({
      alarming: false,
      code,
    });
  });

  it.each([
    ["08006", "connection failure"],
    ["53300", "too many connections"],
    ["57P01", "terminating connection due to administrator command"],
    ["58030", "could not write to file"],
  ])("reads %s as the server failing about itself", (code, message) => {
    expect(classifyDatabaseFailure(drizzleWrapped(code, message))).toEqual({
      alarming: true,
      code,
    });
  });

  it.each([
    // Our own `DATABASE_URL`, rotated or mis-synced. No bound parameter can
    // produce it, and it takes the edge existence check back to fail-open soft
    // 404s for every diver — which used to be a `warn` line no metric counted
    // (issue #1750).
    ["28P01", "password authentication failed for user"],
    ["3D000", 'database "diveday" does not exist'],
    ["42501", 'permission denied for table "shops"'],
    ["42P01", 'relation "shops" does not exist'],
    ["25006", "cannot execute SELECT in a read-only transaction"],
  ])("reads %s as our own deployment being wrong", (code, message) => {
    expect(classifyDatabaseFailure(drizzleWrapped(code, message))).toEqual({
      alarming: true,
      code,
    });
  });

  it("reads a socket error that never reached a server as ours", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    expect(classifyDatabaseFailure(refused)).toEqual({
      alarming: true,
      code: "ECONNREFUSED",
    });
  });

  it.each([
    ["an error carrying no code at all", new Error("socket hang up")],
    ["something that is not an error", "boom"],
    ["nothing", undefined],
  ])("errs toward the alarm for %s", (_label, thrown) => {
    expect(classifyDatabaseFailure(thrown)).toEqual({ alarming: true, code: "unknown" });
  });

  it("does not report a code it cannot vouch for the shape of", () => {
    // The reported code goes to CloudWatch unauthenticated. A SQLSTATE and a
    // Node errno are closed vocabularies; a `code` of any other shape is a
    // string of unknown provenance and is not passed through.
    const odd = Object.assign(new Error("nope"), { code: "not a code, a whole sentence" });
    expect(classifyDatabaseFailure(odd)).toEqual({ alarming: true, code: "unknown" });
  });

  it("stops walking a cause chain that points back at itself", () => {
    const looped = new Error("outer");
    (looped as { cause?: unknown }).cause = looped;
    expect(classifyDatabaseFailure(looped)).toEqual({ alarming: true, code: "unknown" });
  });
});
