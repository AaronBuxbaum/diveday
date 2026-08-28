# People, not lists — implementation spec

Companion to [the ADR](../../../architecture/decisions/20260827-people-not-lists.md), per
[design-artifacts.md](../../design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way):
below the ADR, above the artboards, expiring per slice. Interface names are proposals; behavior a
listed test pins is not. Standing repo obligations apply unstated.

**Contracts no slice may move**: `verifyTripAdmissionGate` and every authz gate; the erasure path's
owner-only / removed-first / typed-name guard (ADR 20260802); merge candidate detection;
`standingWaiverExposure` and H-54's materiality recording (`waiver_materiality_decisions`); the
review-suppression floor (`MAX_SUPPRESSED_SHARE_FOR_RATING`, `reviewsToRepublishForRating`);
request rows gated on `reports` (strangers' contact details); waiver pages gated on `waivers`.
`security-reviewer` review before merging 8b (personal data) and 8e (legal evidence).

**Build order**: every slice here assumes Clearwater 6a's ledger primitives (`GroupLabel`,
`LedgerRow` — `src/components/ui/ledger.tsx` per the clearwater-surface-language SPEC) have
landed. A session reaching an 8-series slice first lands those primitives from the Clearwater
SPEC as part of the slice, in the same stack layer beneath it. The full build-order graph lives
in [roadmap.md](../../../product/features/roadmap.md)'s "Build order" table.

---

## The journeys

- **S1 — Fix Grace before the boat** (Dana, from the home's station row). "Verify it" deep-links to
  the record; the status ledger is the first thing under the masthead with the same row and the
  same fix; verifying settles it; the ledger now renders nothing and the story's Thursday row is
  the next thing the eye lands on. Back to the home: the station row is gone.
- **S2 — Phone rings, book them** (staff). Roster → search three letters → the record → **Book a
  departure** (the header's one primary) disclosing the `BookActivity` trip picker in place
  beneath the masthead.
- **S3 — Settle at the counter** (staff). The story's upcoming row shows the money fact; an open
  balance carries "Collect" as the row's fix; the order record is one tap.
- **S4 — Monday moderation** (Dana). Reviews opens on "Waiting on you — 2"; publish both inline
  (undo toasts); the aggregate line updates; nothing else on the page asked for attention.
- **S5 — Fix the release's typo** (Dana). Waiver → edit text → choose "a correction" → Publish.
  Standing signatures stay current; the log is untouched. The material path states its cost in the
  choice itself, and Publish stays the only button.
- **S6 — A day worth adding** (Dana). Requests: the Fri, Sep 4 group says 2 groups · 5 divers and
  what fits; "+ Add a departure" lands on the board's add panel with the date carried.

---

## 8a — The shared person-row vocabulary

```ts
// src/components/person/rows.tsx — NEW; the three rows every people surface shares.
export function CertificationCardRow(props: {
  kind: "level" | "specialty" | "nitrox";
  title: string;                        // "PADI Open Water"
  detail: string;                       // "card ···7231 · added Wed by Grace"
  state: "verified" | "pending" | "self_declared" | "imported_unconfirmed";
  actions?: ReactNode;                  // Verify / Remove, per caller's permissions
}): JSX.Element;
export function WaiverStateRow(props: {
  state: "current" | "expired" | "none" | "medical_review" | "failed";  // failed = integrity failure
  detail: string;                       // "signed Wed, Aug 26 · release v4" — or the failure sentence
  actions?: ReactNode;                  // the send routes, disclosed
}): JSX.Element;
export function BookingStoryRow(props: {
  date: string; title: string; meta: string;   // pre-formatted, locale+TZ aware
  money?: { state: "paid" | "open" | "refunded"; label: string };
  href?: string; past?: boolean; imported?: boolean;
}): JSX.Element;
```

**Tone escalation is deliberate:** on an artifact row (a card in the file) `pending` renders
the warning badge; a *blocker* row derived from it (the record's status ledger, the home's
station, the roster badge) carries the blocker's own tone — danger when it blocks boarding.
One fact, two contexts, stated here so it reads as design rather than drift.

The state→badge table, complete: `pending` → warning badge with glyph + word
(`divers.shared.cardStatus.pending`); `verified` → **no badge** (expected state); `self_declared`
→ warning badge, word from `divers.certifications.selfDeclaredLabel`; `imported_unconfirmed` →
neutral badge, word from `divers.shared.cardStatus.confirmToClear` (today's "confirm to clear"
nudge — a prompt, not a warning). `WaiverStateRow`'s `failed` is the integrity failure
`WaiverSection.tsx` states today (`divers.stats.waiverFailed`), the failure sentence in `detail`.
Readiness words keep coming from `readiness-labels`; the waiver words are the concrete
`staff/divers.json` `stats.waiver*` keys — there is no waiver label-map file.
Adopters after this slice: the record (8b), the counter row (Clearwater 6h keeps its own layout,
same badge), the trip roster when its own ADR's slices reach for them.

**Tests**: state→badge mapping (verified renders none); every state carries a word; imported rows
carry the marker text, never a bare tint.

## 8b — The diver record recomposition

**Scope.** `/shop/[shopSlug]/divers/[personId]` recomposes; every server action keeps its
signature. `max-w-4xl` per the width tiers.

```ts
// src/app/shop/[shopSlug]/divers/[personId]/_lib/status.ts — NEW assembly, no new detector.
export type DiverStatusRow = {
  kind: "certification" | "waiver" | "payment" | "contact";
  tone: "danger" | "warning";
  sentenceKey: string; values?: Record<string, string>;
  action: { labelKey: string; target: "verify" | "send_waiver" | "collect" | "edit_contact" };
  tripContext?: { tripId: string; startsAt: Date };  // "on tomorrow's 7:00"
};
export function buildDiverStatus(
  profile: DiverProfile /* existing */,
  nextBookingReadiness: ReadinessResult | null,  // src/lib/readiness.ts; null = no upcoming booking
): DiverStatusRow[];
// The page evaluates readiness for the next booking through the existing entry
// (`calculateReadiness` composed with `getTripSiteRequirement`, src/db/readiness.ts), as the
// Today queue does — never a second detector — and hands the result in. Record-level facts
// (no waiver on file, open balance) come off the profile. The `contact` row's trigger is no
// emergency contact on file — the same condition as the roster's `missing_contact` filter
// (src/db/divers.ts) — tone `warning`. Empty array when clear — and the section renders NOTHING.
```

- Order contract (from `Main.dc.html`): masthead (eyebrow=Divers back link, name, contact line
  with inline Edit-details disclosure) → the Book disclosure (closed) → status ledger → The story
  → Certifications (inset group, all three kinds, one "+ Add a card" flow with a kind select) →
  Waiver (one `WaiverStateRow`; send routes behind "Send options") → Gear and sizes (two rows,
  edit in place) → Notes → Activity (the existing paged audit trail, restyled as a collapsed
  `GroupLabel` disclosure, pagination unchanged) → the quiet foot (Download / Merge when
  candidates exist / Restore when removed / Delete; Erase only on a removed record).
  Removed-state banner and merge panel keep their conditions, restyled flat.
- **Book a departure** (the header's one primary) discloses the existing `BookActivity` trip
  picker in place beneath the masthead — unchanged action (`seatExistingDiverAction`, still
  surface `"diver-record"` in `src/app/actions/seat-diver-surfaces.ts`); the picker appears
  nowhere else on the page.
- Status-row targets: `verify` scrolls to and focuses the pending card's Verify control in the
  Certifications group; `send_waiver` opens the Waiver row's "Send options" disclosure; `collect`
  links to the open order at `/shop/[slug]/orders/[id]`; `edit_contact` opens the masthead's
  Edit-details disclosure.
- Masthead facts, exhaustively: email · phone · "DAN insurance on file" when
  `people.diveInsurance` is set · the visit ordinal (sailed bookings + `prior_visits` rows).
- The story's bound: all upcoming rows, plus the latest 10 past rows behind a "Show all N"
  `GroupLabel` disclosure (native `details`). A story with no rows renders the group label with
  one quiet line (`staff/divers.json` `story.empty`, "No visits yet."). A person-level order with
  no booking renders as its own story row (`BookingStoryRow` with the order's date, description
  as title, and its money fact; `href` to `/shop/[slug]/orders/[id]`); the create-invoice door
  survives as a quiet "+ New invoice" act at the story's foot
  (`/shop/[slug]/orders/new?personId=<id>`, permission-gated as today).
- One composition at all widths: below `sm` the four file groups collapse to door rows
  (`DiverPhone.dc.html`); each door is an in-page disclosure that opens that group's rows in
  place — no new routes, no navigation state. The door's fact is the group's one summary fact
  (pending count, waiver state word, sizes, note count).
- Deletes (H-49): `DiverSections` jump nav, `NoticeBanner`'s router (514 lines — notices route by
  `noticeForForm` to the group that owns the form), `SpecialtyCards.tsx` and
  `CertificationCards.tsx` (the twins fold into the group via 8a's row), `StatsSummary` tiles
  (the three figures live where they belong: cards state in its group, balance on the story rows,
  fit in its group).
- **Pins** (the surfaces.md treatment): the status section renders nothing when `buildDiverStatus`
  is empty; exactly one primary-weight control on the page (Book). Doc comment names this ADR.
- **Delight — the last thing clears.** The resolving actions (verify certification, record
  waiver, collect payment) re-run `buildDiverStatus` after their mutation; when it returns empty
  they redirect with `noticeUrl(path, "diver-clear")` instead of their ordinary success code.
  `noticeForForm` routes it to the masthead slot, rendered as `EarnedMomentLine`
  (`src/components/EarnedMoment.tsx`): `staff/divers.json` `notice.cleared` = "That was the last
  thing — nothing is waiting on {name}." (es-ES in the same change). The wording deliberately
  says "nothing is waiting", never "can board" — readiness is per-trip and the record must not
  overclaim.

**Tests**: the two pins as component tests; S1/S2/S3 e2e (extend the record's existing specs);
`?notice=` routing still lands beside the owning form for three representative codes; the
ordinary success code still fires while other status rows remain, and `diver-clear` fires only
when the post-mutation status is empty; visual re-captures (the record has 6).

## 8c — The roster ledger

- One rendering at all widths (the `sm:hidden` card list deletes); letter `GroupLabel`s from the
  existing sort; rows: name (RowLink), exceptional badge only (blocker, "Open balance", "Removed"
  in the deleted filter), quiet last-visit/booked fact; search + quick-add keep their behavior;
  the five filter views keep theirs too, rendered as `FilterChips` between search and the ledger;
  `Pager` unchanged. The "312 divers" line is the existing `page.total`.
- The row facts come from a **NEW** reader — nothing existing supplies them:
  `rosterFacts(db, shopId, personIds, { timeZone, now })` (or `summarizeDivers` growing the same
  fields) returns per person `lastAboardAt: Date | null` (latest sailed booking),
  `nextBookingAt: Date | null`, `importedOnly: boolean` (prior visits exist and no bookings),
  `openBalance: boolean` (any order with status `open`), and `blocker: AboardBlockerKind | null`
  sourced from the same `inHorizonReadiness` evidence Today uses (`src/db/blockers.ts`), batched
  for the page's ids.
- **Tests**: no badge renders for a clear diver; one DOM list at both widths; e2e roster search →
  record unchanged.

## 8d — Reviews as a worklist

- Order: header + one aggregate line (`getShopReviewAggregate` + month line) → withheld tone panel
  (unchanged condition) → "Waiting on you — N" rows (stars drawn, excerpt, publish/hide inline
  with undo) → "Published — N" quiet rows (the standout toggle inline beside Hide — existing
  actions and notices unchanged) → "Hidden — N" rows (reason + republish) → `Pager`.
- The data model: "Waiting on you" is its own unpaged query (the `onlyWaiting` scope; its N from
  `countReviewsAwaitingModeration`) and always renders complete; the `Pager` pages only
  Published + Hidden through `listShopReviewsForStaff` with a **NEW** published-state-then-date
  sort; each group label's N comes from a count sharing that group's exact scope (the Pager rule).
- Bulk publish: the selection checkboxes retire; the group-header act publishes every row in the
  waiting group (still bounded by `MAX_BULK_PUBLISH`, `src/db/reviews.ts`), its label carrying
  the count ("Publish all 5"). With N = 1 the header act does not render.
- The `FilterChips` view toggle retires (the groups are the filter); `ShopStat` tiles retire here.
- **Tests**: group membership (a just-published row moves groups on revalidate); publish/hide undo
  round-trip (existing e2e retargets); one aggregate line (no second rating rendering at header
  level); suppression-floor unit tests untouched and green.

## 8e — The waiver surface

- One page: the day-grouped log renders beneath the template card on `/waivers`;
  `/shop/[shopSlug]/waivers/signatures` becomes a 308 Route Handler to it preserving `?record=`
  and `?page=`; `WaiversSubNav` and the layout's sub-nav delete (H-49).
- Template card: textarea + **materiality choice** (radio pair; the material option's label carries
  the live `standingWaiverExposure` figures) + one Publish (InlineConfirm double-tap preserved on
  the material path only). With zero standing signatures the choice collapses away and Publish is
  alone. The recorded decision keeps writing `waiver_materiality_decisions` exactly as today.
- Signatures: day-grouped ledger rows (name · trip · time), integrity as a `Badge` **only when not
  valid** ("Not sealed", "Integrity failed"), the flagged-medical badge + its existing disclosure.
  A signature row's door discloses its full evidence block in place (today's anchored content); it
  does not navigate. `?record=` keeps today's resolve-to-page behavior — "pinned to the top" means
  the row renders first within its day group with a hairline left rule, never lifted out of the
  grouping.
- **Tests**: no submit without a choice when signatures stand; valid rows render no integrity
  badge; the two-radio copy carries the at-risk count; existing template e2e (`waivers.spec.ts`
  staff half) retargets.

## 8f — Requests in the language

- Day `GroupLabel` carries the count + "~M divers"; the advice sentence renders once under it
  (`adviseRequests` unchanged); rows via ledger grammar (soft matches in muted ink, never a tinted
  card); "+ Add a departure" one secondary per group, carrying `?date=&requests=` as today;
  "No date given" tail; `Pager`.
- A row is a door to the diver record when `request.personId` exists — otherwise no door; the
  mailto and "book them" acts render as the row's trailing quiet acts (existing hrefs unchanged:
  `mailto:` on the email, `/bookings/new?request=<id>`).
- **Tests**: soft-match renders as ink not tint; the add link carries its params; gate unchanged.

## Empty states (8c–8f)

Shipped empty states stand; letter groups, day groups and group labels render only over rows.

- **8c** — zero divers renders no letter groups; the shipped import door stands
  (`divers.list.emptyImportBody` / `emptyImportAction`, into `settings/import`), with search and
  quick-add still mounted; a search matching nobody → `divers.list.emptyShowAll`.
- **8d** — a group with zero rows renders nothing: no label, no empty-state sentence. With all
  three groups empty the page collapses to header + the shipped fork (`reviews.emptyHeading` /
  `emptyDetail` plus the `reviews.emptyReviewLinkBody` / `emptyReviewLinkAction` door); the
  `onlyWaiting` empty variant (`reviews.emptyWaitingHeading` / `emptyWaitingDetail`) dies with
  the chips it depended on; the aggregate line renders nothing at count 0.
- **8e** — signature-log day groups render only when rows exist; zero signatures → the shipped
  `waiversStaff.signatures.noSignedRecords` line. The template card's zero-signature collapse is
  already specified above.
- **8f** — zero requests → the shipped `requests.emptyHeading` / `emptyDetail` terminal state;
  day groups only when rows exist.

---

## Copy inventory

Additions: status-row sentences that don't already exist as blocker labels (`staff/divers.json`
`status.*`), the materiality radio labels, group labels; the roster facts ("last aboard {date}",
"booked {day}, {time}", "brought across from your old system", "{count} divers") and the record's
new strings (story metas "sailed" / "waiver signed", badge words "Waiting for verification" /
"Open balance" / "Blocked — certification", act words "Collect" / "Verify it" /
"Book a departure" / "Send options" / "+ Add a card" / "+ New invoice", `story.empty`,
`notice.cleared`), all in `staff/divers.json`; the reviews H1 ("What divers said",
`staff/reviews.json`); 8d's bulk-publish label as one ICU branch —
"{count, plural, =2 {Publish both} other {Publish all #}}" (es-ES: "=2 {Publicar ambas}") — so
N = 2, the most common queue, reads as the artboard draws it; the single Publish label
(`waiversStaff` namespace). Status sentences and
foot acts are written without third-person pronouns — the artboards' "her/she" is demo fiction;
use the diver's name or second person ("Download this record"). Deletions (all locales): the
record's ten section headings beyond the surviving four, the stat-tile labels, the reviews tile
labels, the roster's duplicate card-list strings; `waiversStaff.confirm.materialTrigger`,
`confirm.nonMaterialTrigger`, and whichever other `confirm.*` labels the radio form retires (keep
the InlineConfirm pair the material path still uses). Waiver/medical wording untouched
(H-01/H-03).

## Coverage updates

`scripts/route-coverage.json` rows for divers, divers/[personId], reviews, waivers, requests
update their capture lists; the waivers/signatures row retires with the route (a 308 Route
Handler is not a `page.tsx`), its captures folding into the waivers row. New captures:
`diver-record-clear` (the empty status ledger — the state a seeded demo never shows, via
`seed-trouble-states` if needed), `reviews-worklist`, `waiver-materiality-choice`.
