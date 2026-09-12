import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findUnnamedMembers,
  namesMember,
  parseArrayMembers,
  parseUnionMembers,
} from "./check-capability-runbook.mjs";

/**
 * The guard's judgement, not its plumbing.
 *
 * Three things have to hold, and each one is a way the guard could go quietly useless. It
 * has to read all three lists — including the module-local one an import cannot see, out of
 * source text that interleaves long docblocks between the entries. It has to go red when a
 * member is missing from *any* of the three, because a check keyed on the purpose union
 * alone would have caught `handoff` and missed `/shelf` and `/gift`. And it has to stay
 * quiet on a capability described only in prose, with no table row, because that is exactly
 * `?gate=`'s standing and a later tightening toward "must have a row" would make the guard
 * permanently red on it.
 */

const ROOT = path.join(import.meta.dirname, "..");
const read = (file) => readFile(path.join(ROOT, file), "utf8");

const listOf = (members) => [
  { name: "CAPABILITY_ROUTE_PREFIXES", label: "route prefix", file: "x.ts", members },
];

describe("reading the three lists out of source text", () => {
  it("reads an array whose entries are separated by docblocks quoting route templates", () => {
    const source = [
      "export const CAPABILITY_ROUTE_PREFIXES = [",
      '  "waivers",',
      "  /**",
      "   * A docblock between two entries, naming /unsubscribe/[token] and its table.",
      '   * It even quotes a string: "not-a-prefix".',
      "   */",
      '  "unsubscribe",',
      "] as const;",
    ].join("\n");

    expect(parseArrayMembers(source, "CAPABILITY_ROUTE_PREFIXES")).toEqual([
      "waivers",
      "unsubscribe",
    ]);
  });

  it("reads a union declared on one line", () => {
    const source = 'export type CapabilityPurpose = "readiness" | "confirm" | "arrival";\n';

    expect(parseUnionMembers(source, "CapabilityPurpose")).toEqual([
      "readiness",
      "confirm",
      "arrival",
    ]);
  });

  /**
   * A renamed or deleted list must not read as "nothing to check". The CLI turns this null
   * into a failure; returning an empty array here would turn the guard green at the moment
   * the list it protects stops existing.
   */
  it("answers null rather than an empty list when the declaration is gone", () => {
    expect(
      parseArrayMembers("export const SOMETHING_ELSE = [];\n", "CAPABILITY_QUERY_PARAMS"),
    ).toBe(null);
    expect(parseUnionMembers("export type Other = 'a';\n", "CapabilityPurpose")).toBe(null);
  });

  /** The real file is the one that has to parse, and it holds all three lists. */
  it("finds all three lists in the tree as it stands", async () => {
    const [urls, capabilities] = await Promise.all([
      read("src/lib/capability-urls.ts"),
      read("src/db/booking-capabilities.ts"),
    ]);

    expect(parseArrayMembers(urls, "CAPABILITY_ROUTE_PREFIXES")).toContain("shelf");
    // Module-local, never exported — the reason the lists are read as text.
    expect(parseArrayMembers(urls, "CAPABILITY_QUERY_PARAMS")).toContain("handoff");
    expect(parseUnionMembers(capabilities, "CapabilityPurpose")).toContain("arrival");
  });
});

describe("what reads as a capability the runbook never names", () => {
  const runbook = [
    "Today that is `/waivers`, `/ready` and `/shelf`.",
    "Two more travel as query parameters: `?booking=` and `?gate=`.",
    "| Readiness link (`/ready/[token]`) | row in `booking_capabilities` (`purpose = 'readiness'`) |",
  ].join("\n");

  it("names a missing route prefix", () => {
    const unnamed = findUnnamedMembers(listOf(["waivers", "lockbox"]), runbook);

    expect(unnamed.map((entry) => entry.member)).toEqual(["lockbox"]);
    expect(unnamed[0].name).toBe("CAPABILITY_ROUTE_PREFIXES");
  });

  it("names a missing query parameter", () => {
    const lists = [
      {
        name: "CAPABILITY_QUERY_PARAMS",
        label: "query parameter",
        file: "x.ts",
        members: ["booking", "resume"],
      },
    ];

    expect(findUnnamedMembers(lists, runbook).map((entry) => entry.member)).toEqual(["resume"]);
  });

  it("names a missing booking-capability purpose", () => {
    const lists = [
      {
        name: "CapabilityPurpose",
        label: "booking-capability purpose",
        file: "y.ts",
        members: ["readiness", "transfer"],
      },
    ];

    expect(findUnnamedMembers(lists, runbook).map((entry) => entry.member)).toEqual(["transfer"]);
  });

  /**
   * The regression the guard exists to stop, in the shape it actually arrived in: three
   * members missing at once, across two different lists.
   */
  it("reports every missing member in one pass rather than the first", () => {
    const lists = [
      ...listOf(["shelf", "gift"]),
      {
        name: "CapabilityPurpose",
        label: "booking-capability purpose",
        file: "y.ts",
        members: ["handoff"],
      },
    ];

    expect(findUnnamedMembers(lists, runbook).map((entry) => entry.member)).toEqual([
      "gift",
      "handoff",
    ]);
  });
});

describe("what it leaves alone", () => {
  /**
   * `?gate=` is deliberately described in prose and deliberately has no row in the
   * rotate-and-revoke table: its signature unlocks a sentence rather than a resource, so it
   * is redacted for what its value says. This case is what pins the "do not parse the
   * table" decision against a later tightening.
   */
  it("accepts a capability described only in prose, with no table row", () => {
    const runbook = [
      "| Capability | Storage | Can it be revoked? |",
      "| --- | --- | --- |",
      "| Readiness link (`/ready/[token]`) | a row | Yes |",
      "",
      "`?gate=` is the odd one — not a bearer credential at all, so it needs no row below.",
    ].join("\n");

    const lists = [
      {
        name: "CAPABILITY_QUERY_PARAMS",
        label: "query parameter",
        file: "x.ts",
        members: ["gate"],
      },
    ];

    expect(findUnnamedMembers(lists, runbook)).toEqual([]);
  });

  /**
   * The members are short, ordinary English words. A substring match would read every one
   * of these as a mention and the guard would pass on a capability nobody had written up.
   */
  it.each([
    ["board", "The onboarding email carries a keyboard shortcut."],
    ["ready", "The diver has already signed."],
    ["claim", "A reclaimed seat is not unclaimed."],
    ["gate", "We investigate and mitigate, then delegate."],
    ["gift", "A gifted seat, and the gifting flow that sells it."],
  ])("does not accept %s hiding inside another word", (member, prose) => {
    expect(namesMember(prose, member)).toBe(false);
  });

  it("accepts a member at a word boundary a hyphen or a slash makes", () => {
    expect(namesMember("the `/check-in/[token]` kiosk link", "check-in")).toBe(true);
    expect(namesMember("| Arrival code | ... |", "arrival")).toBe(true);
    expect(namesMember("`?handoff=`", "handoff")).toBe(true);
  });

  /**
   * A hyphen is part of the word, so the longer capability cannot stand in for the shorter
   * one. `/confirm-contact` and the `confirm` purpose are different credentials over
   * different tables and each needs its own write-up.
   */
  it("does not let confirm-contact stand in for confirm", () => {
    expect(namesMember("the `/confirm-contact/[token]` link", "confirm")).toBe(false);
  });

  /** The tree as it stands is green, and a guard that arrives red teaches nothing. */
  it("passes on the runbook and the lists as they stand", async () => {
    const [runbook, urls, capabilities] = await Promise.all([
      read("docs/engineering/capability-telemetry-runbook.md"),
      read("src/lib/capability-urls.ts"),
      read("src/db/booking-capabilities.ts"),
    ]);

    const lists = [
      {
        name: "CAPABILITY_ROUTE_PREFIXES",
        label: "route prefix",
        file: "src/lib/capability-urls.ts",
        members: parseArrayMembers(urls, "CAPABILITY_ROUTE_PREFIXES"),
      },
      {
        name: "CAPABILITY_QUERY_PARAMS",
        label: "query parameter",
        file: "src/lib/capability-urls.ts",
        members: parseArrayMembers(urls, "CAPABILITY_QUERY_PARAMS"),
      },
      {
        name: "CapabilityPurpose",
        label: "booking-capability purpose",
        file: "src/db/booking-capabilities.ts",
        members: parseUnionMembers(capabilities, "CapabilityPurpose"),
      },
    ];

    expect(findUnnamedMembers(lists, runbook)).toEqual([]);
  });
});
