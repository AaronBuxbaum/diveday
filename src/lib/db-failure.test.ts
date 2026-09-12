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
  it("reads a statement refusal as reachable, at the code the server gave", () => {
    // The observed one: `/s/a%00b`, class 22, data exception. A server answered,
    // so nothing is down — and one request per attacker keystroke must not page.
    const failure = classifyDatabaseFailure(
      drizzleWrapped("22021", 'invalid byte sequence for encoding "UTF8": 0x00'),
    );
    expect(failure).toEqual({ unreachable: false, code: "22021" });
  });

  it.each([
    ["08006", "connection failure"],
    ["53300", "too many connections"],
    ["57P01", "terminating connection due to administrator command"],
    ["58030", "could not write to file"],
  ])("reads %s as the server failing about itself", (code, message) => {
    expect(classifyDatabaseFailure(drizzleWrapped(code, message))).toEqual({
      unreachable: true,
      code,
    });
  });

  it("reads a socket error that never reached a server as unreachable", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    expect(classifyDatabaseFailure(refused)).toEqual({
      unreachable: true,
      code: "ECONNREFUSED",
    });
  });

  it.each([
    ["an error carrying no code at all", new Error("socket hang up")],
    ["something that is not an error", "boom"],
    ["nothing", undefined],
  ])("errs toward the alarm for %s", (_label, thrown) => {
    expect(classifyDatabaseFailure(thrown)).toEqual({ unreachable: true, code: "unknown" });
  });

  it("does not report a code it cannot vouch for the shape of", () => {
    // The reported code goes to CloudWatch unauthenticated. A SQLSTATE and a
    // Node errno are closed vocabularies; a `code` of any other shape is a
    // string of unknown provenance and is not passed through.
    const odd = Object.assign(new Error("nope"), { code: "not a code, a whole sentence" });
    expect(classifyDatabaseFailure(odd)).toEqual({ unreachable: true, code: "unknown" });
  });

  it("stops walking a cause chain that points back at itself", () => {
    const looped = new Error("outer");
    (looped as { cause?: unknown }).cause = looped;
    expect(classifyDatabaseFailure(looped)).toEqual({ unreachable: true, code: "unknown" });
  });
});
