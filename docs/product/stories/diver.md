# Diver

Nadia (first-timer), Tomas (certified traveler on a phone), Marco (repeat local), Rob (the night
before), Amara (after the trip). See [personas.md](../personas.md).

### BOOK-01 A diver books a seat

As Tomas, I can pick a boat from the shop's public page and book my seat without calling anyone, so
I know I am going.

**Done when**
- The boat is on the public schedule and shows its price.
- After booking, the diver sees a confirmation and the crew's roster shows them.

### BOOK-02 A full boat takes a wait list, not a seat

As Nadia, when the boat I want is full I can ask to be told if a seat opens, so I am not turned away
with nothing.

**Done when**
- A full boat offers the wait list instead of a booking.
- Joining the wait list does not take a seat or change the boat's count.

### BOOK-03 A refusal says the true reason

As Nadia, if the shop will not sell me this boat I am told exactly why, above the form and again at
the refusal, so I never wonder whether it was a mistake.

**Done when**
- The trip page says what the charter asks of divers before the form.
- A refused booking names that same requirement.
- A diver the shop knows nothing about is not screened at the sale; boarding readiness still gates them.

### BOOK-04 Booking works in Spanish

As Ingrid, I can book a seat from start to finish in my own language, so I trust what I am agreeing
to.

**Done when**
- With a Spanish browser, every word of the booking walk is Spanish.

### BOOK-05 A diver gives up their own seat

As Marco, I can release my seat from my own link when plans change, so the shop can sell it again.

**Done when**
- The diver's link has a release action, and the shop sees the seat open.
- A link that no longer works still names the shop and how to reach them.

### BOOK-06 A returning diver is not re-interrogated

As Marco, my next booking on the same phone is prefilled, with one tap to say it is not me.

**Done when**
- The booking form carries my details from last time.
- The shop's embed widget never remembers anyone, and a refused repeat booking saves nothing.

### BOOK-07 The shop's page leads with the shop

As Tomas, on my phone I see the shop first, then the next boat, then the booking form.

**Done when**
- At phone width the page reads shop, next boat, booking form, in that order.

### BOOK-08 A dead link keeps the diver at the shop

As Tomas, a stale or mistyped link still lands me at the shop I was trying to reach.

**Done when**
- A missing departure and a mistyped page under a shop both show that shop's own page.

### BOOK-09 Jargon gets a plain hint

As Nadia, a term like "two-tank trip" or "nitrox" is explained the first time I meet it.

**Judged:** the weekly persona walk and a read of the public schedule on the demo shop.

### PAY-01 A diver pays by card at booking

As Tomas, I can pay for my seat when I book, so I am not asked again.

**Done when**
- The card payment settles the booking's Pay step and the diver sees it paid.

### PAY-02 A promo code is honored, and a bad code is refused plainly

As Marco, I can enter a shop's code and see it taken off.

**Done when**
- A live code is accepted on a payable trip.
- A spent code and one that never existed are refused in the same words.
- No promo box shows while the shop has no live code.

### PAY-03 A cancelled seat gets its money back by the shop's rules

As Marco, if I cancel inside the shop's free window my card is refunded, and if I cancel late I am
told the money is forfeit.

**Done when**
- A Stripe payment is refunded in full inside the window and no money moves past the deadline.
- A failed refund leaves the seat showing as owed, never as settled.
- Cancelling twice moves money once.

### PAY-04 A card that fails keeps the diver's place

As Tomas, if my card is declined I am told in words and can try again without losing my seat.

**Gap:** #4575 no test exercises a declined card at booking.

### WAIV-01 A diver signs a waiver and answers the medical form

As Rob, I can sign from the link in my email at night, and a "yes" on the medical form is met with
reassurance and a follow-up, not a cancelled trip.

**Done when**
- One send gives the diver a link they can resume.
- A medical yes surfaces follow-up to the shop and is never pre-answered.
- The diver does not board until the shop records a physician's clearance: a yes is a block, not a warning.

### WAIV-02 The medical form cannot be skipped

As the shop, I can trust that every medical question was answered by the diver.

**Done when**
- A submit with an unanswered question is refused, even if the page's own checks are bypassed.
- A contact filled halfway is refused, not stitched together.

### WAIV-03 A waiver is signed under the diver's own name

As the shop, I know the name on a signed waiver is the diver's.

**Done when**
- A waiver signed under someone else's name is refused and the link stays signable.

### WAIV-04 A half-finished waiver is kept

As Rob, if I stop halfway my answers are still there when I come back.

**Done when**
- A saved draft keeps partial answers, including conditional questions, and reopens on the right step.

### WAIV-05 A diver who does not read English is told the waiver stays English

As Ingrid, I am told before I sign that the legal text is in English only.

**Done when**
- A non-English visitor sees a notice saying so.

### WAIV-06 A diver's medical alert reaches the crew

As Rob, something the crew must know before we leave is signed by me, flagged on the manifest, and
read from my record.

**Done when**
- The alert is on the signed record, flagged on the departure's manifest, and its reads are logged.

### READY-01 A diver prepares from their own link

As Rob, one link shows what is left to do before the dive (card, waiver, forms) and answers my
questions.

**Done when**
- The page lets the diver act on each open item and explains what each one is for.

### READY-02 A guessed or tampered link reveals nothing

As the shop, I know a changed link shows no one's details.

**Done when**
- A link with an altered token opens no diver and still leaves a way to contact the shop.

### READY-03 A diver can say they are running late

As Rob, I can tell the shop I am late from my link, or by replying, and take it back.

**Done when**
- The desk sees the diver said so and when.
- The diver can undo it from the same link.
- A reply of LATE marks the seat and the inbox explains it.

### READY-04 A diver types in their own card for staff to verify

As Tomas, I can enter my certification from my link and the desk verifies it there.

**Done when**
- The entered card appears for staff to verify, and a diver with no card says so to the desk.

### RECAP-01 After the trip, the memory comes before the ask

As Amara, I see my trip first and am asked for a review once, not repeatedly.

**Done when**
- The external review ask appears once, right after any on-page rating.
