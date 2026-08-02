# First call with a dive shop — a script for disconfirming

**This is not a pitch.** Call one has exactly one job: find out whether the shop owner DiveDay was
built for actually exists, and whether the problems the product solves are problems this person has.

That job is unusual enough to state plainly. Every persona DiveDay has been designed and reviewed
against is synthetic — [personas.md](../personas.md) is a written frame, and the 165-task persona
walkthrough was an evaluation of the product's own assumptions, not of a shop. The
[review](../assessments/comprehensive-review-20260802.md) records zero customer contact in the
entire history of the project. So the product may be excellent against an imagined buyer, and one
real conversation is worth more than another review pass.

A call that ends with "they weren't interested" and five specific reasons is a **success**. A call
that ends with a polite "sounds great, send me something" and no specifics is a failure, however
pleasant it felt.

## Rules for the call

1. **Ask about last week, not next month.** "Walk me through last Saturday morning" beats "would you
   use a system that…". People are accurate about what happened and unreliable about what they would
   do.
2. **Don't demo unless they ask twice.** A demo converts the call from their operation to your
   software, and once it does you learn nothing.
3. **Don't defend.** If they say the thing you built is unnecessary, that is the finding. Write it
   down, ask why, and resist the second question that is secretly an argument.
4. **Shut up after a question.** The useful sentence is usually the second one they say.
5. **Never claim a customer, a count, or a pattern.** DiveDay has none. If asked "who else uses it?",
   the honest answer is "nobody yet — that's why I'm calling you first, and why the pilot is free."
   That answer is also the offer.
6. **Take one ask, at the end.** Not three.
7. **Twenty minutes.** Say twenty and end at twenty; ask for the next conversation instead of
   running long.

## Write these down *before* the call

The point of listing them first is that you can't retro-fit the result. For each, decide what would
count as contradicting it, then mark it after the call. Suggested starting set — replace any of
these with sharper ones as real calls sharpen them:

| # | Hypothesis | What would contradict it |
| --- | --- | --- |
| 1 | The morning-of paperwork scramble is a real, recurring pain | They describe the morning as fine, or the pain is elsewhere entirely (staffing, weather, retail margin) |
| 2 | The boat is where the current system stops working | They never take a device on the boat and don't want to; paper is a deliberate choice, not a gap |
| 3 | Missing waivers / unverified cards actually delay departures | It happens rarely, or they handle it at the counter and it never reaches the boat |
| 4 | The person answering the phone is the person who decides | Decisions run through an owner who is never on site, or a franchise/regional office |
| 5 | Switching cost is the blocker, not price | Price is the first objection and stays the objection after the free pilot is explained |
| 6 | They would let outside software hold waivers and medical answers | Any hesitation here is a large finding — it touches H-01–H-03 and the pilot agreement |
| 7 | Marina/dock connectivity is genuinely bad for them | Signal is fine where they operate, which would demote the offline manifest for this shop |
| 8 | "Leave anytime" portability matters to them | They've never been locked in, don't expect to be, and the export button lands flat |

## The call

### 0. Opening — 30 seconds, no pitch

> "Hi — my name's Aaron. I'm not selling anything today. I'm building software for dive shops and
> I'd rather understand how yours actually runs before I assume anything. Do you have twenty
> minutes, or is there a better time this week?"

Then something specific from your pre-call research: their published schedule, their site, the way
their booking page works. It proves you did the reading and it starts them talking about their
operation instead of your software.

If they ask what it is before you've asked anything: one sentence, then back to them. "Bookings,
waivers, cert checks, trip prep and the boat manifest in one place — but honestly, tell me how you
do those now first."

### A. How the day actually runs

- Walk me through last Saturday, from opening to the boat leaving. Who did what?
- How does a diver end up on a boat — where does the booking come from, and who touches it after?
- Who makes the boarding list, and what is it on when the boat leaves?
- What time does the front desk start on a trip morning, and what are they doing in that hour?
- What went wrong last month that shouldn't have?

### B. Paperwork, certification, and the dock

- When do you get waivers signed? What percentage arrive before the day?
- Who reads the medical questions, and what happens when one is a yes?
- How do you check a certification card? What do you do when someone shows up without one?
- Has a boat ever left with someone it shouldn't have had aboard, or without someone it should?
  What happened next?
- Who does the head count, and how do you know it was right?
- On the water — is there a second count after the dive? What is it recorded on?

### C. Systems, money, and the cost of change

- What do you use today for bookings? For waivers? For the manifest? *(Ask separately. Three
  answers is a common shape and it's the shape the product is built against.)*
- What do you pay for it, and what does it not do?
- When did you last change systems? What made you, and what was the migration like?
- If you left your current system tomorrow, what would you lose?
- Who would have to agree to a change — you, a partner, a manager, an accountant?

### D. The disconfirming questions — ask these even when the call is going well

These are the ones that should make you walk away, and they are the reason the call exists.

- What would have to be true for you *not* to be interested in something like this? *(Then stop
  talking.)*
- If I built exactly what you just described and gave it to you free, what would still stop you from
  using it on a real trip?
- What's the last piece of software someone sold you that you stopped using? Why?
- Is the boat manifest actually a problem for you, or is paper fine? *(Ask it that plainly. A "paper
  is fine" is a load-bearing finding, not a rejection to be overcome.)*
- What would your insurer say about digital waivers?
- Who in your shop would hate this?
- Am I talking to the wrong person? Who runs the boat side?

### E. Only if they ask: the offer

Say it in the [one-pager's exact terms](../stakeholders/design-partner-one-pager.md) — free through
the pilot, founder-run concierge migration (they send their own export; DiveDay never logs into
another system on their behalf), a weekly call, a direct line to you, and the founding price with
its two-year lock if it converts. Speak the price from the live pricing page; it is never a figure
on paper.

In exchange: real dive days, permission to watch, and — only if it goes well — a named quote.

**Do not add anything.** Not a discount, not a feature, not a date. Anything they ask for beyond the
written offer gets "let me think about that properly and come back to you", written down, and taken
away. Improvising a commitment in the room is how a pilot ends up owed something nobody authorized
(H-12 and the [claims policy](../marketing.md#claims-policy-hard-rules)).

### F. The close — one ask

Pick the smallest ask that moves it, and only one:

- **Best:** "Can I come to the dock on a trip morning and just watch?" (Costs them nothing, and it
  doubles as the [V-02 boat day](v-02-field-test-run-sheet.md).)
- **Good:** "Can you send me an export from your current system so I can show you exactly what would
  come across?" (Concierge migration is authorized, and it is the importer's first real-data test.)
- **Fine:** "Can we talk again after you've thought about it — same time next week?"
- **Also fine:** "Who else should I be asking these questions to?"

If the answer to everything is no: ask what you got wrong, thank them, and end early. That is the
call working.

## Within ten minutes of hanging up

Write it while it's warm. A call note that isn't written the same hour is a call that didn't happen.

- Date, shop, region, who you spoke to and their role.
- **Their words, quoted**, on the two or three things that mattered — not your paraphrase. Quotes
  are the only thing that survives contact with your own assumptions, and (with their consent, which
  lives in the pilot agreement, never in a call) they are what a case study is later made of.
- Each hypothesis above marked supported / contradicted / untested, with the sentence that decided
  it.
- What they use today, and what it costs them.
- The one thing that surprised you.
- Next action and date, or `parked` plus the reason.

Where it goes:

- **Product findings** — something DiveDay does wrong or doesn't do — become tickets in
  [features/story-backlog.md](../features/story-backlog.md); safety findings follow the stop-the-line
  rule in [dive-operations.md](../stakeholders/dive-operations.md).
- **A committed pilot** is V-04 evidence and a phase-progress note in
  [rollout.md](../rollout.md); the status lives in
  [human-decisions.md](../human-decisions.md#human-verification-queue), never in this kit.
- **A repeated finding across calls** that changes who we think the buyer is belongs in
  [personas.md](../personas.md) — with a note that it came from a real conversation, since today
  every line in that file is synthetic.
- **Nothing** goes onto a public page. A real customer's words reach a marketing surface only
  through the product owner, per the [claims policy](../marketing.md#claims-policy-hard-rules).
