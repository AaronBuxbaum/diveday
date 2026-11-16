# Owner and manager

Dana (solo owner at 6am) and Maren (weekly admin). See [personas.md](../personas.md#8-dana--the-solo-owner-at-6am).

### OWN-01 Staff sign in and out

As Dana, I sign in to my shop and sign out to lock it.

**Done when**
- A staff sign-in lands on the dashboard and sign-out locks it again.
- A wrong password says so in friendly words and stays signed out.

### OWN-02 Each role sees only what it may touch

As Dana, I can give the crew the daily work without giving them money or legal pages.

**Done when**
- A captain is denied money, legal, deletion and trip configuration.
- A refused page says why, and the owner reaches every page.

### OWN-03 One shop never reaches another's

As Dana, nobody from another shop can read or open my shop's pages.

**Done when**
- A second shop's owner reaches none of the first shop's staff surfaces.

### OWN-04 The shop owns its data

As Dana, I can download everything the shop holds, and erase a deleted diver.

**Done when**
- Staff download the whole shop as documented CSVs, and an export never leaves without a session.
- Erase is absent on a live diver and appears once they are deleted.

### OWN-05 Staff schedule and cancel trips

As Dana, a trip I schedule is bookable, and one I cancel leaves the public schedule.

**Done when**
- A scheduled trip appears publicly and a cancelled one is removed.
- A crew-conditions hold pauses public booking and explains the final-call state.

### WAIV-10 The shop edits its waiver and keeps every version

As Maren, I can change the shop's waiver and each change is kept as a version.

**Done when**
- An edit makes a new version and saving it unchanged publishes nothing.
- A shop question is published, answered by the diver and shown on the signed record.

### WAIV-11 A medical hold ends with a recorded physician's clearance

As Dana, a diver on medical hold does not board until staff record a physician's clearance.

**Done when**
- Staff recording a physician's clearance ends the hold; nothing else lifts it, and the diver does not board while it stands.
- The roster leads to the record.
- A refused evaluation stops the chase without lifting the hold.

### WAIV-12 The signed waiver audit is findable and owner-only

As Maren, I can search signed waivers by diver and narrow to medical holds.

**Done when**
- The audit pages both ways, searches by diver, and narrows to medical holds.
- Staff outside owner and manager cannot open the editor or the audit.

### PAY-07 The owner bills a diver and sees what was collected

As Dana, I can send an invoice and see what each statement collected.

**Done when**
- An invoice without a priced line, or with an out-of-bounds one, is refused before Stripe.
- A captain is offered no order form.
- Recorded statements keep original-rate credits and native currencies apart.
- A repeat Update records only the new money.

### PAY-08 The day's takings wait for the day to close

As Dana, I see the takings once every boat is back, and the crew does not see them.

**Done when**
- Takings are held back while a boat is still out and read to an owner afterward.
- A captain sees no takings.

### OWN-09 An instructor owns cohort preparation follow-up

As the assigned instructor or shop manager, I can see each student’s missing preparation and take responsibility for helping them finish it.

**Done when**
- Students needing help appear first, with textual missing items that wrap on phones.
- Staff can take or release a student’s follow-up without marking forms, cards, payment, or materials complete.
- A manager can take over work from an inactive staff member, and a stale tab cannot overwrite a newer claim.
- Complete preparation comes from the existing records and makes no certification or boarding promise.
