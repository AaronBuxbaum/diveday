# UX personas — the standing eval frame

Fifteen personas plus two cross-cutting lenses, distilled from the 2026-07-30 frontend review
(archived at [archive/ux-personas-20260730-findings.md](archive/ux-personas-20260730-findings.md))
into evergreen guidance. Use this doc to evaluate *new* UX work — "how does this land for Nadia?"
— not to look up what was already fixed. Open follow-on work from the original review lives in
[story-backlog.md](story-backlog.md), each ticket tagged with the persona it serves.

**How to use this doc.** Before shipping a diver- or staff-facing change, skim the personas whose
surfaces it touches and check the change against their "what to hold the line on" list. When you
find a new gap for a persona, add it to `story-backlog.md` rather than editing the narrative here
— this document should stay a stable frame, not a running bug list.

## Contents

| # | Persona | Surfaces |
| --- | --- | --- |
| 1 | Nadia — nervous first-time diver | public schedule, course pages, booking |
| 2 | Tomas — certified traveler on a phone | schedule, trip page, booking, sign-in |
| 3 | Priya — parent booking the family | booking party form, course age rules |
| 4 | Marco — repeat local diver | schedule, booking speed |
| 5 | Ingrid — non-native English speaker | i18n coverage everywhere |
| 6 | Rob — diver the night before (waiver + medical) | /waivers/[token], /ready/[token] |
| 7 | Amara — diver after the trip | /recap/[token], reviews, tips, photos |
| 8 | Dana — solo shop owner at 6am | Today queue, departure board |
| 9 | Chloe — front desk in a morning rush | check-in, walk-in booking, blockers |
| 10 | Sal — captain with wet hands | manifest, roll call, offline view |
| 11 | Kai — day-one seasonal hire | navigation, discoverability, refusals |
| 12 | Maren — weekly-admin manager | reviews moderation, promos, settings, reports |
| 13 | Victor — skeptical owner evaluating a switch | marketing pages, pricing, switching guides, onboard |
| 14 | June — low-vision / screen-reader / assistive-tech user | accessibility everywhere |
| 15 | Leo — anyone on a slow island connection | performance, offline/PWA, error coverage, email |

Two cross-persona lenses follow the personas:

| § | Lens | Question |
| --- | --- | --- |
| 16 | Over-explained copy | Are we too verbose about mechanics customers don't care about? |
| 17 | Redundancy, coupling, findability | Should functionality live together or apart — and can you find it when you need it? |

---

## 1. Nadia — the nervous first-timer

Knows nothing about certifications. Googled "learn to dive," landed on a course page or the shop
schedule. Every acronym is a wall; every unexplained gate is a reason to close the tab.

**Hold the line on:** course and certification-path content stays reachable without a staff
login; a booking refusal always states a true, specific reason rather than a generic dead-end
that could be read as a lie; jargon ("two-tank trip," "BCD," "nitrox") gets a plain-language hint
at first use, coordinated with `dive-domain-expert` so the simplification stays medically/legally
correct; any lead-capture form actually collects a way to reach her, not just a `mailto:` that
depends on her phone having a configured mail client.

## 2. Tomas — the certified traveler booking from a phone abroad

Found the shop on WhatsApp from a friend's link. Books from a hotel bed on flaky wifi, in a
different locale and currency, comparing two shops in another tab.

**Hold the line on:** anonymous public pages carry the shop's identity (name, contact, footer) —
never a bare, unbranded shell; the calendar and the trip list always show the same data for the
same month; one price truth per page (the hero price and the charged price must agree, including
course/e-learning fees); a full trip degrades to a wait-list CTA, never a vanished one; a
cancelled or missing trip lands on a branded page, never a bare framework 404.

## 3. Priya — the parent booking a family

Books herself plus two kids, 9 and 11, for a Discover Scuba session, on a phone.

**Hold the line on:** party-booking forms never force an invented email address for every family
member; a party-size cap always offers a "bigger group? contact us" escape; a course's minimum
age is visible wherever the booking happens, not only buried on the course page. **Open:**
`course_min_age` is still not a hard gate for public bookings — a self-declared attestation
checkbox is the current safe mechanism, and any move toward hard enforcement is a policy question
(H-08), not just an engineering one — see `story-backlog.md`.

## 4. Marco — the repeat local who wants to book in ten seconds

Dives with this shop monthly. Knows exactly which trip he wants. Every field is friction.

**Hold the line on:** a returning diver on the same device gets prefilled, not re-interrogated;
the schedule stays filterable ("has space," trip type) rather than a flat chronological wall; dead
or half-wired features (a prop nothing ever passes) get deleted, not left as false promises.

## 5. Ingrid — the non-native English speaker

German diver, browser in de-DE, gets es-ES or en-US. Reads carefully; idioms and half-translated
pages erode trust fast — especially around money, medicine, and legal text.

**Hold the line on:** `src/lib` and `src/db` return codes, not English sentences (ADR
20260731-domain-layer-copy-leaks) — copy lives in `diver.json`/`staff.json`; every date, time, and
money figure formats for the negotiated request locale, never a literal `"en-US"`; sentences are
composed as single ICU messages, not assembled from JSX fragments that break word order in
translation; `pnpm check:locale` and `pnpm check:copy` stay clean. **Open:** money is still
USD-hardcoded end-to-end (currency isn't a `shops` column yet), Stripe line-item text is still
composed in the domain layer, and every outbound email still uses the shop's locale rather than
the recipient's — see `story-backlog.md`.

## 6. Rob — the diver the night before (waiver, medical, readiness)

Opens the waiver link from email at 11pm. Mild asthma, slightly anxious about the medical form.
Next checks the "ready" page to see what's left.

**Hold the line on:** medical questions never arrive pre-answered — every answer must be a
conscious choice, reviewed by `dive-domain-expert` per AGENTS.md's safety-critical rule; a "yes"
answer is always paired with the reassurance that it doesn't automatically cancel the trip, and
post-signature copy never implies the shop (rather than a physician) can grant medical clearance;
every dead-token or expired-link card still shows the shop's name and a way to contact them; the
trip being signed for is always named on the waiver itself.

## 7. Amara — the diver after the trip

Gets the recap link that evening. Would leave a review if it's effortless; might tip; wants her
photos somewhere.

**Hold the line on:** the memory (map, sites, crew shoutout) renders before the ask (rating, tip,
review) — earn the 5 before asking for it; only one review ask is ever shown at a time; comment
moderation is disclosed before submitting, not discovered after; a no-show or cancelled booking
gets an honest, specific message, never a generic "try again."

## 8. Dana — the solo owner at 6am

Runs the whole shop alone. Opens Today with coffee in hand, 90 minutes before the boat leaves.

**Hold the line on:** the Today queue's urgency bands stay meaningfully separated (today's boat
must outrank tomorrow's); every row's copy comes from a message bundle and every timestamp from
the negotiated locale, never `"en-US"`; touch-first controls are the primary affordance on
mobile-heavy surfaces (drag-and-drop is an enhancement, never the only path); a failed action
always says so in words — no silent rollback.

## 9. Chloe — front desk during the morning rush

A line of six customers; two walk-ins; one diver whose waiver didn't arrive.

**Hold the line on:** adding a walk-in stays a fast, few-tap flow, not a five-interaction detour
through three page loads; a blocked diver on Check-in always has something to tap, not just a
badge; blocker lists never silently truncate.

## 10. Sal — the captain with wet hands

Runs roll call on a phone at the dock and off the boat, sometimes with no signal.

**Hold the line on:** the offline manifest gets the same boat-scale affordances as the live one
(haptics, spray rejection, boat-size targets) — it's the surface for the actual wet-hands
scenario, so it can never lag the polished live view; the fail-closed boarding rules
(`canRecordOfflineStatus`) stay untouched by any UI polish — readiness only gates boarding at the
departure checkpoint, an expired saved copy refuses new writes, and reconciliation on sync is the
final authority, never the offline UI's own optimism. Changes here are safety-critical: boring
code, failure-path tests, `dive-domain-expert` review, every time.

## 11. Kai — the day-one seasonal hire

First shift, handed a login, never seen DiveDay.

**Hold the line on:** every authorization refusal names the actual rule and the actual roles
allowed — never a wrong-page message, never a silent teleport; destructive or session-ending
actions (sign-out) confirm before acting; the fastest way to learn the app (command palette,
keyboard shortcuts) stays discoverable on mobile too, not desktop-keyboard-only knowledge.

## 12. Maren — the weekly-admin manager

Does promos, review moderation, settings, and reports on Monday afternoons.

**Hold the line on:** destructive or rating-affecting actions (hiding a published review) get the
same confirm treatment as other consequential actions — the confirm hierarchy must match actual
consequence, not habit; a form's save notice renders where the user is looking, not off-screen at
the top of a long page; datetime inputs that mix browser-local and shop-time formats say so
explicitly.

## 13. Victor — the skeptical owner evaluating a switch

On a competitor today; burned by lock-in before; evaluates on a laptop at night, off-season.

**Hold the line on:** the competitor/switching-guide list is generated from
`src/lib/migration-guides.ts`, never hand-copied, so a new guide can't be silently omitted; claims
made in the pricing FAQ and the switching guides never contradict each other or the actual import
behavior in `src/lib/import.ts`; "trial" language states plainly what it means today, never
implying a mechanism that doesn't exist; a new real shop's first Today view is a guided checklist,
never an empty work queue.

## 14. June — assistive-tech and low-vision users

Screen-reader user booking a trip; low-vision older diver reading in sunlight; colorblind staff
member scanning statuses.

**Hold the line on:** every page keeps a skip link; any portal/overlay component (dialogs, command
palette) gets real dialog semantics — `role="dialog"`, focus trap, focus restore, an `aria-live`
announcement for what changed; status communicates by more than hue (an icon or `sr-only` prefix,
not just color); required fields carry a visible marker; `Field`'s hint text stays wired through
`aria-describedby`, never folded into the accessible name; decorative avatar-color hashing never
doubles as a semantic status color (a red avatar must not read as "flagged").

## 15. Leo — anyone on a slow island connection

Diver on hotel 3G; divemaster on marina wifi; a shop where "the internet is down" is weather.

**Hold the line on:** every route gets a `loading.tsx`/Suspense boundary and a segment-level
`error.tsx` — a cold navigation is never a blank screen, and a render throw never replaces the
whole layout with the crash screen; content images are lazy-loaded with reserved dimensions, never
an unlazied, dimensionless `<img>` on the page's biggest asset; analytics SDKs never block the
booking form on a slow connection; outbound email is a real HTML document (doctype, viewport meta,
brand color, max-width), never a bare unstyled fragment.

---

## 16. Lens: over-explained, over-technical copy

**The standing rule:** name the outcome, don't re-derive the guarantee for the reader. Copy reads
best where it states a result ("It's on the board." / "Verified and on file.") and worst wherever
engineering solved something hard (import fidelity, offline reconciliation, waiver integrity) and
then explains the mechanism instead of asserting the result. Internal vocabulary (*checkpoint*,
*workspace*, *line-busting*, *demand signal*, *authoritative roster*, *soft delete*,
*reconciliation*, *coupon*) does not belong in diver- or staff-facing copy — rename to the plain
term. A caveat is worth keeping only if it answers a real fear a reader actually has (Stripe
custody, calendar read-only-ness); anything restated more than once across surfaces is noise, not
reassurance. Watch for reassurances that raise the fear they're meant to answer ("nothing here is
private to anyone but you").

## 17. Lens: redundancy, coupling, and contextual findability

**The standing questions for any new surface:** Does the same capability already exist elsewhere,
and if so is the duplication deliberate and documented, or drift? Do two write paths touch the
same data with different semantics (a classic silent-clobber setup)? When a user is in situation
X, can they reach the tool for X without a nav reset — or does the page hand them a dead end
(plain text where a link belongs)? Route/data-model splits that read as "N products crammed onto
one page" are a real cost even when each piece works — call it out rather than adding a Nth
feature to an already-overloaded route.

---

*This document supersedes the persona narratives in the archived 2026-07-30 review
([archive/ux-personas-20260730-findings.md](archive/ux-personas-20260730-findings.md)), rewritten
as standing guidance rather than a dated bug list. Update it only when a persona's actual needs or
context change — new findings against these personas belong in `story-backlog.md`, not here.*
