# V-02 field-test run sheet — print this and take it on the boat

**Print it.** This is a sheet a person carries in a pocket next to a printed manifest, ticks with a
wet pen, and brings back. Do not run V-02 off a phone screen: the phone is the thing under test, and
a lock screen or a dead battery must not take the checklist down with it.

V-02 is [the single most important pre-pilot task](../rollout.md#03-field-validation-v-01-v-02-v-04-rehearsal).
The offline manifest is differentiator #2 and it has never met salt water. The evidence list of
record is the V-02 row in the
[verification queue](../human-decisions.md#human-verification-queue); this sheet is that row turned
into steps, matched against what the manifest surfaces actually do today
(`src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx`, `src/components/OfflineManifestView.tsx`,
`src/components/WaterLocker.tsx`).

Expected observations are printed so you can tick "as described" or write what really happened.
**Anything that differs is the finding** — do not smooth it out afterwards. A manifest or readiness
defect found here is a stop-the-line fix (AGENTS.md safety rules), not a punch-list item.

---

## Header — fill before leaving

| | |
| --- | --- |
| Date / time out / time in | |
| Boat, port, captain | |
| Weather, sea state, sun (overcast / hazy / full sun) | |
| Phone A — model, OS, browser, %battery at start | |
| Phone B (older/cheaper) — model, OS, browser, %battery | |
| Shop + trip under test (title, planned dives) | |
| Divers aboard / on the manifest | |
| Observers present | |
| `dive-domain-expert` review requested? | |

## Before you leave the dock

- [ ] Trip seeded and rehearsed ashore (V-04 dry run), including **at least one deliberately blocked
      diver** and one diver with a stale readiness state.
- [ ] **Printed manifest in hand** — the print/PDF fallback is part of the script, not a backup plan.
      Print it from the manifest page's **Print** button before you lose signal.
- [ ] Both phones signed in, both have opened the trip's live manifest at least once while on Wi-Fi.
- [ ] Screen recording armed on Phone A; someone nominated to take photographs of the screen in sun.
- [ ] The **stop rule** said out loud to the crew before boarding (H-05): a missing, expired, or
      corrupt device copy is **not** a boarding source — fall back to a fresh live load or the
      printed manifest. Never board from stale or absent data.
- [ ] One person ashore, signed in on a laptop, available by phone — step 8 needs them.
- [ ] Spray guard left **on** (its default). Do not touch "Disable spray guard on this device" until
      step 5 tells you to.

---

## The run

### 1 — Live manifest, full signal, at the dock

Open the trip's manifest on Phone A.

Expect: a **Boat mode** control in the trip header (**Auto** / **Land mode** / **Boat mode**); an
**Offline safety copy** panel; inside it a connectivity pill reading **Online**, a freshness pill
(**Fresh copy** / **Aging copy** / **Stale copy**), and a saved-summary line reading *Saved {date} ·
{n} waiting to send · {n} need a look*.

- [ ] As described. Otherwise: ______________________________________________
- Freshness pill shown: ____________  Saved line read: ____________________

### 2 — The device copy keeps itself current

There is no "save" button. The copy saves and refreshes itself on load, on reconnect, on tab focus,
and every five minutes; the one manual control is **Refresh now** (H-05, revised 2026-07-26).

- [ ] Leave the page open for six minutes without touching it; the freshness pill stays **Fresh
      copy** on its own. (Fresh ≤ 15 min since save; Aging ≤ 4 h; Stale beyond.)
- [ ] Tap **Refresh now** once with signal. A successful refresh says **nothing** — the message line
      clears and the *Saved {date}* line moves to the current time with the pill back on **Fresh
      copy**. That silence is the expected observation; a sentence appearing there means something
      went wrong, so write it down verbatim: ____________________________________
- Notes: ________________________________________________________________

### 3 — Glare and sunlight

Outdoors, in the worst light of the day. Phone at arm's length, as a captain holds it.

- [ ] Can you read a diver's name at arm's length without shading the screen? Y / N
- [ ] Can you tell a **blocked** row from a **boarded** row *by its words*, not by colour alone?
      (Rows carry a **Ready to board** / **Blocked** badge as well as the red/green fill.) Y / N
- [ ] Cycle the **Boat mode** control through **Auto / Land mode / Boat mode**. Which was usable in
      sun? __________ Did Auto pick it by itself? Y / N
- [ ] Screen brightness at max — still readable? Y / N. Photograph the screen in sun.
- Worst thing you couldn't read: _________________________________________

### 4 — Wet hands, spray, motion

- [ ] Wet both hands (salt water, not fresh) and tap 10 roll-call buttons. Taps that registered
      first time: ____ / 10.
- [ ] Repeat with the boat under way. First-time taps: ____ / 10.
- [ ] Any tap that hit the wrong diver's row? Y / N — which and why: ______________
- [ ] Scroll the diver list with a wet thumb. Usable? Y / N

### 5 — Spray-guard false-trigger rate (DOM-L3) — measure this properly

The spray guard blanks the screen when it thinks water is tapping it, and it takes a **two-second
hold** to unlock. It engages on either of two things (`src/components/WaterLocker.tsx`): **three or
more fingers touching at once**, or **two taps 5–150 ms apart and more than ~30 px apart**. A
two-thumb roll call produces exactly that second pattern, so the concern is real and the number is
what settles it. Keep the guard **on** for trials A–D.

Run each trial and count. A "false trigger" is a lock that engaged during ordinary deliberate use.

| Trial | What you do | Locks | Rate |
| --- | --- | --- | --- |
| A | Dry hands, **two thumbs**, 20 consecutive roll-call taps at your natural speed | ____ | ____ / 20 |
| B | Dry hands, **one thumb**, 20 taps at natural speed | ____ | ____ / 20 |
| C | **Wet hands + spray on the screen**, one thumb, 20 taps | ____ | ____ / 20 |
| D | **No fingers** — spray or splash the screen 10 times, hands away (this measures whether it works at all) | ____ | ____ / 10 |

Then:

- [ ] Time lost per false lock, wall clock, including reorientation: ______ s (the hold alone is 2 s).
- [ ] Did any tap leak through to the roll call underneath while locked? Y / N — **a Y here is a
      safety finding**, not a UX one.
- [ ] After unlocking, was the roll call exactly where you left it? Y / N
- [ ] Did anyone reach for **Disable spray guard on this device** unprompted? Y / N — after how many
      locks? ____
- [ ] Now *do* disable it, and repeat trial A. Locks: ____ / 20 (expect 0). Did anything else about
      roll call change? _______________
- [ ] Re-enable it before step 7.

**Judgement to record:** at what false-trigger rate would you turn this off on a real boat? ____ / 20.
Anything above zero in trial A is a defect worth writing up: the guard covers the roll call it
interrupts, and the crew loses the thread mid-count.

### 6 — Departure roll call, with a blocked diver

Readiness gates boarding **at departure only**.

- [ ] Board three ready divers. Each card settles in place (no full-page reload). Y / N
- [ ] Try to board the deliberately blocked diver. Expect a refusal naming that they're still
      blocked, with a link through to that diver on the guests page.
- [ ] Read the refusal to the captain. Did they understand what to do next without you
      explaining? Y / N — their words: _______________________________________
- [ ] The blocked diver's row lists its blockers in plain words. Were they the right words for the
      dock? _______________________________________________
- [ ] Progress bar and the *"still to call"* line track the count correctly. Y / N
- [ ] Undo one boarding (tap the boarded button again). Does it undo cleanly? Y / N

### 7 — Airplane mode, then roll call with the radio off

- [ ] Put Phone A in airplane mode. Reload the page.
- [ ] Expect **No signal · device copy** and *"Offline — showing the last saved copy."*; open
      **Open offline roll call** (`/offline-manifest`).
- [ ] Record **five** roll-call results offline (mix boarded and not boarded, one with a note).
      Expect *"Saved on this phone — it'll send when you're back in service."* and a **· waiting to
      send** suffix on those rows.
- [ ] Kill the browser entirely and reopen `/offline-manifest`. Are the five results still there?
      Y / N
- [ ] Does the offline view state honestly that readiness is from when it was saved (**Ready when
      saved** / **Blocked when saved**)? Y / N
- [ ] Try to board a **blocked** diver offline. Expect a refusal telling you to clear it on the live
      manifest. Y / N
- [ ] Switch to the **after dive 1** checkpoint offline. Does it work? Y / N
- Time spent offline before reconnecting: ______ min

### 8 — A deliberate conflict, then reconnection

This is the step most likely to surface something. Do not skip it.

- [ ] While Phone A is still in airplane mode, phone the person ashore and have them record a
      **different** result for one of the same divers on the live manifest.
- [ ] Take Phone A out of airplane mode. Do **not** reload — reconciliation should start on its own
      when the connection returns.
- [ ] Expect either *"Everything's sent."* or *"{n} changes need a look — open the live manifest to
      sort it out."*
- What appeared, verbatim: _______________________________________________
- [ ] Open the live manifest. Which result won, and does the history show both? ______________
- [ ] Could the captain tell, from the screen alone, that something had been rejected and what to
      do? Y / N
- [ ] Do the counts on the live manifest now match the printed manifest plus your pen marks? Y / N

### 9 — After-dive roll call, on the water — **this is the step that tests the crew half**

Do this one **still offline**, on `/offline-manifest`, before step 10. A checkpoint needs both
halves — every diver accounted for *and* every rostered crew member — and until 2026-08-14 the crew
half could not be recorded without signal at all, so an after-dive checkpoint could never be closed
at sea. It can now, and this step is the only thing that will tell us whether that is true on a
boat. There is **no typed crew count** anywhere any more: every crew member is called by name, the
same way a diver is.

- [ ] Run the **after dive 1** checkpoint as a physical head count. Boarding here does **not** wait
      on readiness — confirm a diver blocked at departure can still be counted aboard. Y / N
- [ ] A diver marked not boarded at departure should carry forward as *Not boarded · carried*.
      Y / N

**a. A rostered crew member still to call.** With every diver counted and nobody having tapped the
crew, expect the crew panel (**Crew aboard**) to read *"{n} crew members still to call. Every person
on the crew list needs a result of their own."*, to name each of them, and the checkpoint **not** to
read complete.

- [ ] As described. Otherwise: ______________________________________________
- [ ] Each crew member's row carries **Mark aboard** and **Mark not back aboard**, at the same size
      as a diver's buttons, and they work with the radio off. Y / N
- [ ] Nothing on the panel says the crew half belongs to the live manifest or can't be tapped here.
      If it *does* say that, this phone's saved copy predates the change — write down what it says
      verbatim and refresh the copy in signal before continuing: ____________________

**b. A crew member who did not come back.** Pick one crew member and tap **Mark not back aboard**
(agree it with them first — this is a drill). Expect the panel to turn **red**, to read *"1 crew
member is not back aboard. This checkpoint stays open."*, and the button to settle to a red **Not
back aboard** with **no** ☑️ on it.

- [ ] As described. Otherwise: ______________________________________________
- [ ] **Read as an emergency, not as a limitation of the phone?** Show it to someone who has not
      read this sheet and ask what it is telling them. Their words: ____________________
      (A "the app can't do that bit offline" reading here is a **safety finding**.)
- [ ] Tapping the red button again takes it back. Y / N
- [ ] Now count them back aboard. Does the red clear? Y / N

**c. A trip with no crew at all.** If the trip under test has crew, this needs a second seeded trip
with an empty crew list — do it ashore in the V-04 dry run if you cannot rig it here.

- [ ] Expect *"No crew are assigned to this trip, so there is nobody to call…"* and the checkpoint
      **open**, never complete. Y / N — if it read complete, that is a stop-the-line finding.
- [ ] Exercised on the water / ashore / not exercised (circle one).

**d. Reaching a complete roll call at sea.** Count every crew member aboard.

- [ ] Roll call complete: does the screen say so unmistakably (**Roll call complete 🎉**)? Y / N
- [ ] It happened **with the radio off** — no reconnect, no live manifest. Y / N
      (If you had to reconnect to close it, that is the finding this whole step exists for.)
- [ ] The crew results show **· waiting to send** until you reconnect. How many were queued: ____
- [ ] Ask the captain, cold: **"who counts as crew here, and who counted them?"** Does the screen's
      list match their answer — the same people, nobody extra, nobody missing? Notes:
      _______________________________________________________________________
      (A deckhand or a spouse nobody rostered is the classic gap: the app can only ever call the
      people on the trip's crew list, so an unrostered hand is invisible to the count.)
- [ ] Second dive: repeat on **after dive 2** if the trip has one. Notes: ______________

### 10 — The stale / expired / missing copy

A copy expires at the earlier of 14 days after it was saved or 7 days after the trip ends, so you
cannot force a genuine expiry in one day. Test what you *can*, and record honestly that the rest was
not exercised in the field.

- [ ] **Phone B has never opened this trip.** Airplane mode, then open `/offline-manifest`. Expect
      *"Nothing saved on this device yet"* — and confirm nobody could mistake it for an empty boat.
      Y / N
- [ ] Leave Phone A's copy untouched with the radio off for over 15 minutes. Freshness moves to
      **Aging copy** and says so on screen. Y / N
- [ ] Ask the captain, cold: "what do you do if this says the copy is old, or shows nothing?"
      Their answer, verbatim: _______________________________________________
      (The correct answer is the H-05 stop rule: fresh live load, or the printed manifest. Never
      board from it.)
- [ ] Expiry and undecryptable-copy recovery **not** exercised in the field. Confirmed: Y / N

### 11 — The printed fallback

- [ ] Could you have run the whole trip from the printed manifest alone? Y / N
- [ ] What was missing from the print that you needed? ____________________
- [ ] Did the print carry emergency contacts, rental fit, and the blocked/ready state? Y / N

### 12 — The phone itself

- [ ] Battery at end: ____ % (started ____ %). Elapsed: ____ h.
- [ ] Screen sleep/lock interrupted roll call? Y / N — how often: ____
- [ ] Anything that made you put the phone down and use paper: ____________________

---

## Bring these numbers back

| Measurement | Value |
| --- | --- |
| Spray-guard false triggers, two-thumb dry (trial A) | ____ / 20 |
| Spray-guard false triggers, wet + spray (trial C) | ____ / 20 |
| Spray-guard true triggers, water only (trial D) | ____ / 10 |
| Seconds lost per false lock | ____ |
| Wet-hand taps registering first time | ____ / 10 dry-hand baseline ____ / 10 |
| Roll-call results recorded offline | ____ divers + ____ crew |
| After-dive checkpoints **closed** with the radio off (step 9d) | ____ of ____ attempted |
| Offline results that reconciled cleanly | ____ |
| Offline results rejected on reconnect | ____ |
| Minutes offline before reconnect | ____ |
| Battery drawn over the trip | ____ % over ____ h |
| Times the crew reached for paper instead | ____ |
| Safety-severity defects found | ____ |

## Sign-off

- Findings written up, with the screen recording and the sun photographs attached: ____________
- `dive-domain-expert` review requested / completed by: ____________ on ____________
- **Decision:** production departures may rely on the offline copy — **yes / no / yes with these
  conditions**: _______________________________________________________
- If **no**: the pre-decided response is to pilot with the live manifest plus the printed backup, and
  **no offline claim on any surface**
  ([rollout.md](../rollout.md#risks-and-pre-decided-responses)).

## Where this goes afterwards

- The evidence, verbatim, into the V-02 row of the
  [verification queue](../human-decisions.md#human-verification-queue) — date, device, network,
  scenarios, freshness shown, reconciliation results, findings, reviewer sign-off, and whether
  production departures may proceed. Status lives there and nowhere else.
- Safety-severity defects become stop-the-line fixes with regression tests
  ([dive-operations.md](../stakeholders/dive-operations.md)).
- Everything else becomes tickets in [features/story-backlog.md](../features/story-backlog.md).
- A **passing** V-02 is what the claims policy waits on before offline roll call may be spoken about
  as proven ([marketing.md](../marketing.md#claims-policy-hard-rules),
  [rollout.md](../rollout.md#03-field-validation-v-01-v-02-v-04-rehearsal)).
