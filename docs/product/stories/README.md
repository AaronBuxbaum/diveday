# User stories and the tests that prove them

[personas.md](../personas.md) says who we build for and what to hold the line on. This folder says
what each of them can **do**, in words a shop owner would use, and ties each ability to the test
that proves it. It is documentation, not a backlog: GitHub Issues stays the system for work, and a
story that nothing proves points at its issue.

## The format

One markdown file per persona (or small group of personas who share a job). One story per
`###` heading:

```
### BOOK-01 A diver books a seat

As Tomas, a certified traveler on a phone, I can pick a boat and book my seat without calling
anyone, so I know I am going.

**Done when**
- The boat is on the public schedule and shows the price and what it asks of divers.
- After booking, the diver sees a confirmation and the crew's roster shows them.
```

- **The id** is a short area word, a dash and two digits, and never changes or gets reused:
  `BOOK` booking, `PAY` money, `WAIV` waivers and medical forms, `GUARD` minors and guardians,
  `READY` a diver preparing, `CERT` certification checks, `DESK` the counter, `ROLL` roll call and
  boarding, `OWN` running the shop. A story that goes away is deleted; its id is not recycled.
- **"Done when"** is plain words a person could check on the demo shop. No test names, no
  selectors, no jargon. If a sentence needs a diving term, use the one from the
  [glossary](../glossary.md).
- **One story, one ability.** A refusal is its own story when its reason matters ("the boat is
  full" and "the charter asks for a card the diver lacks" are different stories).

## Proving a story

A test claims a story with a comment on the line directly above it, in `e2e/*.spec.ts` or any
`src/**/*.test.ts`:

```ts
// story: BOOK-01
test("full loop: staff schedules, visitor books, staff sees the roster", async ({ page }) => {
```

A comment, not a tag in the title, so no test is renamed: the [critical journeys](../../engineering/testing.md#critical-journeys)
table, visual captures and reg-suit baselines all key on titles. One test may claim several ids
(`// story: BOOK-02, DESK-05`) and one story may have several tests, at different layers: the
browser proves the walk, a unit test proves the rule underneath.

A story with no proof says why, on its own line under the heading, in one of two ways:

- `**Gap:** #1234 what is missing` — an open issue owns writing the test. The issue is the work;
  this line is only the pointer. When the test lands, delete the line.
- `**Judged:** how a person checks it` — the story is about judgement (is this jargon explained?),
  which a test cannot hold. Name the check, such as the weekly persona walk.

## The check

`pnpm check:stories` (part of `pnpm check:repo`) fails on:

- a story no test claims that has neither a `Gap` issue nor a `Judged` line;
- a `// story:` marker naming an id that is not a story, or sitting above something that is not a
  `test(`, `it(` or `describe(`;
- a story claimed only by a skipped test;
- a `Gap` line on a story that now has proof (delete it), or one with no issue number;
- two stories with the same id.

`pnpm stories` prints the coverage report: every story, the tests that claim it, and its status
(proven, gap #N, judged). The report is derived on demand and not committed, because a generated
table in a shared doc becomes the file every branch conflicts on.

## Adding a story

1. Write it under the persona who needs it. Prefer the persona's own words in
   [personas.md](../personas.md) and the shop-day fixtures in the demo shop.
2. Claim it from the test that proves it. If none exists, file a `needs-triage` issue naming the
   story id and a `Touches:` line, and put `**Gap:** #N` under the heading.
3. Behavior a change adds or alters edits its story in the same PR, the way a doc does
   ([docs rules](../../../.claude/rules/docs.md)).

## Files

| File | Who | Areas |
| --- | --- | --- |
| [diver.md](diver.md) | Nadia, Tomas, Marco, Rob, Amara | booking, paying, waivers, readiness |
| [guardian.md](guardian.md) | Priya, and the minors she books | minors, parents, family |
| [front-desk.md](front-desk.md) | Chloe | counter, check-in, turn-aways, refunds |
| [captain-crew.md](captain-crew.md) | Sal | roll call, boarding safety, offline |
| [owner-manager.md](owner-manager.md) | Dana, Maren | schedule, waiver, money, access |
