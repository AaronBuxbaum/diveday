import { describe, expect, it } from "vitest";
import { findTransactionFanOut } from "./check-db-concurrency.mjs";

const lines = (findings) => findings.map((finding) => finding.line);

describe("a function that can receive a transaction", () => {
  it("is refused a Promise.all", () => {
    const findings = findTransactionFanOut(`
      export async function readEvidence(tx: DbExecutor, tripId: string) {
        const [a, b] = await Promise.all([count(tx, tripId), other(tx, tripId)]);
        return a + b;
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("is refused an allSettled too", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: AppTransaction) {
        await Promise.allSettled([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("is refused one written by a closure it hands out", () => {
    // Closing over `tx` is how this came back the second time: the fan-out
    // moved into a callback, but it is still one checked-out client.
    const findings = findTransactionFanOut(`
      export async function walk(tx: DbExecutor, ids: string[]) {
        return ids.map(async (id) => {
          return Promise.all([one(tx, id), two(tx, id)]);
        });
      }
    `);

    expect(lines(findings)).toEqual([4]);
  });

  it("is refused one the formatter wrapped across two lines", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        return Promise
          .all([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("may say on the line why this particular one is not over queries", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor, urls: string[]) {
        await Promise.all(urls.map(fetch)); // diveday:allow-db-concurrency: HTTP, not queries
      }
    `);

    expect(findings).toEqual([]);
  });

  it("is not let off by an empty reason", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        await Promise.all([one(tx)]); // diveday:allow-db-concurrency:
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });
});

describe("a function that only ever sees the pool", () => {
  it("keeps its Promise.all -- the fan-out there is real and worth having", () => {
    // The whole reason this check is narrow. Serializing a hot roster,
    // manifest or Today read would be a regression, not a fix.
    const findings = findTransactionFanOut(`
      export async function listRoster(db: AppDb, tripId: string) {
        const [divers, crew] = await Promise.all([divers(db, tripId), crew(db, tripId)]);
        return { divers, crew };
      }
    `);

    expect(findings).toEqual([]);
  });

  it("keeps it even when a transaction-taking function sits above it in the file", () => {
    const findings = findTransactionFanOut(`
      async function inTx(tx: DbExecutor) {
        await one(tx);
      }

      export async function onPool(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });
});

describe("what the token scan buys over a regex", () => {
  it("ignores a Promise.all inside a comment or a string", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        // Deliberately not Promise.all([one(tx), two(tx)]) -- see issue #517.
        const note = "was Promise.all([...])";
        const template = \`still Promise.all([...])\`;
        return note + template;
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does not follow an overload signature into the next declaration's body", () => {
    // `export function f(tx: DbExecutor): Promise<void>;` has no body of its
    // own; the `;` has to end the claim, or the next unrelated block inherits it.
    const findings = findTransactionFanOut(`
      export function declared(tx: DbExecutor): Promise<void>;

      export async function unrelated(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does not leak out of a type that merely mentions the executor", () => {
    const findings = findTransactionFanOut(`
      type Reader = { read(tx: DbExecutor): Promise<void> };

      export async function onPool(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });

  it("still catches the body after a generic return type full of commas", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor): Promise<[number, number]> {
        return Promise.all([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });
});
