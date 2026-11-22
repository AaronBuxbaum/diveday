#!/usr/bin/env node
// Which files the breakage drills cover, and which class each is in (ADR
// 20261122-diff-mutation-testing). Two classes, because the card and the enforcement policy
// (scripts/mutation/policy.json) differ by class:
//
// - money: where money moves or is priced (payments, billing, refunds, checkouts, trip credit,
//   promo codes, discounts, fees, deposits, payouts);
// - safety: the safety-critical files the coverage floors measure
//   (scripts/coverage-safety-files.mjs, imported, never copied).
//
// A file in both is money: the money rules are the narrower ones. Tests, fixtures, seed data,
// copy resolvers and type declarations are never in scope, and nor is anything outside
// src/lib, src/db and src/features.
//
// As a command it reads changed paths on stdin, one per line, and prints the in-scope ones
// (ci.yml's `changes` job answers `mutation` from it).

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { matchedSafetyFiles, SAFETY_FILES } from "../coverage-safety-files.mjs";

const SAFETY = new Set(SAFETY_FILES);

/** Never drilled: tests, fixtures, seed data, test support, declarations, copy resolvers. */
const NOT_LOGIC = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /test-fixtures/,
  /-fixtures\.tsx?$/,
  /\.test-support\.tsx?$/,
  /^src\/db\/seed\//,
  /^src\/db\/schema\//,
];

/** Whole directories of money logic. */
const MONEY_DIRS = [/^src\/lib\/payments\//, /^src\/lib\/billing\//, /^src\/features\/money\//];

/** The money tables' query modules in src/db. */
const MONEY_DB = /^src\/db\/(?:checkouts|refunds|promo-caps|payments|orders|trip-credit)[^/]*\.ts$/;

/**
 * Money by name, in src/lib and src/features: a file named for trip credit, a refund, a
 * discount, pricing, a fee (not a feed), a payout, a deposit, money, a promo code or a payment.
 */
const MONEY_NAME =
  /(?:^|[-_.])(?:trip-credit|refunds?|discounts?|pricing|fees?|payouts?|deposits?|money|promo-codes?|payments?|payment-[a-z]+)(?:[-_.]|$)/;

function codeFile(file) {
  return (
    /^src\/(?:lib|db|features)\/.+\.tsx?$/.test(file) && !NOT_LOGIC.some((re) => re.test(file))
  );
}

/** `"money"`, `"safety"` or `null` for one repository path. */
export function classifyScope(file) {
  const posix = file.split(path.sep).join("/");
  if (!codeFile(posix)) return null;
  const money =
    MONEY_DIRS.some((re) => re.test(posix)) ||
    MONEY_DB.test(posix) ||
    (/^src\/(?:lib|features)\//.test(posix) &&
      posix
        .split("/")
        .slice(2)
        .some((part) => MONEY_NAME.test(part)));
  if (money) return "money";
  if (SAFETY.has(posix) || matchedSafetyFiles([posix]).length > 0) return "safety";
  return null;
}

/** The in-scope paths of `files`, sorted. */
export function scopeFiles(files) {
  return files.filter((file) => classifyScope(file) !== null).toSorted();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Await every chunk through EOF: Actions can pipe a large diff through a nonblocking fd.
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  for (const file of scopeFiles(input.split("\n").filter(Boolean))) console.log(file);
}
