# Front desk

Chloe, in a morning rush: a line of six, two walk-ins, one waiver that never arrived. See
[personas.md](../personas.md#9-chloe--front-desk-during-the-morning-rush).

### DESK-01 The counter checks a diver in

As Chloe, I find a diver, see live whether they are ready, and keep blocked divers out of the line.

**Done when**
- Search finds the diver's boat and shows their readiness as it is now.
- A blocked diver is not offered check-in.
- A phone number read off a record finds the seat.

### DESK-02 A blocked diver shows every reason

As Chloe, a diver blocked for several reasons shows all of them, and something to tap.

**Done when**
- Every reason is listed and none offers check-in.
- A checked-in diver who becomes blocked again shows as still to clear.

### DESK-03 A ready diver checks in with one tap

As Chloe, check-in is one tap, and a re-tap undoes it.

**Done when**
- The diver moves into the checked-in group on the tap and back out on undo.

### DESK-04 A walk-in books with a name alone

As Chloe, I can seat someone by name without asking for an email, and seat a family from one form.

**Done when**
- A diver added by name alone is booked, with no email required.
- A family is seated together from one form.
- A diver seated off the name prompt is blocked until staff confirm it is them.
- A walk-in seated from the prompt is confirmed and checked in without leaving the roster.

### DESK-05 A full boat offers the wait list

As Chloe, adding to a full boat offers the wait list and never a seat.

**Done when**
- The add band says the boat is full and offers the wait list.
- A wait-listed diver can later be invited to a seat.

### DESK-06 A paper waiver is recorded in place

As Chloe, when a diver signs on paper I record it on their row and they become checkable.

**Done when**
- Recording the paper waiver on the roster row clears the waiver blocker without leaving the page.
- It never clears a medical hold, and for a minor it never clears the missing guardian signature.

### DESK-07 A no-show's seat goes back on sale

As Chloe, I release a no-show's seat, offer it to the wait list, and the boat sells it again.

**Done when**
- The released seat is offered to the wait list and bookable by the public.

### DESK-08 A blocked diver is turned away before the boat leaves

As Chloe, I turn a blocked diver away, with the reason, and the seat comes free.

**Done when**
- The desk says why, frees the seat, and the diver is told the seat was released and is offered nothing to pay.

### DESK-09 A dropped signal fails on the row

As Chloe, when the connection drops the row says it failed, and the rest of the page keeps working.

**Done when**
- A failed action shows on its own row, not as a page error.

### CERT-01 Staff capture and verify a certification

As Chloe, I record a diver's level and specialties and verify them before either can be trusted.

**Done when**
- Level and specialty certifications are captured, then verified, and only then trusted.
- A diver record keeps card refusals visible and clears a wrong no-card stamp.

### CERT-02 The counter names the same refusal as the public page

As Chloe, when a booking is refused at the counter it names the same missing requirement the diver
would have seen online.

**Done when**
- The counter shows the signed gate detail, and a missing specialty reads as missing whatever the diver's level.

### PAY-05 The counter takes a payment with a moment to undo

As Chloe, I can record a payment and undo it inside a short hold, so a slip does not become a record.

**Done when**
- Undo inside the hold records nothing.
- The hold running out records the payment once.
- Leaving the page inside the hold records it then, not at the hourly sweep.

### PAY-06 Cancelling a paid counter booking flags the refund

As Chloe, cancelling a paid counter booking inside the free window flags a refund for the shop to
return, and past the deadline says the money is forfeit.

**Done when**
- Inside the window, the booking is flagged for a manual refund.
- Past the deadline, the refund is forfeited and the page says so.

### DESK-10 Offer an existing shore or pool departure after a weather call

As Chloe, when a boat departure is canceled, I can prioritize existing shore or pool departures
without moving a diver or changing what money is owed.

**Done when**
- Nothing is selected by default, and each diver receives only eligible available booking links.
- The selection survives an interrupted call; sent and queued offers retain their history.
- Departures affected by the same weather call are excluded from its offers.

### DESK-11 Record a local amount due and the receipt separately

As Chloe, I can add a rental or purchase to a named diver's unpaid order without connecting a
payment provider, then record how the full amount was received.

**Done when**
- Amount due and Already received are separate choices; walk-ins retain the received-only flow.
- An ancillary amount due never clears a trip fare, reserves equipment, or charges a card.
- Repeated or simultaneous receipt submissions create one receipt and one collection entry.
- Original receipt totals are grouped by method and shop-local day; returns with an unknown method
  remain separate and missing return amounts are visibly incomplete.

### DESK-12 Arrange complimentary classroom recovery after a cancellation

As Chloe, I can arrange a separate classroom activity, prepare offers and confirm places after contact while the original refunds continue.

**Done when**
- Staff confirm the room and coordinator arrangements; time, location and the shop’s place limit are explicit.
- Prepared offers, sent messages, confirmed places and original refunds remain distinct facts.
- Prepared message inquiry links use the canonical absolute public URL so they work when copied into email or text; unavailable origins fall back to shop contact.
- A public request is an unassigned inquiry; it does not identify a diver or allocate a place.
- Concurrent confirmations cannot exceed the limit; retries never revive a canceled place.
- Erasure leaves anonymous promised places held until staff explicitly cancel them.
- This does not create a diving booking, record attendance, satisfy course requirements or change money.
