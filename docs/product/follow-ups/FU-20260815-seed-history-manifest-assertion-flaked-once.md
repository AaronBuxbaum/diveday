# FU-20260815-seed-history-manifest-assertion-flaked-once — One unit test failed once in a full run and has not reproduced; record the evidence before it is lost

- **Status:** Open
- **Raised:** 2026-08-15 — running `pnpm check` on an unrelated branch (the offline roll-call
  tie-break). Filed because the observation is worth more written down than remembered, not because
  a fix is known.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/seed-history.test.ts`, `src/db/seed-history.ts`, `src/db/manifests.ts`,
  `src/test/db.ts`, `src/test/frozen-clock.ts`

## What I noticed

`src/db/seed-history.test.ts` → **"never shows a boarded diver beside a blocked readiness result"**
failed once, in a full `pnpm test` run, and has not failed since.

The assertion is that no diver in a seeded *history* manifest reads `rollCall.state === "boarded"`
while `readiness.status !== "ready"` — a diver who is on the boat but whom the app says should not
be. As a seeded-data invariant it is cheap; as a statement about the product it is the exact pairing
a manifest exists to prevent, which is why it is worth not shrugging at.

What was observed, precisely:

| Run | Branch | Result |
| --- | --- | --- |
| Full `pnpm test` | `fix/offline-roll-call-tie-break` | **1 failed**, 5493 passed |
| Full `pnpm test` | `origin/main`, unmodified | 5491 passed, 0 failed |
| Full `pnpm test` | `fix/offline-roll-call-tie-break` again | 5494 passed, 0 failed |
| The file alone, repeatedly | either | passes |

**The failure output was not captured.** That is the single most annoying fact in this entry and the
reason it is thin: the run was filtered to a summary line, and by the time the detail was wanted the
failure was gone. Whoever picks this up should run the suite unfiltered.

## Why it isn't already done

Because a fix would be a guess, and a guess here is worse than the flake. The obvious mechanisms
were checked and **excluded**, which is the part worth inheriting:

- **Not cross-test database pollution.** Every test gets its own in-memory PGlite hydrated from a
  template snapshot (`seededTestDb` in `src/test/db.ts`) and closes it on finish. There is no shared
  database for another test to write into.
- **Not the application clock.** `TEST_FROZEN_CLOCK` (`src/test/frozen-clock.ts`) is a fixed literal,
  `2026-07-21T13:30:00.000Z`, not "now at process start", so `nowDate()` cannot drift between runs
  or between workers.
- **Not a wall-clock column feeding readiness.** `src/lib/readiness.ts` compares only calendar
  `expiresAt` values against a `todayLocal` derived from the frozen clock. It reads nothing stamped
  by Postgres `now()` / `defaultNow()`, which is the hazard `dbNow`'s docblock in `src/test/db.ts`
  warns about.
- **Not a roll-call ordering tie.** `seed-history.ts` writes one event per booking per checkpoint,
  each with a distinct `occurredAt` (`trip.startsAt + index * 90min`), so the
  `desc(occurredAt), desc(createdAt)` read-back in `src/db/manifests.ts` has no tie to break.
- **Not the change it was seen on.** That branch touches only the *device-side* offline readers in
  `src/lib/offline-manifests.ts` and a comment; the test reads `getTripManifest` from the database
  and cannot reach any of it.

So the remaining candidates are load-dependent — memory pressure and GC under a full parallel run
(the `closeWhenTestFinishes` docblock in `src/test/db.ts` describes exactly that pressure), or a
genuine nondeterminism in `resetDemoSchedule`'s re-seed that only shows under contention. Neither is
established, and inventing a mechanism to justify a fix is how a real bug gets papered over.

## Proposed change

**Do not "fix" this speculatively.** In order:

1. **Reproduce with output.** Run `pnpm test` unfiltered, repeatedly, and keep the failure text —
   which divers, which trip, and whether the offending pairing is a `boarded` state that should have
   been `not_boarded` or a readiness result that should have been `ready`. That single fact splits
   the remaining candidates in half.
2. Only then look for the cause. If it is load, the fix is in the harness; if it is
   `resetDemoSchedule`, the fix is in the seed and probably matters to the e2e fleet too.
3. If it cannot be reproduced in a reasonable number of runs, close this file. A recorded
   observation that never recurred is worth more than an open item nobody can act on — the same call
   `FU-20260814-timezone-pick-is-overwritten-on-onboarding` reached, and for the same reason.

**Not proposed:** a retry, a longer timeout, `test.sequential`, or relaxing the assertion. The
assertion is correct and is the whole point of the test.

## Prompt

```text
A DiveDay unit test failed once in a full run on 2026-08-15 and has not reproduced:
src/db/seed-history.test.ts, "never shows a boarded diver beside a blocked readiness result".

Read docs/product/follow-ups/FU-20260815-seed-history-manifest-assertion-flaked-once.md FIRST. Its
"Why it isn't already done" section lists five mechanisms that were already checked and EXCLUDED --
cross-test database pollution, the frozen clock, a wall-clock column in readiness, a roll-call
ordering tie, and the change it was seen on. Do not re-derive those; they cost real time.

Step one is reproduction WITH OUTPUT, and it is most of the job. Run `pnpm test` unfiltered (not
grepped to a summary line, which is why there is no failure text to work from) as many times as it
takes. Keep the assertion's actual output: `offenders` is an array of "<trip title> - <diver name>"
strings, and knowing WHICH diver on WHICH history trip -- and whether the wrong half is the boarded
roll-call state or the blocked readiness result -- splits the remaining candidates in half.

The remaining candidates, neither established: load-dependent behaviour under a full parallel run
(see the closeWhenTestFinishes docblock in src/test/db.ts on GC pressure), or a nondeterminism in
resetDemoSchedule's re-seed that only appears under contention. If it is the latter, it probably
affects the e2e fleet too, so check that before scoping a fix narrowly.

Do NOT add a retry, widen a timeout, mark the test sequential, or relax the assertion. The assertion
is correct: a diver reading "boarded" beside a blocked readiness result is the exact pairing a
manifest exists to prevent, and this is a safety surface -- get a dive-domain-expert review if the
cause turns out to be in the seed or the manifest rather than the harness.

If it genuinely will not reproduce in a reasonable number of full runs, delete the file and say so.
An observation that never recurred is worth less than the noise of an open item nobody can act on.

Done when: either the cause is found and fixed with a regression test, or the file is deleted with
the number of runs attempted recorded in the PR. pnpm check green either way.
```
