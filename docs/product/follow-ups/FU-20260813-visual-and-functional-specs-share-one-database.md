# FU-20260813-visual-and-functional-specs-share-one-database — e2e specs mutate one shared shop

- **Status:** Open
- **Raised:** 2026-08-13 — PR #501, branch `claude/dive-booking-ui-refinements-t5eoy6`. Found by
  running the whole Playwright suite in one process before pushing, which is not what CI does and
  not what any `package.json` script does.
  **Rewritten 2026-08-14** on PR #535: this entry's central claim — that CI never sees the problem —
  is **false**, and the fix it recommended would not have caught what CI is actually failing on.
- **Kind:** risk
- **Effort:** M
- **Touches:** `e2e/role-lens.spec.ts`, `e2e/blowout.spec.ts`, `e2e/visual.spec.ts`, `e2e/marketing.spec.ts`, `e2e/servers.ts`, `playwright.config.ts`,
  `.github/workflows/ci.yml`, `src/db/seed-backup.ts`, `package.json`

## What I noticed

Every e2e spec in a Playwright job runs against **one database holding one seeded shop**, and
several of them mutate shop-wide state. Nothing declares which specs may do that, and nothing
isolates the ones that do.

This was originally filed as a *local-only* problem — a combined `visual + functional` run failing
three tests that pass alone. That half still reproduces:

- `e2e/visual.spec.ts:2324` "the data-export page renders true to the design" waits for
  `getByRole("cell", { name: "Failed" })` and hits a **strict-mode violation: two matching cells**.
  The seed ships exactly one failed delivery week (the capture's own docblock says so), so the
  second row is another spec's write landing in the delivery ledger mid-capture.
- `e2e/marketing.spec.ts:330` — a bare 15s timeout naming no locator.

**But the "CI never sees this" claim was wrong**, and that is the point of this rewrite. On
2026-08-14, `Playwright shard 3/4` failed on PR #535 with `e2e/role-lens.spec.ts:11` — "a captain's
Today leads with the boat they crew" — which passes on its own. Reproduced locally with CI's exact
invocation (all 69 non-visual specs, `--shard=3/4`): 91 passed, and it failed. Re-running the CI job
reproduced it, so it is not an intermittent flake. It is not caused by that PR either — its
`git diff origin/main -- e2e/` is empty, so shard composition is byte-identical to main's and the
spec is untouched by the diff.

### What the bisect ruled out

Worth recording, because each of these was the obvious guess and each is wrong:

- **Not `blowout.spec.ts`.** It cancels "Two-Tank Reef — Molasses & French", the exact departure the
  seed assigns the captain to, which made it the prime suspect. Running `blowout` + `role-lens`
  together passes — at one worker and at two. `blowout` is also in a different shard.
- **Not concurrency.** The full shard fails **identically at `--workers=1`**. So it is ordering or
  accumulated state, not two specs racing. That also rules out every fix aimed at parallelism.
- **Not `minimum-seats.spec.ts`**, the other departure-cancelling spec in this shard: `minimum-seats`
  + `role-lens` passes.

So it is some *other* spec earlier in shard 3's 18 files leaving state the captain's Today depends
on, and the bisect has not yet reached it. The shard's files, in run order, are: marketing,
minimum-seats, next-departure, nitrox, onboard, orders-demo, promo-codes, readiness, recap, refunds,
rentals, reports, returning-diver, reviews, role-lens, role-permissions, roster-views,
schedule-builder. Everything before `role-lens` is a candidate; the ones that mutate crew or
today's board are the place to start.

So the real shape is broader than "captures need a quiet database". It is: **any spec that mutates
shop-wide state can invalidate a later spec's premise, and which specs land together is decided by
Playwright's sharding rather than by anyone's intent.** The visual-vs-functional split is one
instance of that, not the whole of it.

## Why it isn't already done

**Update, later the same day: shard 3/4 went green again** — 93/93 on CI and locally — after the
unrelated `t()` -> `t.raw()` sweep (a026d7b, which touched
`shared.today.departureBoard.*`, the copy the captain's badge renders through). Whether that is
cause or coincidence is **not established**, and the bisect below was never finished, so the
coupling this entry is about has not been removed — only the one symptom that made it visible.

That matters for how urgent this is, not for whether it is real: the local combined
`visual + functional` run still fails, the specs still share one shop, and the next spec added can
resurrect the same class of failure with no warning. Treat it as a live design gap that is
currently not costing anything, rather than as a fixed bug.

What still holds is that this is a design question rather than a bug with an obvious patch — and the
2026-08-14 evidence has ruled out the answer that was previously approved, so it needs re-deciding
rather than implementing.

## The options, re-costed

**Option 1 — refuse the combined run.** *(Previously recommended and approved; now known
insufficient.)* `playwright.config.ts` fails fast if a run includes both `visual.spec.ts` and a
functional spec, naming the two supported commands. This addresses only the local-only half. It
would **not** have caught the shard-3 failure, because that is two functional specs colliding inside
a supported command. Still worth doing as a one-line kindness to the next contributor, but it must
not be mistaken for the fix.

**Option 2 — make mutating specs isolated.** The specs that change shop-wide state (`blowout`,
`minimum-seats`, anything cancelling or bulk-editing a departure) get their own seeded shop rather
than sharing blue-mantis. `e2e/tenant-isolation.spec.ts` already mints a whole shop through the real
onboarding flow, so the pattern exists and costs one sign-up per spec. This attacks the actual
cause: nothing then depends on which specs share a shard. Most durable, most work.

**Option 3 — declare and enforce the invariant.** A spec that mutates shop-wide state says so
(a fixture, an annotation), and a check refuses a spec that mutates without declaring. Cheaper than
2 and it makes the coupling visible, but it does not *remove* the coupling — it only stops it being
a surprise, and someone still has to decide what the declaration causes (serial execution? a
separate shard? a dedicated shop?).

**Option 4 — pin shard composition.** Assign specs to shards explicitly so known-colliding pairs
never land together. Cheapest and worst: it encodes today's accident as tomorrow's contract, and the
next spec added reshuffles it silently.

Recommendation: **2 for the specs that actually cancel departures**, since that is where the
evidence points and it is a bounded list, plus **1** because it costs a line. Not 4.

Explicitly not proposed: `test.describe.configure({ mode: "serial" })` or dropping the visual spec's
worker count. Both trade CI wall-clock to hide the shared-state coupling rather than name it, and
the suite runs `retries: 0` precisely so this class fails loudly.

## Proposed change

1. Finish the bisect. The ruled-out list above is the head start; walk the shard's files before
   `role-lens` and find which one leaves the captain unbadged. Shard 3's second failure,
   `onboard.spec.ts:65`, turned out **not** to belong to this entry at all — it fails completely
   alone, and is tracked as FU-20260814-timezone-pick-is-overwritten-on-onboarding. Do not expect
   fixing this one to make the shard green on its own.
2. Implement the chosen option.
3. Whatever is chosen, write it down where the next author meets it: the **e2e-and-visual** skill and
   the `pnpm e2e` row in AGENTS.md's command table. The failure mode here is confusing rather than
   loud, and the cost of rediscovering it is an afternoon each time.

## Prompt

```text
DiveDay's Playwright suite is red on CI: `Playwright shard 3/4` fails e2e/role-lens.spec.ts:11,
"a captain's Today leads with the boat they crew", which passes on its own. Fix the shared-state
problem behind it.

Reproduce first, exactly as CI does:
  pnpm e2e:build
  shopt -s globstar nullglob
  spec_files=(); for spec in e2e/**/*.spec.ts; do [ "$spec" != "e2e/visual.spec.ts" ] && spec_files+=("$spec"); done
  pnpm e2e:run "${spec_files[@]}" --shard=3/4 --reporter=line
Expect role-lens:11 to fail. The same shard also fails onboard.spec.ts:65, which is a DIFFERENT and
unrelated bug (it fails alone) tracked separately as
FU-20260814-timezone-pick-is-overwritten-on-onboarding -- do not chase it here, and do not expect
this fix alone to turn the shard green.

Read first:
  - docs/product/follow-ups/FU-20260813-visual-and-functional-specs-share-one-database.md (this
    file — its "options, re-costed" section, and note that option 1 was approved BEFORE the
    shard-3 evidence and is now known not to fix it)
  - e2e/blowout.spec.ts — it cancels "Two-Tank Reef — Molasses & French"
  - e2e/role-lens.spec.ts — the captain's badge, which the seed hangs on that same departure
  - e2e/tenant-isolation.spec.ts — it mints a whole second shop through the real onboarding flow,
    which is the isolation pattern to copy
  - .github/workflows/ci.yml — how the shards are built
  - the e2e-and-visual and debug skills

The bisect so far, so you do not repeat it: NOT blowout.spec.ts (that pair passes, and it is in
another shard), NOT concurrency (the shard fails identically at --workers=1, so this is ordering or
accumulated state), NOT minimum-seats.spec.ts (that pair passes). Some other spec before role-lens
in the shard is responsible.

The constraint that makes this non-obvious: every spec in a job shares ONE database holding ONE
seeded shop, and which specs land in a shard together is decided by Playwright's sharding, not by
intent. So a fix that makes today's shard pass by moving specs around encodes an accident as a
contract and breaks again on the next spec added. Fix the coupling, not the arrangement.

Do NOT reach for test.describe.configure({ mode: "serial" }), extra retries, or a lower worker
count. The suite runs retries: 0 so this class fails loudly; all three hide it instead.

Done means: the CI shard command above passes; the invariant is written down in AGENTS.md's command
table and the e2e-and-visual skill; and `pnpm check` is green. Delete
docs/product/follow-ups/FU-20260813-visual-and-functional-specs-share-one-database.md as part of the
change.
```
