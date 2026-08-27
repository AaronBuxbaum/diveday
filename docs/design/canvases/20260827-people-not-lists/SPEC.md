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

---

## The journeys

- **S1 — Fix Grace before the boat** (Dana, from the home's station row). "Verify it" deep-links to
  the record; the status ledger is the first thing under the masthead with the same row and the
  same fix; verifying settles it; the ledger now renders nothing and the story's Thursday row is
  the next thing the eye lands on. Back to the home: the station row is gone.
- **S2 — Phone rings, book them** (staff). Roster → search three letters → the record → **Book a
  departure** (the header's one primary) → the existing picker flow.
- **S3 — Settle at the counter** (staff). The story's upcoming row shows the money fact; an open
  balance carries "Collect" as the row's fix; the order record is one tap.
- **S4 — Monday moderation** (Dana). Reviews opens on "Waiting on you — 2"; publish both inline
  (undo toasts); the aggregate line updates; nothing else on the page asked for attention.
- **S5 — Fix the release's typo** (Dana). Waiver → edit text → choose "a correction" → Publish.
  Standing signatures stay current; the log is untouched. The material path states its cost in the
  choice itself, and Publish stays the only button.
- **S6 — A day worth adding** (Dana). Requests: Sep 5 group says 2 groups · ~5 divers and what
  fits; "+ Add a departure" lands on the board's add panel with the date carried.

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
  state: "current" | "expired" | "none" | "medical_review";
  detail: string;                       // "signed Wed, Aug 26 · release v4"
  actions?: ReactNode;                  // the send routes, disclosed
}): JSX.Element;
export function BookingStoryRow(props: {
  date: string; title: string; meta: string;   // pre-formatted, locale+TZ aware
  money?: { state: "paid" | "open" | "refunded"; label: string };
  href?: string; past?: boolean; imported?: boolean;
}): JSX.Element;
```

State words come from the existing i18n label maps (`readiness-labels`, waiver labels); `pending`
renders the warning badge with glyph + word, `verified` renders **no badge** (expected state).
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
  tripContext?: { tripId: string; startsAt: Date };  // "she's on tomorrow's 7:00"
};
export function buildDiverStatus(profile: DiverProfile /* existing */): DiverStatusRow[];
// Sources: readiness blockers for their next booking (existing readers) + record-level facts
// (no waiver on file, open balance). Empty array when clear — and the section renders NOTHING.
```

- Order contract (from `Main.dc.html`): masthead (eyebrow=Divers back link, name, contact line
  with inline Edit-details disclosure) → status ledger → The story → Certifications (inset group,
  all three kinds, one "+ Add a card" flow with a kind select) → Waiver (one `WaiverStateRow`;
  send routes behind "Send options") → Gear and sizes (two rows, edit in place) → Notes → the
  quiet foot (Download / Merge when candidates exist / Restore when removed / Delete; Erase only
  on a removed record). Removed-state banner and merge panel keep their conditions, restyled flat.
- Deletes (H-49): `DiverSections` jump nav, `NoticeBanner`'s router (514 lines — notices route by
  `noticeForForm` to the group that owns the form), `SpecialtyCards.tsx` (folds into the group via
  8a's row), `StatsSummary` tiles (the three figures live where they belong: cards state in its
  group, balance on the story rows, fit in its group).
- **Pins** (the surfaces.md treatment): the status section renders nothing when `buildDiverStatus`
  is empty; exactly one primary-weight control on the page (Book). Doc comment names this ADR.

**Tests**: the two pins as component tests; S1/S2/S3 e2e (extend the record's existing specs);
`?notice=` routing still lands beside the owning form for three representative codes; visual
re-captures (the record has 6).

## 8c — The roster ledger

- One rendering at all widths (the `sm:hidden` card list deletes); letter `GroupLabel`s from the
  existing sort; rows: name (RowLink), exceptional badge only (blocker via the existing
  roster-facts reader, "Open balance", "Removed" in the deleted filter), quiet last-visit/booked
  fact; search + quick-add keep their behavior; `Pager` unchanged.
- **Tests**: no badge renders for a clear diver; one DOM list at both widths; e2e roster search →
  record unchanged.

## 8d — Reviews as a worklist

- Order: header + one aggregate line (`getShopReviewAggregate` + month line) → withheld tone panel
  (unchanged condition) → "Waiting on you — N" rows (stars drawn, excerpt, publish/hide inline
  with undo; bulk publish survives as a group-header action when N > 1) → "Published — N" quiet
  rows (standout mark; hide inline) → "Hidden — N" rows (reason + republish) → `Pager`.
- The `FilterChips` view toggle retires (the groups are the filter); `ShopStat` tiles retire here.
- **Tests**: group membership (a just-published row moves groups on revalidate); publish/hide undo
  round-trip (existing e2e retargets); one aggregate line (no second rating rendering at header
  level); suppression-floor unit tests untouched and green.

## 8e — The waiver surface

- Template card: textarea + **materiality choice** (radio pair; the material option's label carries
  the live `standingWaiverExposure` figures) + one Publish (InlineConfirm double-tap preserved on
  the material path only). With zero standing signatures the choice collapses away and Publish is
  alone. The recorded decision keeps writing `waiver_materiality_decisions` exactly as today.
- Signatures: day-grouped ledger rows (name · trip · time), integrity as a `Badge` **only when not
  valid** ("Not sealed", "Integrity failed"), the flagged-medical badge + its existing disclosure;
  the `?record=` highlight pins its row to the top with a hairline emphasis, not a tinted card.
- **Tests**: no submit without a choice when signatures stand; valid rows render no integrity
  badge; the two-radio copy carries the at-risk count; existing template e2e (`waivers.spec.ts`
  staff half) retargets.

## 8f — Requests in the language

- Day `GroupLabel` carries the count + "~M divers"; the advice sentence renders once under it
  (`adviseRequests` unchanged); rows via ledger grammar (soft matches in muted ink, never a tinted
  card); "+ Add a departure" one secondary per group, carrying `?date=&requests=` as today;
  "No date given" tail; `Pager`.
- **Tests**: soft-match renders as ink not tint; the add link carries its params; gate unchanged.

---

## Copy inventory

Additions: status-row sentences that don't already exist as blocker labels (`staff/divers.json`
`status.*`), the materiality radio labels, group labels. Deletions (all locales): the record's ten
section headings beyond the surviving four, the stat-tile labels, the reviews tile labels, the
roster's duplicate card-list strings. Waiver/medical wording untouched (H-01/H-03).

## Coverage updates

`scripts/route-coverage.json` rows for divers, divers/[personId], reviews, waivers,
waivers/signatures, requests update their capture lists; new captures: `diver-record-clear` (the
empty status ledger — the state a seeded demo never shows, via `seed-trouble-states` if needed),
`reviews-worklist`, `waiver-materiality-choice`.
