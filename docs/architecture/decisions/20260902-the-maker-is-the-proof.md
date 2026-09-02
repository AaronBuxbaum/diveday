# 20260902-the-maker-is-the-proof — Put people on the marketing pages, and make the case plainly

- **Status:** Proposed — two of its decisions are the owner's (H-66); the rest is the canvas's
  recommendation and moves nothing until that row is Chosen
- **Date:** 2026-09-02
- **Scope:** The public marketing pages (`/`, `/product`, `/pricing`, `/about`, `/switching/*`,
  `/onboard`) and the claims policy in [marketing.md](../../product/marketing.md)

## Context

The owner's brief on 2026-09-02: take a big loop over the marketing pages and the copy, evaluate,
and change what needs changing — and find a differentiator, naming two candidates, a support
staff and his own work background (ex-Google). Three notes followed in the same session and each
one moved the design: the copy should sound less like a machine wrote it; nothing may read as a
side project, imply one person builds DiveDay, or speak in the first person; and the case should
be about what DiveDay does and who is here, with the background as a subtle humblebrag rather than
a rundown, because a rundown reads as protesting too much.

The pages were read as they render today, in both schemes and both widths, against the rulebook.
They are correct, calm, and consistent with Reef, and the 2026-08-27 review's slices landed five
days ago and read well. Four things are wrong with them, and the canvas
([20260902-the-maker-is-the-proof](../../design/canvases/20260902-the-maker-is-the-proof/README.md))
argues each in pictures:

1. **The pages have no people in them.** Every page argues the product's safety — safe to run the
   boat on, safe to leave — and none says who is here or what happens when a shop writes. The
   "From the founder" band on `/about` carries no name. A shop owner deciding whether to move a
   season onto a product with no customers wants those two things answered, and the pages never
   answer them.
2. **The pages argue insurance, not desire.** The product's bet is delight
   ([vision.md](../../product/vision.md)), and the copy's proof is almost entirely exits and gates.
   The export appears on `/`, on `/pricing`, three times on `/about`, and on every switching guide.
   Nowhere does the site say, plainly and in one place, what a shop gets.
3. **Support is described as a mailbox.** "A real person reads it" is on every page and any rival
   can paste it; FareHarbor's pitch is 24/7 support by phone, so "support exists" cannot win on
   volume. The one support sentence no call centre can print is *who* reads it. The founder-direct
   line was retired on 2026-08-05 (H-12) because it read small beside "One person owns every line
   of code"; the subject of that sentence was the problem, not the fact.
4. **The copy sounds machine-written.** Every sentence is a finished line: the "X — not Y" tail,
   the balanced pair, the triplet for rhythm, the closing aphorism. One is a good sentence; forty
   in a row is a tell, and a shop owner reading at night hears a machine on the one page that is
   about trust.

## Decision

Proposed, in five parts. Parts 1 and 3 are the owner's to confirm and are recorded as H-66.

1. **`/about` gets a "Who's here" band directly under the hero: three short paragraphs in team
   voice.** Who is here, with the background as one passing clause ("a few people who dive and
   have built software for a living for a long time, at Google among other places"); what happens
   when a shop emails ("one of us reads it. There's no ticket queue in the way."); and what is being
   built, ending on the demo as the way to judge it. It replaces the nameless founder band. **No
   ledger of facts, no signature, no "I", and no name** unless the owner wants his in the first
   sentence: the signed first-person story and the three-fact ledger were both drawn first and
   declined by the owner on 2026-09-02, one because "I" says one person builds DiveDay and the
   other because a rundown reads as protesting too much. The three sentences are drafts the owner
   keeps, rewords, or strikes, since biography is true-only. The word "spec" leaves `founderP3` in
   the same change; it has been on the page in breach of the marketing checklist since the band
   was written.
2. **`/` gets "The short version": the whole case in five plain sentences, one band, one link.**
   Between the records diptych and the close, in the moment-row shape: what you get, that you know
   at the desk when a diver isn't cleared, the flat price with no cut of bookings (interpolated
   from `earlyAccessPrice`, never spelled), the one-ZIP exit, and that a person reads your email.
   Every sentence is a shipped fact. One link to `/about` at link weight is the band's only
   control; the hero's pinned budget (one primary, one secondary) is untouched. Only the last
   sentence waits on H-66, and it moves with part 3.
3. **The support sentence is "one of us reads it".** Recommended over today's "a real person"
   (any rival can paste it) and over "support staff" (not true today, so roadmap marketing; and
   the sentence every rival already has). It lands in five places — `/pricing`'s included list and
   closing question, `/about`'s "How it's run" band and "Who answers you" row, and the homepage's
   contact half — always as *reads*, never *answers*, and **never with a response time, a day, or
   an hour budget.** It does not reverse the 2026-08-05 retirement in H-12: no individual is named
   and no personal answer is promised, so it sharpens the line the policy already allows (the inbox
   reaches the same team) rather than restoring the one it retired. It still takes the owner's
   nod, because it is a promise about who reads, and it is retired the day the inbox is handed to
   someone who does not make the product.
4. **The background appears once, in passing, as "at Google among other places"** — a clause
   inside a sentence about the team, on `/about`, and nowhere else. Google Maps is not named, the
   biotech company and self-driving cars are not listed, nothing on `/` repeats it, and it is
   never a heading, an eyebrow, or a logo. A humblebrag works once; a list of employers is a
   résumé, and the 2026-08-05 removal was right about that.
5. **A voice pass, held to a written list.** Eight tells the code phase sweeps across every page,
   with one rewritten example per page on the canvas: the "X — not Y" tail; the balanced pair; the
   triplet for rhythm; the closing aphorism; "It's not X. It's Y."; an adjective where a specific
   would do; no "I" anywhere, and "we" only for what the whole team shares; and no self-aware
   asides or zingers — if a sentence makes the writer smile at their own cleverness, it goes. One
   dash per paragraph at most. The existing rule (read it aloud as a briefing) catches jargon and
   misses polish; the second ear is *would you say this across the counter to the shop owner, in
   these words?* Every proposed sentence on the canvas was rewritten through the list, twice.

The claims policy in [marketing.md](../../product/marketing.md) is amended in the code phase to
record parts 3, 4 and 5 and the shape of part 1; H-12's row in
[human-decisions.md](../../product/human-decisions.md) is amended by H-66's outcome, never
rewritten.

## Alternatives considered

- **Leave the biography off, as decided 2026-08-05.** The block that came off was a résumé; the
  decision was about the telling, not the fact, and one clause in passing is a different object.
- **A signed first-person founder letter.** Drafted first and declined by the owner: "I" tells
  the reader one person builds DiveDay, and that is not true.
- **A three-fact ledger (Google Maps, the biotech company, self-driving cars), each with what
  DiveDay took from it.** Drafted second and declined by the owner: a rundown reads as protesting
  too much, and "these days I work on self-driving cars" read as a side project. One passing
  clause replaces all of it.
- **"Ex-Google" as an eyebrow or in a heading.** A startup-deck register, and it makes the maker
  the pitch. The rule that a headline is about the buyer's position was learned four times on
  `/about` alone; the canvas keeps it.
- **"The person who built it" as the support subject.** Singular, so it says one builder;
  replaced by "one of us", which is also what keeps it inside the current policy.
- **A support desk as the differentiator.** Not true today, so it fails shipped-only until
  someone is hired; and it is the sentence every incumbent already has. Hire when the cohort needs
  it and say so then.
- **A photograph of the founder.** Nothing to draw from; a placeholder would read as a stock grin
  ([brand.md](../../design/brand.md) rules those out). Revisit if the owner supplies one.
- **A logo wall for the employers.** Fabricated-proof failure wearing an affiliation; refused.

## Consequences

- People are on the site again, in team voice, and one sentence on five pages promises that one of
  them reads the support inbox. The season-does-not-depend-on-anyone proof (the shop's own Stripe
  account, the ZIP, roll call with no signal) is what makes that safe to say, which is why the
  band sits under that hero on `/about` and the short version sits beside the price and the doors
  on `/`, never in a hero.
- The `e2e/marketing.spec.ts` assertions that pin `/about`'s headings and the homepage's control
  count move deliberately, and the apologetics test gains nothing to catch — no proposed sentence
  says small, new vendor, on faith, or borrow credibility.
- The rulebook contradicts itself today and 15e resolves it: [marketing.md](../../product/marketing.md)'s
  claims policy retires founder-direct support in one bullet and, further down the same section,
  still lists it among the binding founding-cohort commitments from H-12. Part 3 is judged against
  the retirement, and 15e rewrites both passages to say one thing.
- Escape hatch: the day the inbox is handed to someone who does not make the product, part 3
  reverts to "a real person" by editing five strings; the day the owner wants the band off again,
  part 1 reverts by deleting one band and its keys in both locales. Neither touches the schema, a
  route, or a test of behaviour.
