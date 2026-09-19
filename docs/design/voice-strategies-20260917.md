# Six voices for the public pages (proposed, 2026-09-17)

**Status: proposed.** Nothing here is the DiveDay voice until the product owner picks one; then the
pick moves into [brand.md](brand.md) as the current identity and this document becomes the dated
record of the alternatives. The decision itself is the owner's and goes in
[product/human-decisions.md](../product/human-decisions.md).

The owner's brief (2026-09-17): the public pages (`/`, `/product`, `/pricing`, `/about`,
`/onboard`, `/switching/*`, `/dive/*`, `/status`, `/privacy`, `/terms`) all read as machine-written
despite the September sweep. Define one human voice from the top down, show it applied to one page
under each of at least five strategies, let the owner pick, then rewrite every public page in it.

## Why the pages still read as machine-written

The 2026-09-03 sweep ("What gives us away" in [brand.md](brand.md)) removed the words a model
overuses. It left the shapes. Measured over the five marketing pages' bundle strings
(`marketing.home|about|pricing|product|features|price|export|common` and
`switching.hub|common|concierge`, 310 strings, 267 sentences):

| Tell | Evidence |
| --- | --- |
| The mirrored pair | "nothing gets asked twice and nothing gets missed once" (product); "come in with a file and leave with a button" (switching hub); "a busy August as in a quiet January" (pricing); "The desk clears it in the morning. The captain sees it at the dock." (home) |
| The list of three, with a tail | "fast, clear, and forgiving enough that a crew reaches for it without being told to"; "paper never crashes, never logs you out, and never needs five taps"; "a question, a doubt, a bad morning at the counter" |
| The tag sentence | 36 sentences of five words or fewer, most of them a beat after a longer sentence: "One answer, all day." "Better now than after the move." "Keep them useful." "Nothing monthly." |
| Absolutes as rhythm | *nothing / never / every / nobody* in 44 of 267 sentences, one in six |
| The house phrase, reused | "from day one" ×7, "a real person" ×4, "go and do / try" ×4, "says which thing" ×3, "the water side" ×3, "wet thumbs / hands" ×3, "one ZIP / button / number / price" ×16 |
| Nothing a person would know | No date, town, or named person on the five pages beyond the founder's first name and the competitors. The claims policy forbids inventing these; it does not forbid the owner supplying them |
| One temperature everywhere | Twelve first-person pronouns across five pages, all in one section. No joke, no "I don't know yet", no paragraph that runs long because the writer cared |
| Every sentence has to resolve | Almost no sentence is allowed to just be true; each ends on its consequence for the reader ("so you find the missing one while there is still time") |

## What every strategy does, whichever is picked

- **One author, one sitting.** Each page is drafted as a whole document, then split into bundle keys. The keys are written one at a time today, which is how "from day one" arrived seven times.
- **Ban shapes, not words.** `pnpm check:voice` gains four refusals: a sentence that mirrors itself, a list of three with a tail, a sentence under six words carrying no noun or number, and a phrase appearing on more than two pages.
- **Uneven on purpose.** Every page has a sentence under five words and one over thirty, and one place the writer visibly cares more.
- **A sentence may just be true.** A consequence clause ("so you…") is cut unless the reader could not have inferred it.
- **Facts only a person has** come from the owner, once (the questions at the end). Nothing is invented on his behalf.
- **The demo stays the proof**, the two doors keep their order, and the claims policy in [product/marketing.md](../product/marketing.md) is untouched.

Every sample below keeps the claims policy: shipped-only, no invented proof, the price shown as the
literal it renders from `src/lib/marketing.ts`, founder facts only where confirmed. A bracketed
`[…]` is a fact only the owner can supply. The sample shop's names (Blue Mantis Divers, Mantis I,
Molasses Reef, the seeded divers and crew) come from `src/db/seed.ts` and are used only where the
page says it is the sample shop.

## 1. The Letter

One named person wrote every public page and says so. The site is correspondence from Aaron to a
shop owner he has not met. Confidence comes from specifics and from not hedging the product.

- **Who talks:** Aaron, first person, to one owner. "We" only for what both people share.
- **Rules:** no sentence anyone else could sign; headings are labels ("What it costs", "If you leave"); paragraphs run as long as the point needs; one joke per page at most, about the work; a sign-off is allowed, a flourish is not; the support line stays inside H-12 / H-26 (someone reads it, no personal-response promise).
- **brand.md change:** the voice moves from "a divemaster's briefing" (a persona) to "Aaron, writing" (a person).
- **Strains:** it makes the owner the brand; the e2e test banning apology for size still applies; Spanish needs a translator who can carry a first-person voice.
- **Scales:** well. `/about` is its natural home, `/pricing` is "what it costs", a guide is "if you're on FareHarbor", `/privacy` and `/terms` are the same person being careful.

### Homepage

Eyebrow: From Aaron, who builds DiveDay

H1: DiveDay is software for running a dive shop's day.

Hi.

DiveDay runs the part of a dive shop between someone booking a seat and the boat coming back: the bookings, the waivers, the certification checks, the gear pull, the head count. I'm Aaron. I write the software, and I wrote this page.

It started with a shop owner walking me through his morning. He had a whiteboard for the boats, a clipboard for the manifest, a spreadsheet someone updated by hand, and a few apps that didn't know about each other. He was paying for all of it, and then paying again in the hours it took to keep them agreeing with each other. [the year, and the town if you want it here] I went home and started writing down what that morning should have looked like.

This is the version that exists today. Divers book and pay on your schedule page. Their waiver, their card and their wetsuit size come in before they do. On the morning of a trip the desk sees one list, and if a diver is missing something the list says what it is. The captain sees the same list on a phone at the dock, and it keeps working after the signal stops. That evening each diver gets a page with the day's dives on it, to send to whoever they want to bring next time.

It costs $99 a month for the shop. There are no seats to count and I don't take a cut of your bookings. If it turns out to be wrong for you, Settings has a button that downloads every record as spreadsheets, and it works on the first day of a trial.

The quickest way to judge any of this is to open the demo shop and run the captain's roll call yourself. It takes about two minutes and there is no form.

Aaron

[Try the live demo] [Start a trial] · The demo is a sample shop. No sign-up and no card.

Three screens from the letter (readiness list, roll call, the diver's evening page), one caption each:

- The list the desk reads in the morning. One name is blocked, and the reason is written beside it: a card that came in from a spreadsheet and hasn't been confirmed by staff.
- The captain's phone at the dock. Saved to the phone before leaving, so the count keeps working with no signal. It reads eleven of twelve until the twelfth name is tapped.
- What the diver gets that evening. The two sites, a note from the crew, room for their own photos, and your shop's name on it.

The terms, so you don't have to email to ask:

- Price: $99 a month per shop location. Founding shops keep that price for two years.
- Trial: three weeks, free, no card. Nothing switches off when it ends.
- Payments: through your own Stripe account. Their fees are between you and them.
- Leaving: one ZIP of documented CSV files from Settings, any day, no fee.
- Not in it: a retail register, repair work orders, a live link to PADI or SSI.
- Support: support@dive.day. Someone here reads it, and there is no ticket form in front of it.

## 2. One Morning at Blue Mantis

Do not describe the product. Show a Saturday in the sample shop minute by minute and let the reader
open the demo at any timestamp. A reporter's voice: present tense, exact times, names, what is on
the screen, no evaluation.

- **Who talks:** nobody. The page watches. The software never appears as a subject; a person sees something on a screen.
- **Rules:** present tense; every entry carries a time and a name or a number; detail is administrative (a tank count), never atmospheric; no adjectives about the software; every moment ends in a door into the demo as that role; the page says at the top that Blue Mantis is the sample shop; times, counts and names match the seed and move with it.
- **brand.md change:** "lead with the outcome" becomes "show the moment"; the sample shop is the only proof the pages carry, and they say so.
- **Strains:** fiction in a labelled sample, so the label must never slip; `seed.ts` becomes copy; pricing, privacy and terms need the notice-board register beside it; vivid detail creeps in.
- **Scales:** product and switching pages, yes. About, pricing, privacy and terms need voice 3.

### Homepage

Eyebrow: The sample shop, one Saturday

H1: 6:40 AM at Blue Mantis Divers.

Blue Mantis is the sample shop inside DiveDay's demo. It is not a customer and nobody in it is real. Every screen below is one you can open. This is its Saturday.

6:40 · The desk opens Today. Two departures: Mantis I at 8:00 for Molasses Reef and French Reef with twelve booked, and Mantis II at 1:00. Two of the twelve are on the blocked side of the list. One has not signed the waiver. The other has a nitrox card that arrived in a spreadsheet import, and nobody on staff has confirmed it. → Open Today as the owner

6:55 · The desk sends the waiver link. It is signed from a hotel room seven minutes later, and the name moves to the ready side on its own.

7:10 · Mateo pulls gear from the prep list. Seven rental sets, sizes already on it because the divers typed them when they booked. Twenty-four tanks. Four are nitrox, and each of those is checked against the diver it is for before it goes on the boat. → Open the prep list as the divemaster

7:35 · The captain opens the manifest on a phone at the dock and saves it to the phone. At the ramp there is one bar of signal, then none. The roll call keeps working. → Open the manifest as the captain

7:52 · Eleven names tapped. The head count reads eleven of twelve and stays there until somebody taps the twelfth. The nitrox diver is still on the blocked side, and the captain can see that from the dock without calling the desk.

8:00 · Mantis I leaves with eleven. The desk sees eleven.

12:40 · Back at the dock. Every tap from the morning is in the boarding history, including the one the captain undid. The two taps made with no signal are marked as such, and nothing from the desk was written over.

6:15 PM · Each of the eleven gets a page: the two sites, the depths, a note from Mateo, and space for their own photos. One of them sends it to a buddy who has not dived since 2019. → Open a recap as a diver

What it costs: $99 a month for the shop. No seats, no cut of bookings, and payments through your own Stripe account. The trial is three weeks with no card, and the export button in Settings works on the first day.

[Try the live demo] [Start a trial] · The demo is the shop above. No sign-up and no card.

(Times and counts above are illustrative; the implementing session aligns them with the seeded Saturday.)

## 3. The Notice Board

The most human thing a page can do in 2026 is refuse to perform. One screen of facts in the order
an owner asks them, written like a notice pinned beside the till.

- **Who talks:** the notice board. Someone who would rather be diving wrote it once.
- **Rules:** a fact per line, statements only; no sentence over twenty words; "No." is a complete answer; headings are nouns; digits for numbers; the doors come first; nothing animates.
- **brand.md change:** "lead with the outcome" retires; the four-card breadth band and the daily moments go; the spine becomes three lines of fact.
- **Strains:** conversion (the page makes no argument, and that is the bet); cold beside "delight-first", so the delight has to come from the demo one click away; fewer words for a crawler.
- **Scales:** to pricing, privacy, terms and status perfectly. `/about` and `/product` become short.

### Homepage

H1: DiveDay

Software for a dive shop's day. Bookings, waivers, certification checks, gear, the boat's head count.

[Try the live demo] [Start a trial] · The demo is a sample shop. No sign-up.

What it does

- A schedule page divers book and pay from, on your website or on ours.
- A readiness list for the desk. A diver missing a waiver, a card or a payment is marked blocked, with the reason.
- A manifest on the captain's phone. Works with no signal once saved to the phone.
- A prep list built from the sizes divers typed when they booked.
- A page for each diver after the trip.
- Courses, rental gear, discount codes, gift bookings, and a weekly backup to storage you own.

Price

- $99 a month per shop location.
- No setup fee. No charge per login. No cut of bookings.
- Founding shops keep this price for 2 years.
- Card payments run through your own Stripe account. Stripe's fees are Stripe's.

Trial: 3 weeks. Free. No card. Nothing switches off when it ends.

Not included

- A retail register.
- Repair work orders.
- A live connection to PADI or SSI. No agency allows one. Staff confirm cards by hand.
- A second location on one shop. Email us if you run two.

Leaving: Settings has a Data export button. One ZIP of CSV files: divers, bookings, waivers, payment history, photos. Works on the first day of a trial. No fee.

Arriving: Upload a spreadsheet. Before anything saves you see what will happen to each column. Or email the file and a person does it with you. Free.

Support: support@dive.day. A person reads it.

Built by: Two people who dive. [anything else you want here, or leave it at that]

## 4. Over a Beer

Write the way the best diver in the shop explains the software to a mate after the boat is tied up.
Contractions, asides, one joke that lands, paragraphs that run long where the speaker cares and stop
dead where they don't.

- **Who talks:** someone from DiveDay who dives, to a shop owner who asked. Headings are the owner's questions verbatim.
- **Rules:** contractions always; "honestly" and "look" get a budget of one each per page; no heading argues; paragraph length varies from one line to eight; no bullet lists; "I don't know yet" allowed; a joke is about the work, never the product; concede facts flat with no flinch; no "people love the…" because with zero customers there are no people yet.
- **brand.md change:** the intensifier and knowing-aside bans become budgets; "briefing" leaves the voice table; humour joins "warm and plainspoken".
- **Strains:** humour is the hardest thing to keep human across 300 strings and two languages, and rots into "quirky startup" voice; privacy and terms need voice 3; Spanish needs a native writer.
- **Scales:** FAQ-shaped pages well. Privacy, terms and status need the notice-board register.

### Homepage

H1: It runs the dive day. The bit between somebody booking and the boat coming back.

So what is it

Software for the part of a dive shop that isn't the till. Someone books a seat on Saturday's boat, and everything that has to happen between that and the head count at the dock is in here: the waiver, the card check, what size wetsuit they need, whether they've paid, who's on the boat and who isn't. Your desk sees it, your captain sees it on a phone, and it's the same list.

What's the catch

Two things. It doesn't do retail, so keep your register. And you'd be one of the first shops on it. That's why the demo is a whole sample shop you can open without signing up for anything, and why the export button works on day one of a trial. If it's wrong for you, you leave with your spreadsheets and we've cost you an afternoon.

How much

$99 a month for the shop. Not per person, so put the whole crew on it. We don't take a cut of bookings. Card payments go through your own Stripe account, and Stripe's fees are Stripe's, nothing to do with us. Sign up now and the price stays where it is for two years.

What happens when my captain drops the phone in the bilge

He gets another phone and signs in. The manifest lives in your shop, not on the phone. What lives on the phone is a copy he saves before leaving the dock, so the roll call works out at the ramp where there's no signal. Anything he taps out there is marked as tapped offline until the phone's back in range, and it never writes over what the desk did.

Does it talk to PADI

No, and neither does anything else, whatever the brochure says. No agency lets software check a card. Your staff look at the card, tap confirm, and it's on the diver's record from then on.

The bit I'd show you first

The roll call. Big buttons, one per diver, and a head count that won't read twelve until twelve names have been tapped. Open the demo as the captain. The boat leaves at eight.

I've already got a spreadsheet

Bring it. You upload it and, before anything's saved, you get a preview of what it read from each column and what it's going to ignore. Or send it to us and somebody here does the import with you, for nothing. Same offer in reverse if you ever leave.

Right. Go and try it

[Try the live demo] [Start a trial] · There's no form. The trial is three weeks, no card, and nothing turns off at the end.

Support is support@dive.day. A person reads it. Say hi.

## 5. The Argument

The site has a thesis someone could disagree with: dive shops keep the whiteboard because their
software was built for an office, and the fix is software that starts at the dock and refuses to
guess. The homepage argues it in prose and shows the product as the consequence.

- **Who talks:** a person with a point of view, citing what he saw (the founder's own observation, allowed by the claims policy) and what the product does (linked).
- **Rules:** every paragraph advances the argument one step and makes one claim; evidence is "I saw this" or "the product does this"; never assume agreement; no lists of three; industry generalisations need a cited source or the owner's name behind them.
- **brand.md change:** "warm" softens to "direct"; a page has a thesis and a section that does not advance it is cut.
- **Strains:** length, with the doors 500 words down; it leans on the owner's observations, each of which he must stand behind or soften to the one shop he saw; an argument voice is a positioning choice as well as a voice choice.
- **Scales:** `/about` and the guides naturally; `/pricing` becomes a short argument for a flat price; privacy and terms need voice 3.

### Homepage

H1: Dive shops keep the whiteboard because the software was built for an office.

The shop that started this ran on a whiteboard, a clipboard, a spreadsheet and a few apps that didn't talk to each other. The owner apologised for it. [confirm he did, or cut this line] He shouldn't have. The whiteboard is on the wall because you can read it from the door, it never logs anyone out, and a wet hand can change it. The software he was paying for couldn't say any of that.

That software was built for a back office: a desk, a chair, dry hands, a good connection. A dive shop's day happens somewhere else. It happens at a counter with a queue, on a dock with one bar of signal, and on a boat where the person holding the manifest is also holding a rail. Software that assumes an office fails exactly where the day is hardest, so the crew keeps paper for those moments and the software becomes a second job.

The second problem matters more. Booking software treats the booking as the end of the work. For a dive shop it is the start. After it come the waiver, the certification, the medical answers, the sizes, the payment, the tank, and somebody deciding whether this person gets on the boat. When a field is blank, software built to sell seats waves the diver through. Paper doesn't. A divemaster with a clipboard sees the blank.

So DiveDay is built the other way round: from the dock, back to the booking. The manifest is a phone screen with buttons a wet thumb can hit, saved to the phone before the boat leaves so it works without signal. The readiness list won't call a diver ready while any one thing is unconfirmed, and it says which thing. The prep list is written from the sizes divers typed when they booked. The booking, the waiver, the card and the money sit on the same trip, so nobody is asked twice.

The price follows from the same idea. A shop is one thing, so the price is one number: $99 a month, every login you need, no cut of your bookings. And because this argument is easy to make and hard to prove, the demo is a whole working shop you can open now without signing up, and the export button gives every record back as spreadsheets from the first day of a trial.

[Try the live demo] [Start a trial] · The demo is a sample shop. No sign-up and no card.

The three screens the argument rests on (roll call with no signal; the readiness list naming the blank field; the prep list from booked sizes), each captioned with the paragraph it proves.

## 6. Margin Notes

Stop writing marketing copy. The homepage is four of the product's own screens with short notes
from the person who built them, pointing at specific things. The brand voice is the builder's note.

- **Who talks:** the builder, in the margin, to someone looking over his shoulder. The app's own words are quoted as they appear.
- **Rules:** a note is under twenty words and names one visible thing; it may give a reason or a limit, never an evaluation; what is deliberately missing gets a note too; first person allowed; a note never asks for anything; every screen ends in one door into the demo as that role; the mockup mirrors the real screen element for element.
- **brand.md change:** a second register, "builder's note", joins the product voice; "narrative copy" stops being a category the marketing pages have.
- **Strains:** the mockups become load-bearing and their notes are re-read whenever a screen changes; on a phone the notes stack under the screen; `/about`, `/privacy` and `/terms` are not screens.
- **Scales:** `/product` and every guide become annotated screens; `/pricing` can be an annotated invoice; the rest needs voice 1 or 3.

### Homepage

H1: Four screens from a dive shop's day, with notes from the person who made them.

All four are in the demo shop. Open any of them and try what the notes say.

The schedule a diver books from

1. The seat count is live. When the boat is full the button says so.
2. Wetsuit and BCD sizes are asked here, at booking, so nobody asks at the counter.
3. The diver never makes an account. The confirmation email has the link to everything.
4. Goes on your website as an embed, or lives on ours in your colours.
→ Book a seat in the demo

The readiness list, morning of

1. "Blocked" is a word, not a colour, because the desk phone is sometimes in sunlight.
2. Every blocked name says why. This one: a card that came in from a spreadsheet and nobody has confirmed.
3. There is no "mark everyone ready" button, on purpose.
4. Payment counts as readiness. A deposit with a balance due shows up here, not at the ramp.
→ Open Today as the owner

Roll call, on the captain's phone

1. Buttons this big so a wet thumb hits the right name.
2. The head count is per dive. It reads 11 of 12 until the twelfth name is tapped.
3. "Save to this phone" before leaving the dock. After that it works with no signal.
4. Every tap is kept, undos included. Nothing is written over when the phone comes back in range.
→ Run the roll call as the captain

What the diver gets that evening

1. The two sites, the depths, a note from the crew.
2. Their photos go here. We don't put ours in.
3. One ask for a review. Once.
4. Your shop's name on it, not ours.
→ Open a recap as a diver

Price and terms: $99 a month per shop location, every login included, no cut of bookings. Three-week trial, no card. The export in Settings is one ZIP and works on day one. Email support@dive.day; a person reads it.

[Try the live demo] [Start a trial] · The demo is the shop in the screens above. No sign-up and no card.

## Side by side

| Voice | Who talks | Homepage becomes | Heat | Covers privacy / terms / status | Claims-policy exposure | Needs from the owner | Drifts back to AI cadence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 The Letter | Aaron, first person | A letter, three exhibits, the terms | Warm, level | Yes | Low; support line must stay impersonal | His name on it; a year; maybe a town | Low |
| 2 One Morning | Nobody; the page watches | A timestamped Saturday in the sample shop | Cool, exact | No; second register | Medium; the label must never slip | Nothing, but the seed becomes copy | Medium |
| 3 Notice Board | The notice by the till | One screen of facts, doors first | Cold, flat | Perfectly | Lowest | One line for "built by" | Lowest |
| 4 Over a Beer | Someone here who dives | The owner's questions, answered as speech | Warm, uneven | No; second register | Medium; humour tempts invented proof | His jokes, or permission to make them | High |
| 5 The Argument | A person with a thesis | A 500-word case, then three screens | Direct, dry | No; second register | Medium; generalisations need a name or a source | Which observations he stands behind | Medium |
| 6 Margin Notes | The builder, in the margin | Four real screens, annotated | Terse, specific | No; second register | Low | Two or three "why I did it this way" facts | Low |

**Recommendation:** 1, The Letter, with 3's discipline on the pages that are lists. DiveDay has one
author and the only voice that cannot be imitated is his; the facts a person would know arrive for
free; it covers every page without a second register; and it turns the retired founder-support
liability into the thing a burned buyer wants most, a name. The cost is that the owner's name is on
the homepage. If that is not wanted, 6 (Margin Notes) with 1's register on `/about` is the second
pick: nothing else in the market looks like it, and a twenty-word note has no room for a rhetorical
shape.

## Questions only the owner can answer

1. When the conversation with the shop owner happened, and whether the town can be named.
2. Whether his name goes on the homepage (voice 1) or stays on `/about` only.
3. Whether "we read it" is true of support today, or it stays "a person reads it" under H-12 / H-26.
4. One thing he has changed his mind about while building this, in a sentence.
5. Whether the sample shop's setting, Key Largo, may be named on marketing pages (it is in the seed and visible in the demo).
6. Whether the second person on the team wants to be named or described at all.

## After the pick

Every public page is rewritten in the chosen voice; the four shape refusals join `pnpm check:voice`
so the pages cannot drift back; the voice is recorded in [brand.md](brand.md) as current rather
than proposed; `e2e/marketing.spec.ts`'s pinned headlines and `src/app/about/copy.test.ts` move
with the copy; the placeholders above go to the owner as a short list before anything ships. The
artifact that presented these six side by side is the same content as this document, rendered as
pages.
