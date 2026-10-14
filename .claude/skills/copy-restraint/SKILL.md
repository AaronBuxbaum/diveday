---
name: copy-restraint
description: Decide whether a user-facing sentence deserves to exist, and strip explanatory, redundant, or apologetic copy. Use when writing, editing, or reviewing any label, hint, empty state, error, or subtitle, or sweeping a surface for words that earn nothing.
---

# Only two kinds of sentence earn their place

DiveDay's surfaces are read by a person with a wetsuit half on and a diver in front of them.
Every sentence they must read is a tax. Apply this filter to **every** string — the one you are
writing, and every one already on the surface you happened to open:

> **A sentence stays only if it (a) tells the reader something they could not get from the
> surface itself and would get wrong without it, or (b) is a moment of delight worth the room.**
>
> Everything else goes. Not shortened — **deleted**.

The default answer is delete. A string earns its place; it is not entitled to it.

## The five deletions

Run these in order on any surface you touch.

### 1. It restates its own context

A heading, a label, a control, or the shape of the thing already said it. The sentence is a
caption on a photograph of itself.

```diff
  "crew": {
    "heading": "Crew",
-   "description": "Who's running this trip.",
```

```diff
    "requiredSpecialtiesLegend": "Required specialties",
-   "requiredSpecialtiesDescription": "A diver is blocked until a verified certification for each proves the specialty.",
```

Test: cover the sentence. Does a competent user of this screen now get something wrong? If not,
it was decoration.

The same failure shows up as a *banner* instead of a static caption: an action lands, and the
surface it changed already says what happened — a new pending card row with its own "Pending"
badge, a button whose ring and mark just switched to "sent" — but a confirmation box renders
anyway, one beat later, saying the identical thing in a sentence. Cover the fresh row/badge/ring
instead of the sentence for this variant of the test: if the reader can still see the outcome
without the banner, delete the banner, not just shorten it. `divers.notices.captured`
("Certification captured as pending. Look the number up...") was this exactly — the new card row
appears directly beneath it on the same render, already reading "Pending." See
[forms-and-controls.md](../../../docs/design/forms-and-controls.md)'s "Ephemeral acknowledgement"
section for what to reach for instead (the control's own face, then `Toast`, then `FormStatus` —
in that order) when the tap genuinely needs *something* said.

### 2. It explains the mechanism

The reader gets the outcome; the sentence describes the rule that produced it. This is the most
common failure in this repo, because the person writing the string has the rule fresh in mind.

```diff
- "siteAlsoRequires": "<strong>{site}</strong> also requires {list}. Readiness always enforces the stricter of the site and this trip."
+ "siteAlsoRequires": "<strong>{site}</strong> also requires {list}."
```

The diver is blocked either way. "The stricter of the two applies" is a fact about our
implementation, not about this shop's morning. This is [principle 4](../../../docs/design/principles.md)'s
"never surface the implementation" widened one notch: not only *encryption* and *snapshots*, but
**any** sentence whose subject is how the feature decides rather than what the reader now has.

### 3. It offers a path the interface already offers

If there is a button for it, do not also write a sentence telling the reader the button exists,
or hand them a second, manual way to do the same thing.

```diff
- "sharePrivateLinkOne": "{reason} — share this private link:"
+ (the reason alone; "Copy link" is a button two inches away)
```

### 4. It apologizes

Refusals state the state and, when there is one, the next move. They do not perform regret,
soften with "unfortunately", or explain that we tried.

| Delete | Keep |
| --- | --- |
| "Sorry, we couldn't send that right now — please try again later." | "Not sent." |
| "Unfortunately no departures match your filters." | "No departures that day." |
| "We were unable to reach the email provider." | "Email didn't go out." |

A refusal a person can act on keeps exactly the clause that says what to do. A refusal nobody can
act on is one line.

### 5. It teaches something the reader will learn in one tap

Onboarding prose attached permanently to a control every staffer uses forty times a day. The
first-run explanation is not worth the four-hundredth reading.

## What survives

- **A state that is invisible without words.** "Saved 4 hours ago — refresh before you rely on
  it". A stale device copy looks identical to a fresh one; the sentence is the only carrier.
- **A consequence the reader cannot see coming.** Removing a booking inside the refund window
  fires a real refund. Say it, once, at the moment of the act.
- **A next move on a dead end.** An empty state that teaches ("No trips yet — schedule your first
  charter") is delight and instruction in one line.
- **A real moment of joy.** Rationed like `--accent`. A recap line after a good dive day earns
  its room; a subtitle under a section heading does not.
- **Legal and medical wording.** Waiver bodies, medical questionnaires, `/privacy`. Precision is
  the product there; this skill does not touch it.

A sentence that survives the filter still has to *sound* right. Restraint decides whether it exists;
"What gives us away" in `docs/design/brand.md` decides its shape, and the two go together: the
em-dash pivot, the "not X, Y" contrast and the *actually* are how a sentence that should have been
deleted disguises itself as one that earned its place.

## Reference

- [deleting.md](deleting.md) — removing a string from both bundles and its tests, and sweeping a surface.
- [accessibility.md](accessibility.md) — when a more accessible option and a more delightful one genuinely conflict.
