# How DiveDay stays safe when nobody reads the code

Aaron does not read the code agents write. He looks at the screens, reads the risk card on each
pull request, and decides. This page is the contract behind that: what the machines check so a person
does not have to, what they do not check, and the risk that is left, in plain words. It is written
for Aaron first and for the next agent second; an agent that changes a guardrail edits this page in
the same change.

## The deal

- **Agents write the code and the tests.** Nobody reads either line by line.
- **The guardrails are the reader.** A change merges only when the required check, `CI result`,
  is green on the top pull request of a stack (GitHub enforces it on `main`; only a repository admin
  can bypass, and only through a pull request).
- **Aaron's part is the screens and the risk card.** The screenshots show how it looks. The risk card
  says what kind of change it was and whether anything in it needs his decision.
- **A guardrail that stops fitting is changed or removed, never worked around.** Keeping dead code to
  satisfy a check is worse than having no check. But the rules are written by agents too, so a change
  to a rule is itself the most closely watched change there is ([below](#who-watches-the-referee)).

## What stops what

Read down the left column: *if this goes wrong*, the guardrail in the middle is what notices.

| If this goes wrong | What notices | When |
| --- | --- | --- |
| A rule breaks (who may board, what a refund pays, who may sign in) | The tests for that rule go red. Every rule with a branch has a test, and the refusal case is mandatory | every pull request |
| The tests are too thin to notice | **Breakage drills**: CI breaks the money and safety lines a pull request changed (flips a `<` to `<=`, drops a condition) and demands a test fail. A break that survives is named on the card and blocks the merge. A weekly run scores each whole safety file | every pull request that changes money or safety code; weekly |
| A rule is only right for the examples someone thought of | **Rule tests** (property tests): the computer generates thousands of divers, trips, payments and roll-call taps and checks statements like "booking never refuses someone boarding would clear", "a refund never exceeds what was paid", "replaying roll-call taps in any order gives the same answer" | every pull request |
| One shop sees another shop's data | **Cross-shop sweep**: every database function that takes a shop is called as a second shop with the demo shop's ids, and fails if any of the demo shop's rows or marked names come back or change. A function that takes no shop is named with its reason, or the sweep fails. A scan of every staff page checks it asks whether the shop in the address is the signed-in shop. The risk card names any change that makes a query mention the shop in fewer places | every pull request |
| Two things happen at once (the last seat, two sign-ins, two payments) | Real-Postgres tests race real database transactions | every pull request that touches the database; nightly |
| A safety file loses test coverage | Coverage floors: each safety file's branch coverage can only rise | every pull request |
| A diver's or shop's data survives an erasure, or is missing from an export | Erasure and export coverage tests: every table and column is exported, folded in or excluded on purpose | every pull request |
| The database change breaks what is live, or loses data | The migration check, the real-Postgres migration test, and the risk card naming any migration that removes a table or column | every pull request |
| A page looks wrong | Screenshots at phone and desktop width, compared to the last merged baseline. **This one is Aaron's.** | every pull request |
| A whole shop day does not work end to end | The one-day simulation and the weekly persona walk | nightly; weekly |
| A rule is edited so the red check turns green | **Referee protection**: a pull request that deletes or loosens a test, lowers a floor, or edits a check must say so in plain words, shows in red on the risk card, and gets a fresh reviewer who reads only those edits | every pull request |
| A library with a known hole, or one nobody asked for | Dependabot weekly; a new runtime library is an ADR and a line on the risk card | weekly; every pull request |
| Something merges that should not | `main` requires `CI result`; a lower layer of a stack shows passing but untested, so only the top of a stack merges | always |

## How to read the risk card

Every pull request on top of a stack gets a comment headed **Risk card**. It has one of two verdicts:

- **Fine to merge once the checks are green.** Nothing in it needs a decision from you. This is the
  normal case. It does not mean the change is good, only that nothing the guardrails can see is wrong.
- **Needs your eyes.** Each item is one plain sentence and the question to answer, for example
  "a test was loosened in refund code: was that on purpose?" You do not have to read code to
  answer. Ask the thread, or decide.

Below the verdict it says which areas changed (money, dive safety, privacy, offline roll call, the
database, outside libraries, deploy, screens), what the author says changed (their words, not
checked), what protects it (the breakage drills and referee results), anything worth a look, and
a list headed **What this card cannot tell you**. That last list is the card being honest: a
guardrail that did not run, a sample that was cut short, or a part of the change no machine reads.

## What the guardrails do not cover

These are the holes. Each is something a person would otherwise have to catch.

1. **Whether the rule is the right rule.** The machines hold the code to the rules we wrote down.
   If a rule is wrong (a medical question that should block boarding and does not), every
   guardrail agrees with the wrong rule. The dive-domain reviewer agent is another AI, not a dive
   professional. The human checks that matter before real divers are on a boat are the V-02, V-03
   and V-04 tasks in the human-task issues (offline manifest outdoors, legal and medical wording, a
   rehearsed departure with a real shop).
2. **Tests that share the code's misunderstanding.** The same agent usually writes the change and the
   tests for it, so both can be wrong the same way. The breakage drills and the rule tests narrow
   this (they attack the code from outside the author's examples), but they cannot see a rule the
   author misread in both places.
3. **How it feels.** Screenshots cover the pages we capture, in light mode at phone and desktop
   width (dark mode only on `main` and when colors change). They do not cover a slow connection on a
   boat, a real iPhone's Safari, a screen in sunlight, or whether a flow is pleasant. Real-device
   offline testing is V-02.
4. **Breakage drills are a sample.** They only break lines a pull request changed, only in money and
   safety files under `src/lib`, `src/db` and `src/features`, and at most 150 breaks per run, so a
   very large change is partly untried (the card says "tried 150 of 412"). A change that cannot
   alter behavior is excused with a written reason in the code (`mutation-ok`); the card lists every
   excuse, but a wrong excuse is a hole. Money and safety code in a route, a page or a component is
   never broken on purpose (the card says so by name), and files outside the two lists are not
   drilled at all. A break that makes a test hang counts as caught, and some breaks change no
   behavior (a default that is never read), so a score of 100% is not the goal; the weekly run
   scores whole files and the score can only rise.
5. **Rule tests only know the rules we wrote down.** A rule that is not in the list is not attacked
   (`docs/engineering/testing.md#property-tests` lists what is pinned and what is not). A rule that
   lives only inside a database query or under a row lock, such as "a payment status only moves
   forward", is pinned by the real-Postgres tests, not by a generated test.
6. **The sweep covers a known shape.** It calls the database functions that take a shop and checks
   their answers for another shop's ids and marked names. It does not call a function whose
   parameters it cannot fill yet (the count is banked and can only fall), or one that takes no shop
   and trusts its caller to have checked an id (the reviewed list in
   `src/test/cross-shop/not-shop-scoped.ts`). It cannot see a count or a yes/no worked out over
   another shop's rows, a leak through a route, a server action or a link that skips `src/db`, or a
   foreign value it neither marked nor knows the id of. Those rely on the staff-page scan, the
   end-to-end tenant test and the risk card's "mentions the shop in fewer places" signal. There is
   no database-level lock between shops (row-level security); ADR 20261122-cross-shop-sweep says
   what it would add, and the first shop that is not a friend is when to revisit it.
7. **The referee is also written by agents.** Referee protection makes a rule change loud and puts a
   fresh reviewer on it. A change subtle enough to fool both is possible. It is the biggest risk that
   remains, and the reason this page says "closely watched" rather than "impossible".
8. **Other companies.** Stripe, email and SMS providers, the database host, the hosting provider and
   AWS can change or break without a line of our code changing. Tests use fakes for them. Taking
   real money in live mode is a human step (human-task issue on switching Stripe to live).
9. **Real traffic.** There are no users yet. Load, cost surprises and the odd things real people do
   are unknown until they happen. The nightly simulation and weekly persona walk are rehearsals.
10. **Security scanning is thin.** Known-vulnerable libraries and code patterns are found weekly
    (Dependabot, CodeQL), not on every pull request. Secret scanning and push protection are on.
11. **Accessibility** is not scanned: that was Aaron's call on 2026-10-24.
12. **Wording.** Legal and medical wording needs a human reviewer (human-task issues).

## The risk Aaron is accepting

In order of how much it should worry you:

1. A rule that is wrong from the start passes every check. Mitigation: the real-world rehearsals
   (V-02, V-03, V-04) before the first real boat.
2. A subtle edit to a rule gets past the red card and the fresh reviewer. Mitigation: read every
   "Rules changed" item on the card, which is plain English, before the first real booking.
3. One shop sees another's data through a path the sweep does not reach. Mitigation: the sweep, the
   staff-page scan, the end-to-end test, and a human security pass before the first paying shop.
4. A page that looks wrong where we do not take screenshots. Mitigation: you look; dark mode and
   real-phone checks are yours.
5. An outside service misbehaves in a way the fakes do not. Mitigation: monitors, the restore
   drill, and the incident runbook.

### When to stop trusting this and read the code again

Put a person back in the loop, for that area only, at each of these moments: the first real
payment (read the refund and payout paths once), the first real boat day (a dive professional walks
the manifest and roll call), the first shop that is not a friend (a one-time security review of
shop-to-shop separation), and any time the risk card says "Needs your eyes" about the same area three
pull requests in a row. A guardrail that never fires deserves suspicion too: the weekly drill score
falling, or a floor lowered, is the signal.

## Who watches the referee

The tests, floors and checks decide whether a change is fine, so they are the most valuable thing an
agent could quietly weaken. In a pull request:

- Deleting or skipping a test, removing assertions from a safety or money test, lowering a
  coverage floor, raising a ratchet, editing a `check:*` script, the CI workflow, the lint rules or
  the agent rules all count as **rule changes**.
- Rule changes need a `## Rules changed` section in the pull request body saying in plain words what
  loosened and why, and a `referee-reviewer` run named under `## Reviews launched`: a fresh agent
  that reads only the rule changes and answers one question, "does this make a bad change easier to
  merge?"
- The risk card shows every rule change in red at the top. Tightening a rule (a new test, a higher
  floor, a new check) is listed but does not need a reason.

## How the guardrails are tested

A guardrail that silently stops working is worse than none. So: every guard has a test beside it
that includes the "leaves alone" case; the breakage-drill tool has a test that proves it actually
detects a broken rule and a test that proves it reports an unprotected one; scheduled runs that go
red open an issue on their own; and the weekly drill score and the coverage floors can only rise.
