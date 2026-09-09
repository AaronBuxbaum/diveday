# 20260907-in-your-hands — Where the device already knows a thing, DiveDay uses it, says where it came from, and leaves the last tap to a person

- **Status:** Accepted — decided 2026-09-07 (Aaron Buxbaum, in session; H-70: passkeys and the
  step-up yes, the release signed on the shop's device yes, the card reader declined — "we should
  have no photo upload", which also corrected this record's third finding, below). Slices 19a, 19b,
  19d and 19e in the roadmap; 19c dropped
- **Date:** 2026-09-07
- **Design:** [the canvas](../../design/canvases/20260907-in-your-hands/README.md) — five artboards
  on two pages: the cover; then the door, the counter, the card, and the two device moves on one
  board
- **Scope:** the staff door (`/sign-in`, `EntryShell`, the security settings under
  `/shop/[shopSlug]/settings/security`) and the step-up challenge; the counter's blocked row and the
  roster row where the fix is the release; the certification form on the diver record
  (`CardSightingForm`, `CertificationsGroup`); the root type size on every surface; the shop home on
  a phone

## Context

The owner's brief on 2026-09-07: another look at the design; clever decisions that are delightful
and elegant; think Apple, in animations and features.

[20260907-nothing-from-nowhere](20260907-nothing-from-nowhere.md) answered the half about animation
the same day: one physics, six moves, three calls held as H-69. This record is the second look, at
the other half. Read against what Apple's features are — rarely a new capability, nearly always the
device using a fact it already holds and then getting out of the way — the running app has five gaps
of one shape:

1. **The door asks for a password on a phone that knows its owner's face.** Sign-in is email,
   password and, where enrolled, a six-digit code from another app; a crew member on a wet dock types
   all three. No passkey exists anywhere in the tree.
2. **A diver at the counter with no waiver is sent a link, or handed paper.** The counter row's fix
   is *Send waiver*, with *Mark signed on paper* beside it (`CounterQueueRow`, `PaperWaiverControl`).
   The device the staffer is looking at could be turned around.
3. **The card is photographed and then typed.** *Capture for review* already lands a photo of the
   certification card on the record; the agency, level, number and date are then typed off the same
   card into the fields under it. **Corrected on acceptance: this finding was wrong.** *Capture for
   review* is the typed add-certification form's own submit, and a card has carried no image since
   [20260811-retire-the-digital-card](20260811-retire-the-digital-card.md) dropped `card_image_url`
   — a photograph of the plastic never established anything. The canvas read the label as a camera
   and drew a move on it; decision 4 records the outcome.
4. **The type ignores the phone.** The ladder is rem, so a desktop browser's text setting reaches
   it; iOS's own text setting, the one that reaches every other app, reaches nothing here.
5. **The app can be installed and never says so.** `manifest.ts` declares `standalone` and the
   service worker keeps the next two days' manifests on the device; no surface tells a crew member on
   a first phone sign-in that the roll call could open from the home screen.

Two earlier rules already point the way and are extended rather than changed:
[20260906-before-you-ask](20260906-before-you-ask.md) (fill what is known, show its source, leave
the last tap to a person, render nothing otherwise, never reach a safety fact) and budget rule 5 of
[20260904-reef-all-the-way-down](20260904-reef-all-the-way-down.md) (a mutable fact says where it
came from). This record applies both to facts a *device* supplies.

## Decision

Proposed, in six parts. Parts 2, 3 and 4 carry the three owner calls recorded as H-70.

### 1. The rule, and what renders when it fails

Every move below passes four tests, and each names what renders when it does not:

| Test | What | Otherwise |
| --- | --- | --- |
| Known | The move uses a fact the device or the moment already holds: a face the phone has checked, a card in the viewfinder, a text size already chosen, a diver already at the desk. No move asks a person for something new so DiveDay can be clever with it | nothing changes |
| Source | What was supplied says where it came from: a filled field says *read from the photo*, a signature says *signed at the counter*, a passkey is listed under the device it lives on | no fill |
| Last tap | The reading fills a field and never a status; the hand-over opens the page and never signs it; the passkey opens a session and never a payment. Every consequence the app already guards with a tap keeps that tap | nothing |
| Safety | Verification stays a staffer's tap on a card they can see ([20260824-shop-issued-certification-is-verified](20260824-shop-issued-certification-is-verified.md)). The release's words, steps and consent are H-01's and H-03's; the device changes and the text does not. Sign-out keeps its two-tap confirm. The manifest, the roll call and the payment step gain nothing. A card photo never leaves the region the record lives in | the page as it ships |

### 2. The door knows your face (H-70 a)

Staff may sign in with a **passkey**. On a device that holds one for the account, `/sign-in` renders
one primary, *Sign in with a passkey*, and a link, *Use your password instead*; the email field is
absent because the key names the account. A device holding none renders the form as it ships, whose
email field carries `autocomplete="username webauthn"` so a synced passkey may still be offered, and
nothing else changes. A passkey is created in Settings → Security by a signed-in staffer on the
device, with the device's own check (a face, a finger, the device PIN), named for the device, listed
with its last use, and removed from the same list; the password door stays the way back in when a
device is lost, followed by removing that device's key and, as today, revoking every session. A
passkey is a staff key only: no diver surface has an account and none gains a door.

The door keeps one primary (`EntryShell.test.tsx` already holds it). Live revalidation is untouched:
the key opens the same database-backed session every staff page re-reads
([20260824-staff-session-live-revalidation](20260824-staff-session-live-revalidation.md)). Sign-out
stays two taps; a passkey shortens the way in and never the way out, on a shared counter device least
of all. The mechanism is Better Auth's passkey plugin, the one auth library the app runs on: a new
runtime dependency, and the reason this is an ADR at all.

**H-70 a:** whether staff may sign in with a passkey at all, and whether a passkey made with the
device's own check stands as the fresh factor the step-up asks for before money, exports and
backup-destination changes ([20260826-account-security-step-up](20260826-account-security-step-up.md)),
bound to the session and purpose for fifteen minutes as the authenticator code is today.
**Recommended:** yes to both. Declined on the second, the code is asked as today; declined on the
first, nothing on the door or in Settings changes. **Decided 2026-09-07: yes to both.**

### 3. Hand it over (H-70 b)

A blocked row whose fix is the release — on the counter and on the departure's roster, the two
surfaces a diver stands in front of — gains **Sign here** as the row's primary, with *Send waiver*
and *Mark signed on paper* demoted to links beside it. The tap mints the waiver token for the booking
without sending it, sets a **lock on the staff session**, and opens the diver's own waiver page on
the shop's device: the same three steps, the same typed name and consent (H-03's standard), DiveDay's
own tokens (the shop's brand may never reach the release), with one line at the top saying who handed
it over and when, and one sentence at the bottom saying whose device this is and who sees what
(budget rule 6's grammar, reworded to whatever counsel decides). While the lock holds, every `/shop`
request renders the locked door — Move 1's, or the password — so a swipe back, a reload or a typed
URL from the diver's side lands there; it is the step-up's session-bound grant run the other way,
cleared only by a fresh sign-in. When the diver signs, the page asks for the desk back; the counter
reopens with the row settled and one line under the name, for that morning, saying *signed at the
counter*. The signature row records the counter, the device, who handed it over and when, printed
wherever the signature is shown to staff and never edited. The desk sees that the diver signed, and
never the answers, which post to the diver's record as from any link. A diver who stops halfway keeps
a draft as any waiver draft is kept, and the desk unlocks with the row still blocked. Never offered on
the manifest or the roll call, for a minor's release (the guardian flow stands), or while the desk
holds an unsaved form.

**H-70 b:** whether a diver may sign the release on the shop's own device, with that fact recorded
on the signature. The words are H-01's and whether a typed name suffices is H-03's; this asks a
narrower thing, the device. **Recommended:** yes, provenance recorded — it is the paper flow with the
signature kept, and the paper flow already ships. Declined, *Sign here* renders nothing, the row keeps
its two doors, and the session lock is not built. **Decided 2026-09-07: yes, provenance recorded.**

### 4. Point the camera at the card (H-70 c) — declined, and dropped in full

**Decided 2026-09-07: declined** — "we should have no photo upload." The move as proposed below is
not built, and neither is its fallback: no photo capture is added to the certification form, which
ships as it is. The proposal rested on the wrong premise named in the Context (no photo of a card
exists or is stored, and [20260811-retire-the-digital-card](20260811-retire-the-digital-card.md)
already decided that none should), so the owner's answer restates a standing decision rather than
reversing this record's fallback. Slice 19c is dropped; the canvas's Card board stands as the dated
argument. The text as proposed follows, unedited, as the record of what was weighed.

The certification form's photo capture moves to the top of the form and takes the camera's name,
*Photograph the card*, since on a phone or a tablet that input opens the camera. The photo lands on
the record as the evidence it already was; the **reading** rides on the upload and fills the four
fields — agency matched to the app's own list or left empty, level matched to the app's own rungs or
left at the claim, the number, the certification date (the one field added to the form) — each
carrying a *Read* mark that leaves the moment a staffer edits it, under one sentence saying the
values were read from the photo and asking for the check. The primary is the one that ships, *Mark
certified*, which still writes `verified` alone and still refuses without a number. A photo the
reader cannot make out fills nothing and says nothing; a misread value is a value the staffer types
over. The reading never touches a status, the diver's name or date of birth, or the nitrox table.

**H-70 c:** whether a card photo may be sent to a text reader. No browser reads text on every phone
the counter runs, so the reading is a server call; the recommendation is Amazon Textract in the
region the shop's records already live in, on the same AWS account, with the account's AI-services
opt-out policy set (a manual step for §17's registry), nothing retained, and one disclosure sentence
on `/privacy` naming the reader and what it is given. **Recommended:** yes. Declined, the photo lands
as evidence as today, the four fields stay typed, and the camera door still moves to the top of the
form.

### 5. The type follows the phone

On a device that knows `-apple-system-body`, the root font size becomes the app's 16px or the
device's body size scaled to it (17 → 16), **whichever is larger**: a setting above the default
scales every rem measure in the ladder — names, figures, tap targets — together, and a setting below
it changes nothing, because the ladder's floor is the dock test's and the floor stands. A one-line
probe in the pre-hydration script that already sets `lang` and `dir` measures the keyword and writes
the root before first paint, so nothing jumps; a platform that does not know the keyword writes
nothing. Every surface takes it, boat mode included. The visual spec gains one capture of the
manifest at the largest root, so a fixed-px width that clips a name is a diff rather than a report
from the rail.

### 6. On the home screen

A staffer whose role reaches the manifest, on a phone or tablet, in a browser tab, on an account
that has never dismissed it on this device, sees one line under the day's spine: the roll call can
open from the home screen, without a browser bar and without signal, with the one act that does it —
a button that calls the platform's install prompt where one exists, the platform's own menu item
(with the share glyph drawn inline) where none does. Dismissed once, it is gone (a device
fact, kept where boat mode keeps its own); installed (`display-mode: standalone`), on a desktop, in
an embed, or above the first-thing panel, it never renders. No coral, no drawing, no motion: a fact
about the device at the ledger row's own weight, so the home's budget is untouched.

## Alternatives considered

- **A native app** for Face ID, the camera and the home screen. Rejected: a passkey is a browser
  API, a hand-over is a locked session, a text size is a CSS keyword, an install is a manifest the
  app already ships; none needs a store listing, and a native app is a second product to keep
  current.
- **Passkeys as the only door.** Rejected: a lost phone needs a way in from another device, and the
  password door is it. Also declined for a diver: no diver surface has an account.
- **A shared counter PIN instead of a session lock** for the hand-over. Rejected: a PIN is a second
  credential that lives on a sticky note; the lock reuses the door the account already has and the
  step-up's session-binding.
- **A kiosk mode where the diver checks themselves in.** Rejected here, and **reversed two days
  later**: the owner asked for it on 2026-09-09 (`docs/product/assessments/improvement-ideas-20260907.md`,
  N-24) and it shipped as the self check-in tablet. The reason this bullet gave — "the counter works
  by name and a person taps" — turned out to be the real risk rather than a reason not to build,
  and it is answered in the shipped design rather than waved away: a tablet tap is recorded as the
  diver's own act, stamped with the tablet (`booking_arrival_events.display_token_id`), and read
  back as *"Says they're here"* wherever a staffer's tap reads *"Checked in"*. It can never record a
  boarding, and it never ends the counter's chasing on its own. See the **Self check-in** glossary
  entry for what it does and does not move.
- **Reading the card in the browser** (the Shape Detection API). Rejected: Safari does not implement
  it, and the counter is an iPad.
- **A cloud vision service outside AWS.** Rejected: the photo is already on DiveDay's storage in one
  AWS region; sending it anywhere else adds a subprocessor for a saving of nothing.
- **Reading the diver's name and date of birth off the card too.** Rejected: the record already has
  both, and a reading that rewrites identity is a merge problem wearing a convenience.
- **A count-up, a spring, a sound, a page transition.** Not this record's; the sibling ADR decided
  each.

## Consequences

- **A new runtime dependency**, Better Auth's passkey plugin, with its table (public key, device
  name, counter, created and last-used) added under the schema-change skill; the private key never
  leaves the device. The origin binding is asserted by a test against the configured origin. The
  security reviewer reads slice 19a before merge, as any change to the door.
- **A session lock** is a column on the staff session (`handed_over_at`, cleared on sign-in) read by
  `requireShopSurface`; a test pins that every `/shop` read refuses while it is set, the same way
  `session.test.ts` pins that every refusal throws.
- **The signature row** gains its counter provenance (where, on whose device, handed over by whom,
  when), never edited; the `dive-domain-expert` and the security reviewer read slice 19b; the two
  sentences drafted ahead of counsel are reworded, not redrawn, when H-01–H-03 answer.
- **The reader** is not built (decision 4, declined). No Textract, no manual step, no `/privacy`
  sentence, no change to `CardSightingForm`; the certification form keeps carrying no photograph,
  which `anonymize.ts` already states beside its erasure of the card rows.
- **The root probe** is one line in the existing pre-hydration script and one visual capture;
  `check:tokens` and the loading-skeleton guard are unchanged, and any px measure that stops scaling
  is a visual diff to fix.
- **The home-screen line** is one conditional row under `DaySpine` with a device-kept dismissal; a
  test pins that it renders nothing when installed or on a desktop.
- Each slice ends in the standing obligation from
  [design-artifacts.md](../../design/design-artifacts.md): the component names this ADR and a test
  pins the rule. The escape hatch is the same as the last four ADRs': every move renders the page as
  it ships when it is not true, so reversing any one is deleting a door, a mark or a line, not
  redrawing a surface.
