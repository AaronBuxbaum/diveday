# FU-20260814-db-concurrency-check-rides-an-unstable-ts-entry-point — `check-db-concurrency.mjs` parses through `typescript/unstable/ast`, which is allowed to move

- **Status:** Open
- **Raised:** 2026-08-14 — building `scripts/check-db-concurrency.mjs`
  (FU-20260814-guard-promise-all-on-a-transaction, closed in the same change)
- **Kind:** risk
- **Effort:** S
- **Touches:** `scripts/check-db-concurrency.mjs`, `scripts/check-db-concurrency.test.mjs`,
  `package.json`

## What I noticed

The new transaction-concurrency check needs to know where a function *body* is, so a `Promise.all`
in a comment, a string, or a sibling function is not a match. It gets that from TypeScript's own
lexer:

```js
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
```

That entry point is named `unstable` by the package, and TypeScript 7 means it. Writing this check
also turned up two ways it has already moved from what an older TypeScript would have offered: the
end-of-file token is `SyntaxKind.EndOfFile`, not the classic `EndOfFileToken` (reading the old name
gives `undefined`, and a `while (token !== undefined)` loop spins forever rather than failing), and
the scanner emits trivia tokens rather than skipping them. The classic `ts.createSourceFile` /
`ts.forEachChild` AST API is simply gone from the package's exports; `typescript/unstable/sync`'s
`Program`/`Project` is the supported replacement, and it wants a real project setup rather than one
string of source.

So a TypeScript upgrade can break `pnpm check:repo`. It breaks **loudly** — the check throws or
`scripts/check-db-concurrency.test.mjs`'s twelve cases go red, and neither is silent — which is why
I shipped it rather than hand-rolling a tokenizer. But nobody has decided what the answer is when
it happens, and the person it happens to will be mid-upgrade on something else.

## Why it isn't already done

The alternatives all cost more than the risk, today:

- A hand-rolled tokenizer (string/template/comment/regex-aware brace matching) is ~60 lines of
  exactly the code TypeScript already ships correctly, and it would be *our* bug when it is wrong.
- `@babel/parser` is present in `node_modules` but only transitively — depending on it means
  declaring it, which is a new dependency and an ADR.
- `typescript/unstable/sync`'s `Project` API is the supported door, but it builds a program per run
  and this check reads every file under `src/db` and `src/features`.

None of that is worth doing speculatively. What is missing is only the decision, written down.

## Proposed change

Pick one, in a change of its own:

1. **Accept it, and say so where the upgrader will look.** A line in the script's docblock naming
   the two API facts above and pointing at `typescript/unstable/sync` as the migration target, plus
   a note in whatever runbook or checklist covers a TypeScript major upgrade.
2. **Move to `typescript/unstable/sync`'s `Project`**, measuring the cost first — if a program build
   over two directories is under a second, it is the stable answer and this stops being a question.
3. **Drop the parser** and narrow the rule to what a line-based scan can prove, accepting the false
   negatives. I do not recommend this: the four real violations the check found on its first run
   (three in `src/db/blowouts.ts`, one in `src/db/trips-schedule.ts`) were all inside functions
   whose signature was several lines above the `Promise.all`.

## Prompt

```text
scripts/check-db-concurrency.mjs (added 2026-08-14, runs inside `pnpm check:repo`) tokenizes
TypeScript through `typescript/unstable/ast`'s `createScanner`. That entry point is explicitly
unstable and a TypeScript major upgrade may remove or reshape it, taking `pnpm check` with it.

Read scripts/check-db-concurrency.mjs (the `findTransactionFanOut` docblock explains what the token
scan buys over a regex) and scripts/check-db-concurrency.test.mjs (twelve cases, including the ones
a regex would get wrong).

Decide between: accepting the risk with a written note aimed at whoever runs the next TypeScript
upgrade; porting to `typescript/unstable/sync`'s Program/Project API if a program build over
src/db + src/features costs under a second; or narrowing the rule to a line scan. The third loses
real coverage -- all four violations found on the check's first run had their function signature
several lines above the Promise.all -- so weigh that honestly rather than taking the cheapest.

Whichever you pick, `node scripts/check-db-concurrency.mjs` must still pass on the tree, still fail
on a deliberately introduced `Promise.all` in a `DbExecutor`-taking function, and still keep the
twelve test cases green.

Run `pnpm check`. Delete
docs/product/follow-ups/FU-20260814-db-concurrency-check-rides-an-unstable-ts-entry-point.md as part
of the change.
```
