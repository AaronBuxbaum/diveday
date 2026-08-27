import { MINUTE_MS } from "@/lib/clock";
import { nowDate } from "./clock";
import type { EmergencyReference } from "./emergency-reference";
import type { TripManifest } from "./manifests";
// Same reasoning as the roll-call import above: dependency-free, so a value
// import here is safe for the service worker to carry.
import { latestPreDepartureCheck, type PreDepartureCheckStatus } from "./pre-departure-check";
import type { ReadinessBlocker, ReadinessBlockerCode } from "./readiness";
// The roll-call rules come from `./roll-call`, never from `./manifests`: this
// module is compiled into the service worker, and a *value* import from
// `manifests.ts` pulls `readiness.ts` → `waivers.ts` → `node:crypto` into that
// bundle and fails `scripts/build-service-worker.mjs` outright, with
// `pnpm typecheck` none the wiser. See the head of `./roll-call`.
import type { RollCallRecord } from "./roll-call";
import {
  carryForwardNotBoarded,
  isNotBackAboard,
  RETRACTION_SUPERSEDED,
  rollCallCheckpoints,
} from "./roll-call";
import type { SupportArrangements } from "./support-needs";

/**
 * Bumped whenever the snapshot shape changes. It is the AES-GCM additional
 * data, so an older cached snapshot fails to decrypt rather than being read
 * back into a type it no longer matches.
 *
 * v3 added the carried-forward (`implied`) flag to roll-call records so a diver
 * who left the boat earlier reads as "not boarded · carried" offline, matching
 * the live manifest, instead of a fabricated explicit result.
 *
 * v4 narrows the diver shape from a deny-list to an explicit allow-list. The
 * bump is doing real work here: age and minor status briefly rode into this
 * payload (see the note on `divers` below), and only a version change purges
 * the copies already written to crew devices — they fail to decrypt and are
 * discarded rather than lingering to their natural 14-day expiry.
 *
 * Deliberately **not** bumped for per-person crew results (ADR
 * 20260803-per-person-crew-roll-call). A bump is a purge, and a purge is not
 * free: a v4 record that fails to decrypt is overwritten with `events: []` by
 * `saveOfflineManifest`, throwing away any roll call a crew member queued
 * offline and has not synced. `crew[].rollCall` is additive and optional, and
 * its absence means "nobody has said", so a v4 snapshot saved before crew had
 * results of their own reads *every* crew member as awaiting and the checkpoint
 * stays open. The dangerous direction — offline "done" while online says
 * otherwise — is the one that cannot happen, so the version stands.
 *
 * Not bumped for *dropping* `crewAttestation` either (ADR
 * 20260804-crew-roll-call-is-per-person). A snapshot written before that change
 * still carries the field; nothing reads it any more, and an extra property on
 * a decrypted record is inert. Purging a fortnight of dock copies — and any
 * unsynced roll call riding on them — to delete a field nobody looks at would
 * trade a real safety cost for tidiness.
 *
 * And **not bumped for `crew[].id`** (H-46, 2026-08-14), the field that makes
 * the crew half of a head count recordable with no signal. Same reasoning a
 * third time, and it is the reasoning that matters most here: the copies this
 * would purge are precisely the ones a boat is out with, and the queued roll
 * call it would discard is the record of who came back from a dive. The field
 * is optional and additive, and its absence fails *closed* — a snapshot saved
 * before this change has crew with no id, those crew stay unrecordable on that
 * copy, and the checkpoint stays open there exactly as it does today. A device
 * that never sees a newer snapshot is no worse off than before; one that does
 * gains the control. Neither direction can read "done" while online says
 * otherwise, which is the only direction a bump would be worth paying for.
 */
export const OFFLINE_MANIFEST_RECORD_VERSION = 4 as const;

/**
 * The offline shell's own cache generation — distinct from
 * `OFFLINE_MANIFEST_RECORD_VERSION` above, which versions the encrypted
 * snapshot payload. This one versions the *app shell itself* (the cached
 * HTML/JS `public/manifest-sw.js` serves while offline) and must be bumped
 * there in lockstep — `CACHE_NAME`'s `-v<n>` suffix — whenever a deploy
 * changes that shell. `manifest-sw.js` is a static file outside the Next.js
 * build, so it can't import this constant directly; the two are compared at
 * runtime instead (`getActiveOfflineShellVersion` in
 * `offline-manifest-store.ts`) to warn a crew member holding a copy of the
 * shell from an older deploy (task 124 / persona 15, Leo) rather than
 * silently serving it with no signal anything's stale.
 *
 * v2 precaches the chunks the bundler's runtime loads lazily, which the shell
 * HTML never names (see `lazyChunkEntries` in `public/manifest-sw.js`). A v1
 * shell is genuinely broken offline — hydration can ask for a chunk nothing
 * cached and the captain gets the error boundary instead of the roll call —
 * so unlike the snapshot version above, this bump is *worth* the purge: there
 * is no queued roll call inside an app shell to lose, only stale bundles.
 */
export const OFFLINE_MANIFEST_SHELL_VERSION = "v2";

export const OFFLINE_MANIFEST_CURRENT_MS = 15 * MINUTE_MS;
export const OFFLINE_MANIFEST_AGING_MS = 4 * 60 * 60 * 1000;
export const OFFLINE_MANIFEST_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Unchanged at seven days post-trip (owner decision 2026-07-26, H-05): there's
// no manual delete button (ADR 20260726), so this lazy-on-read expiry is the
// only way a device copy goes away once it's no longer needed.
export const OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineManifestFreshness = "current" | "aging" | "stale";

export type OfflineManifestPayload = {
  /**
   * `emergencyReference` rides here, and that is the point of carrying it at
   * all: this snapshot is the document a crew has with no signal, and until
   * issue #688 it held who is aboard and who to phone *afterwards* and nothing
   * for the minute in between. A chamber number on a laminated card in the shop
   * is worth nothing on the boat.
   */
  shop: {
    slug: string;
    name: string;
    timezone: string;
    /**
     * **Optional, and read with a fallback**, for the same reason a diver's
     * `buddyTeamNames` below is: a record written by an older build still
     * decrypts, because `OFFLINE_MANIFEST_RECORD_VERSION` is the AAD and this
     * field did not change it. `loadOfflineManifest`'s shape guard only checks
     * `manifests`, so a stale envelope reaches the viewer intact — and a
     * required field would arrive `undefined`, `hasEmergencyReference` would
     * read `.lines.length` off it, and the one surface a crew has with no
     * signal would throw during render, with no `error.tsx` under
     * `/offline-manifest` to catch it. It fails toward silence instead.
     */
    emergencyReference?: EmergencyReference;
  };
  /**
   * The shop's own pre-departure safety line, and the last known answer to
   * each item **for the trip this payload is about** — trip-level, unlike
   * `manifests` below, because the check happens once before the boat leaves,
   * not once per checkpoint. Optional and additive for the usual reason: a
   * snapshot saved before this field existed still decrypts, and its absence
   * reads as "nothing to check" rather than throwing.
   */
  checklist?: {
    items: Array<{
      id: string;
      label: string;
      check?: {
        state: "checked";
        occurredAt: string;
        recordedByName: string;
        note: string | null;
      };
    }>;
  };
  manifests: Array<
    Omit<TripManifest, "trip" | "divers" | "crew" | "completeness"> & {
      trip: Omit<TripManifest["trip"], "startsAt" | "endsAt"> & {
        startsAt: string;
        endsAt: string;
      };
      /**
       * Names, roles, each crew member's saved result — and, since H-46, their
       * **person id**, which is the subject of a crew roll-call write (ADR
       * 20260803-per-person-crew-roll-call). The dock copy carries it because
       * it can now record one: a captain offshore with the radio off could
       * count divers but not crew, and `rollCallCompleteness` needs both
       * halves, so the after-dive checkpoint — the one where a person may still
       * be in the water — could not be closed at sea.
       *
       * H-46 (2026-08-14) settled the minimisation question this asks and it is
       * consumed here, not re-opened: while DiveDay is pre-pilot, the fuller
       * feature beats a tighter posture. Adding one field to this allow-list
       * deliberately is the allow-list working, not being abandoned — the
       * *reason* it is an allow-list is that a deny-list once shipped H-21's
       * age, minor status and birthdays to every crew phone for a fortnight
       * with nothing rendering them.
       *
       * **Optional, and its absence fails closed.** A copy saved before this
       * change has crew with no id; they stay unrecordable on that copy and the
       * checkpoint stays open, exactly as it does today. The same is true of
       * `rollCall` absent, which means nobody had said — so an older snapshot
       * reads every crew member as awaiting and the checkpoint stays open here
       * exactly as it does online. Never the reverse: offline reading *closed*
       * while online says otherwise is a checkpoint that looks finished while
       * somebody is still down.
       */
      crew: Array<
        Pick<TripManifest["crew"][number], "fullName" | "roles"> & {
          /** See above: optional, because a snapshot older than H-46 has none. */
          id?: string;
          /**
           * Everyone on the teams this crew member is on, by name only — the
           * same rule and the same reason as a diver's `buddyTeamNames` below.
           * Flattened across teams, because a divemaster leading three groups
           * on the dock is being asked "who are you with?", not "which of your
           * three groups is this?".
           */
          buddyTeamNames?: string[];
          rollCall?: {
            state: "boarded" | "not_boarded";
            occurredAt: string;
            recordedByName: string;
            /** Carried forward from an earlier checkpoint, not recorded here. */
            implied?: boolean;
          };
        }
      >;
      // `completeness` is deliberately *not* carried. It is derived, and the
      // device's own `awaiting` count comes from local events rather than this
      // snapshot, so the offline view recomputes it with `rollCallCompleteness`
      // instead of reading a save-time answer that is stale the moment a crew
      // member taps anything.
      /**
       * An explicit **allow-list**, not `Omit<...>`. It used to be a deny-list,
       * which meant every field later added to a manifest diver silently
       * shipped to every crew phone — that is exactly how H-21's `age`,
       * `minor`, and `birthday` reached this payload, retained for up to 14
       * days on personal devices, rendered by nothing, and describing children.
       * Written this way the next new field fails to compile instead.
       *
       * Only what dock-side roll call actually needs belongs here.
       */
      divers: Array<
        Pick<
          TripManifest["divers"][number],
          | "bookingId"
          | "fullName"
          | "emergencyContactName"
          | "emergencyContactPhone"
          | "rentalFit"
          | "nitroxRequested"
          /**
           * **Carried whole, free text included** (issue #1067).
           *
           * This is the one field on this list that was argued both ways. The
           * allow-list exists because the payload sits up to 14 days in
           * encrypted IndexedDB on a deckhand's *personal* phone, which is why
           * `age`, `minor` and `birthday` were taken back off it -- and support
           * needs are health-adjacent facts about disabled adults, which is the
           * same argument.
           *
           * It rides anyway, because of where it is read. A water lift and an
           * agreed-signal briefing are *mooring* facts: boarding assistance is
           * dock-side, where signal usually exists, but the plan for dive two
           * is made at the site, off the copy that is then the only copy. The
           * ADR names "a support-diver count silently lost between `/ready` and
           * the manifest" as this record's failure mode, and a crew that cannot
           * see it offshore is exactly that loss.
           *
           * The two free-text fields ride too rather than being trimmed off.
           * The equipment note and the named buddy are the most operational
           * things here -- "webbed gloves, short fin" is what somebody packs,
           * and a person you must be teamed with is the arrangement a crew
           * acts on at the mooring -- and shipping the flags while dropping
           * the words would give the boat a record it could not act on.
           *
           * `SupportArrangements` rather than `SupportNeeds`, which is the
           * record minus `statedAt`. That field is a `Date` and nothing else
           * in this payload is -- it is written as JSON, so it would come back
           * a string wearing a `Date` type -- and it is the one field here
           * that is not an arrangement: it answers "was this diver ever
           * asked", which the diver's own page reads and no crew surface
           * renders.
           *
           * This is the one entry on this list that is a type alias rather
           * than a named field, and deliberately so: the decision was to carry
           * the whole record, so a ninth *arrangement* column should ride
           * without anybody having to remember. The allow-list's promise still
           * holds where it matters -- a new field on a manifest diver does not
           * reach a crew phone until it is named above.
           */
        > & {
          /**
           * Optional and additive, like `buddyTeamNames` above and for the
           * same reason: a snapshot written before this change still decrypts
           * (`OFFLINE_MANIFEST_RECORD_VERSION` is the AAD and this field did
           * not change it), and a required field would arrive `undefined` on
           * the one surface a crew has with no signal. Absent reads as "no
           * record", which is what a diver who was never asked has anyway.
           */
          supportNeeds?: SupportArrangements | null;
          /** Dropped at save time; the dock does not need it (kept for shape parity). */
          email: null;
          /**
           * The rest of this diver's buddy team **by name only** — no booking
           * ids, no person ids, deliberately (ADR 20260804-buddy-teams). The
           * dock copy *displays* teams; it never computes team divergence,
           * because a snapshot cannot know who came back — an id would invite
           * exactly that derivation.
           *
           * A list, because a team is two or more and a member may be crew.
           * Crew are not marked as such here: the dock copy prints who you are
           * with, and the roles list above already says who is crew.
           *
           * Optional and additive, so no `OFFLINE_MANIFEST_RECORD_VERSION`
           * bump (a bump is a purge — see the note on the constant above): an
           * older snapshot simply shows no team, which is display-only and
           * fails toward silence, never toward a false all-clear. A snapshot
           * saved before this field became a list carried `buddyFullName`,
           * which no reader looks at any more — the same silence.
           */
          buddyTeamNames?: string[];
          /**
           * `text` is resolved once, at save time — this snapshot may be read
           * back with no network and no translator available, so unlike the
           * live manifest it cannot look `code` up lazily.
           */
          readiness: {
            status: "ready" | "blocked";
            blockers: Array<{ code: ReadinessBlockerCode; text: string }>;
          };
          rollCall?: {
            state: "boarded" | "not_boarded";
            occurredAt: string;
            recordedByName: string;
            /** Carried forward from an earlier checkpoint, not recorded here. */
            implied?: boolean;
          };
        }
      >;
    }
  >;
};

export type OfflineManifestSnapshot = OfflineManifestPayload & {
  version: typeof OFFLINE_MANIFEST_RECORD_VERSION;
  snapshotId: string;
  savedAt: string;
  expiresAt: string;
};

/**
 * One result a device recorded with no signal, waiting to reach the server.
 *
 * **Widened additively, and deliberately not a discriminated union.** An event
 * names exactly one subject — a diver's `bookingId` or a crew member's
 * `crewPersonId` — but that is expressed as two optional fields plus
 * {@link offlineRollCallSubject}, not as a union keyed on some `subject` tag.
 * The events that matter most here are the ones **already sitting in a
 * captain's IndexedDB**, written with `bookingId` and nothing else: an unsynced
 * event is a person somebody counted with no radio, and a union would make
 * every one of them fail its own type the moment the app updates. A stored
 * record is not a wire format that can be migrated on the next deploy; there is
 * no deploy that reaches a phone in a dry bag on a boat.
 */
export type OfflineRollCallEvent = {
  clientEventId: string;
  snapshotId: string;
  snapshotSavedAt: string;
  tripId: string;
  /** A diver's paid seat. Absent on a crew event; see the note above. */
  bookingId?: string;
  /** A rostered crew member's `people.id`. Absent on a diver event. */
  crewPersonId?: string;
  checkpoint: TripManifest["checkpoint"];
  /**
   * **`cleared` is the retraction**, and it joined this vocabulary on
   * 2026-08-15 (ADR 20260815-offline-can-unsay-a-missing-diver). Before it,
   * the only way to take back a mis-tapped "not back aboard" offline was to
   * tap "Mark aboard" — a positive claim that this person is back on the boat,
   * from a full-width button directly beneath the one that raised the alarm.
   * "I didn't mean to say she's missing" and "I have eyes on her, she's
   * aboard" are different statements, and the device could only make the
   * second: the trail then held a sighting nobody made, and the live manifest
   * (which has always emitted `cleared`) and this copy degraded differently on
   * the same mis-tap.
   *
   * **Additive, and deliberately no `OFFLINE_MANIFEST_RECORD_VERSION` bump**
   * (see that constant: a bump is a *purge* of every roll call a captain has
   * queued and not synced). Nothing about the encrypted snapshot payload
   * changes — this widens only the events written beside it, the server writer
   * has accepted `cleared` since the live manifest's first undo, and a
   * device holding older events keeps parsing them unchanged.
   */
  status: "boarded" | "not_boarded" | "cleared";
  /**
   * What a `cleared` is taking back: the `clientEventId` of the statement this
   * device was looking at when somebody tapped undo (ADR
   * 20260815-an-offline-retraction-names-its-target). Absent on every other
   * status, and on a retraction queued by a build that predates the field.
   *
   * It is what makes the retraction a **compare-and-set** rather than a blind
   * newest-wins write: `recordRollCall`/`recordCrewRollCall` apply it only while
   * that event is still the newest one standing at this subject and checkpoint,
   * so a device holding a copy up to a fortnight old cannot unsay a *different*
   * device's "did not come back from the dive". Before this the only guard was
   * `newest.occurredAt > occurredAt`, and a retraction is stamped at tap time —
   * so one tapped now beat everything recorded before now.
   *
   * **The target's own client event id, not a row id or a `seq`.** This device
   * mints it locally, at queue time, which is the only identity an event has
   * while it is still sitting in this queue unsynced — and retracting a mark
   * that has not reached DiveDay yet is the ordinary case, not the exotic one.
   * A status-and-timestamp pair would not do: two taps share a millisecond
   * under a coarse or frozen clock, which is the very tie `latestQueuedAttempt`
   * exists to break.
   *
   * **Additive, and no `OFFLINE_MANIFEST_RECORD_VERSION` bump** — the same
   * reasoning as `cleared` itself, one field later. The snapshot payload is
   * untouched, older events parse with this undefined, and undefined means
   * "took the pre-change path", which the server still accepts.
   */
  retractsClientEventId?: string;
  occurredAt: string;
  syncStatus: "pending" | "applied" | "rejected";
  rejectionReason?: string;
};

/**
 * Who one queued event is about, or `null` when that cannot be answered.
 *
 * The one reader of the two optional subject fields above, so "exactly one of
 * them is set" is checked in a single place rather than assumed at each. `null`
 * for **neither** (an event that claims something about nobody) and for
 * **both** (a claim the two recorders cannot both honour) — those are not the
 * same mistake, but they have the same safe answer, and neither may be guessed
 * at: guessing writes a result against the wrong person on the one screen that
 * says who came back from a dive.
 *
 * `appendOfflineRollCall` refuses a null subject rather than storing an event
 * nobody can attribute, and the sync route's schema refuses the same shape on
 * the way in.
 */
export function offlineRollCallSubject(
  event: Pick<OfflineRollCallEvent, "bookingId" | "crewPersonId">,
): { kind: "diver"; bookingId: string } | { kind: "crew"; crewPersonId: string } | null {
  const { bookingId, crewPersonId } = event;
  const hasBooking = typeof bookingId === "string" && bookingId.length > 0;
  const hasCrew = typeof crewPersonId === "string" && crewPersonId.length > 0;
  // Neither or both: no safe reading, so no reading at all.
  if (hasBooking === hasCrew) return null;
  if (hasBooking) return { kind: "diver", bookingId };
  if (hasCrew) return { kind: "crew", crewPersonId };
  return null;
}

/**
 * One queued tap against one checklist item. A sibling array on the envelope,
 * not a widened `OfflineRollCallEvent` and not a discriminated union of the
 * two — the same reasoning `OfflineRollCallEvent`'s own doc comment gives:
 * events already sitting in a captain's IndexedDB were written to this exact
 * shape, and a union would make every one of them fail to parse the moment
 * the app adds a second kind. This rides the *same* queue, storage, lock and
 * sync round trip as roll call — see `appendOfflineChecklistCheck` and
 * `syncOfflineManifest` — it is simply never merged into roll call's own
 * array.
 */
export type OfflineChecklistEvent = {
  clientEventId: string;
  snapshotId: string;
  snapshotSavedAt: string;
  tripId: string;
  checklistItemId: string;
  status: PreDepartureCheckStatus;
  /** Names the `checked` this `cleared` takes back — see `OfflineRollCallEvent.retractsClientEventId`. */
  retractsClientEventId?: string;
  note: string | null;
  occurredAt: string;
  syncStatus: "pending" | "applied" | "rejected";
  rejectionReason?: string;
};

export type OfflineManifestEnvelope = {
  snapshot: OfflineManifestSnapshot;
  events: OfflineRollCallEvent[];
  checklistEvents: OfflineChecklistEvent[];
};

/**
 * What `GET /api/offline-manifests/upcoming` answers — the shop's whole rolling
 * window, for the two callers that are there for the board:
 * `OfflineManifestAutoSave` and the service worker's `refreshSavedManifests`.
 *
 * Declared here, and shared by the route and both readers, because the readers
 * are the far side of a `response.json()` cast and a cast believes whatever it
 * is told. The service worker spent its whole existence reading `body.manifests`
 * — the key *inside* a payload, not the one beside it — so its save loop ran
 * zero times on every push, silently, on a locked phone with nobody to tell.
 * One name, checked by `pnpm typecheck` at both ends (including
 * `tsc -p src/worker`), is what makes that a build failure rather than a
 * captain's snapshot quietly never updating.
 */
export type OfflineManifestUpcomingResponse = {
  shop: OfflineManifestPayload["shop"];
  payloads: OfflineManifestPayload[];
};

/**
 * What `GET /api/offline-manifests/identity` answers: which shop this browser
 * is signed in as, and deliberately nothing else — no roster, no names, not
 * even a count of them (review 20260802, action item 12). The offline shell
 * reads it to decide which of this device's saved rosters belong to somebody
 * else and must be purged.
 *
 * Kept a separate type from the `shop` above rather than reusing it: that one
 * carries the name and timezone a snapshot needs to render offline, and this
 * one must not grow them by inheritance. The whole point of the endpoint is
 * that it answers with one string.
 */
export type OfflineManifestIdentityResponse = {
  shop: { slug: string };
};

/**
 * The tenant slug out of a response body that has **not** been validated —
 * `/identity`'s whole answer, and the `shop` that rides along on `/upcoming`.
 *
 * `response.json()` hands back `any`, so `as OfflineManifestIdentityResponse`
 * is a promise rather than a check: a body of `{}` casts cleanly and yields
 * `undefined` for `shop.slug`. That matters more here than almost anywhere
 * else in the product, because the only thing any caller does with this string
 * is decide which of the device's saved rosters belong to somebody else, and
 * `purgeOfflineManifestsExceptShop("")` matches no record — which is to say it
 * matches every one of them (security review, 2026-08-06). One parser, shared
 * by the offline shell, the shop layout's auto-save and the service worker, so
 * there is one place that can be wrong instead of three.
 *
 * `null` rather than a fallback slug: "could not tell" and "the shop is X"
 * must never be the same value.
 */
export function offlineManifestShopSlug(body: unknown): string | null {
  // Destructured off the route's own declared type rather than an inline
  // `{ shop?: ... }` shape, so renaming the key on the route is a `tsc`
  // failure here (including `tsc --noEmit -p src/worker`) instead of a parser
  // that quietly answers null forever. `/upcoming`'s `shop` carries the name
  // and timezone too; only the slug is ever read through this.
  const { shop } = (body ?? {}) as Partial<OfflineManifestIdentityResponse>;
  const slug: unknown = shop?.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

/**
 * The board out of an unvalidated `/upcoming` body: an array, or nothing.
 * `body.payloads.map(...)` throws outright on a body that carries no
 * `payloads`, and a cast is what let one through. What is *inside* each
 * payload is left to `saveOfflineManifest`, which already refuses one with no
 * trip in it, and to callers that already swallow a per-trip failure.
 */
export function offlineManifestPayloads(body: unknown): OfflineManifestPayload[] {
  const { payloads } = (body ?? {}) as Partial<OfflineManifestUpcomingResponse>;
  return Array.isArray(payloads) ? payloads : [];
}

/**
 * `navigator.onLine` says a radio is on, not that anything answers. On a
 * marina connection the tenant lookup can hang indefinitely, and everything
 * downstream of it — the cross-shop purge, and the reconcile of a captain's
 * queued roll call — would hang with it. Give up and let the next trigger
 * (reconnect, the next visit, the next push) try again.
 */
const TENANT_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Server-verified "which shop is this browser signed in as" — never a
 * client-supplied value, never a slug read off a snapshot this device already
 * holds. Asks `GET /api/offline-manifests/identity`, which answers
 * `{ shop: { slug } }` and nothing else (no roster, no names, not even a count
 * of them — review 20260802, action item 12).
 *
 * `null` whenever the answer cannot be established: offline, signed out, a
 * request that failed or timed out, a 200 whose body is the wrong shape. Every
 * caller treats null as "do nothing", because guessing the tenant is the one
 * mistake worth more than the work it would unblock — it either deletes the
 * copy a captain is standing on the dock reading, or submits one shop's roll
 * call under another shop's session.
 *
 * It lives in this framework-free module, rather than beside its first caller
 * in `OfflineManifestView`, because its second caller is the **service
 * worker** (`flushPendingRollCall`), which is bundled by
 * `scripts/build-service-worker.mjs` out of a separate tsconfig project and
 * cannot reach a `"use client"` React component. Two hand-kept copies of a
 * cross-tenant check is two chances for one of them to accept `undefined` as a
 * shop.
 *
 * An explicit `AbortController` rather than `AbortSignal.timeout`, matching
 * `fetchExportPhotos`: the static helper is absent under jsdom, so using it
 * would make this return null in every component test and silently disable the
 * reconcile it guards.
 */
export async function fetchOfflineManifestShopSlug(): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TENANT_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch("/api/offline-manifests/identity", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return offlineManifestShopSlug(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function serializeManifests(
  manifests: readonly TripManifest[],
  shop: OfflineManifestPayload["shop"],
  /** Same resolver `src/i18n/readiness-labels.ts#readinessBlockerText` gives a caller with a translator. */
  resolveBlockerText: (blocker: ReadinessBlocker) => string,
  /** The shop's checklist items and this trip's latest known check per item — absent (or empty) is a shop with none. */
  checklist: ReadonlyArray<{
    id: string;
    label: string;
    check?: { occurredAt: Date; recordedByName: string; note: string | null };
  }> = [],
): OfflineManifestPayload {
  return {
    shop,
    checklist: {
      items: checklist.map((item) => ({
        id: item.id,
        label: item.label,
        check: item.check
          ? {
              state: "checked" as const,
              occurredAt: item.check.occurredAt.toISOString(),
              recordedByName: item.check.recordedByName,
              note: item.check.note,
            }
          : undefined,
      })),
    },
    manifests: manifests.map(({ completeness: _completeness, ...manifest }) => ({
      ...manifest,
      trip: {
        ...manifest.trip,
        startsAt: manifest.trip.startsAt.toISOString(),
        endsAt: manifest.trip.endsAt.toISOString(),
      },
      crew: manifest.crew.map((member) => ({
        // The subject of a crew roll-call write, and the only reason the crew
        // half is recordable on this copy at all (H-46).
        id: member.id,
        fullName: member.fullName,
        roles: member.roles,
        // Names only, and de-duplicated: a teammate who shares two of this
        // person's groups is still one body to look for.
        buddyTeamNames: [
          ...new Set(
            (member.buddyTeams ?? []).flatMap((team) => team.others.map((other) => other.fullName)),
          ),
        ],
        rollCall: member.rollCall
          ? {
              state: member.rollCall.state,
              occurredAt: member.rollCall.occurredAt.toISOString(),
              recordedByName: member.rollCall.recordedByName,
              implied: member.rollCall.implied ?? false,
            }
          : undefined,
      })),
      // Built field-by-field rather than spread, matching the allow-list type
      // above: what the dock needs, and nothing else. Age, minor status, and
      // birthdays (H-21) are deliberately absent — they are staff-screen facts,
      // not something to persist on a deckhand's phone for a fortnight.
      divers: manifest.divers.map((diver) => ({
        bookingId: diver.bookingId,
        fullName: diver.fullName,
        emergencyContactName: diver.emergencyContactName,
        emergencyContactPhone: diver.emergencyContactPhone,
        rentalFit: diver.rentalFit,
        nitroxRequested: diver.nitroxRequested,
        // Whole or absent, never partially: `supportNeedFacts` is the one
        // derivation of what this record says, and it reads every column.
        supportNeeds: diver.supportNeeds
          ? {
              supportDiversNeeded: diver.supportNeeds.supportDiversNeeded,
              supportDiversProvidedBy: diver.supportNeeds.supportDiversProvidedBy,
              needsBoardingAssistance: diver.supportNeeds.needsBoardingAssistance,
              needsWaterLift: diver.supportNeeds.needsWaterLift,
              briefingInSign: diver.supportNeeds.briefingInSign,
              briefingInWriting: diver.supportNeeds.briefingInWriting,
              briefingAloud: diver.supportNeeds.briefingAloud,
              briefingBySignals: diver.supportNeeds.briefingBySignals,
              equipmentAdaptation: diver.supportNeeds.equipmentAdaptation,
              divesWithName: diver.supportNeeds.divesWithName,
            }
          : null,
        // Names only, never a teammate's booking or person id — the dock copy
        // displays teams and must stay unable to compute divergence from a
        // snapshot.
        buddyTeamNames: (diver.buddyTeam?.others ?? []).map((other) => other.fullName),
        // Not needed for dock-side roll call; minimize retained private data.
        email: null as null,
        readiness: {
          status: diver.readiness.status,
          blockers: diver.readiness.blockers.map((blocker) => ({
            code: blocker.code,
            text: resolveBlockerText(blocker),
          })),
        },
        rollCall: diver.rollCall
          ? {
              state: diver.rollCall.state,
              occurredAt: diver.rollCall.occurredAt.toISOString(),
              recordedByName: diver.rollCall.recordedByName,
              // Preserve the carried-forward default so it never reads as an
              // explicit dock-side result the crew did not actually record.
              implied: diver.rollCall.implied ?? false,
            }
          : undefined,
      })),
    })),
  };
}

export function offlineManifestExpiresAt(savedAt: Date, tripEndsAt: Date): Date {
  return new Date(
    Math.min(
      savedAt.getTime() + OFFLINE_MANIFEST_MAX_RETENTION_MS,
      tripEndsAt.getTime() + OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS,
    ),
  );
}

export function offlineManifestFreshness(
  savedAt: Date,
  now: Date = nowDate(),
): OfflineManifestFreshness {
  const age = Math.max(0, now.getTime() - savedAt.getTime());
  if (age <= OFFLINE_MANIFEST_CURRENT_MS) return "current";
  if (age <= OFFLINE_MANIFEST_AGING_MS) return "aging";
  return "stale";
}

/**
 * How old a saved copy is, as a magnitude and a unit rather than a sentence.
 * `docs/design/principles.md` §4 lets a safety surface keep its precision only
 * in human words — a copy that is no longer current has to say "Saved 4 hours
 * ago — refresh before you rely on it", never a tier name — and the words are
 * the UI's to pick per locale, so this returns the two numbers
 * `Intl.RelativeTimeFormat` needs and no English at all.
 *
 * Floors rather than rounds, the way every "… ago" reads: a copy saved 119
 * minutes ago is "1 hour", not "2 hours". Rounding is safe to leave loose here
 * only because it decides nothing — `offlineManifestFreshness` above is the
 * exact classification, and a floored age is never shown at all on a copy that
 * is still current, so it can round a copy's age down but never round a copy
 * into looking trustworthy.
 */
export function offlineManifestAge(
  savedAt: Date,
  now: Date = nowDate(),
): { unit: "minute" | "hour" | "day"; value: number } {
  const minutes = Math.floor(Math.max(0, now.getTime() - savedAt.getTime()) / MINUTE_MS);
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}

/**
 * A record kept past its retention window (because it still holds an
 * unsynced roll-call event — see loadOfflineManifest) is not the same as a
 * current one: the H-05 stop rule treats an expired copy as not a boarding
 * source. Callers use this to keep showing/reconciling the preserved
 * evidence while refusing to record anything new against it.
 */
export function isOfflineManifestExpired(
  snapshot: Pick<OfflineManifestSnapshot, "expiresAt">,
  now: Date = nowDate(),
): boolean {
  return new Date(snapshot.expiresAt) <= now;
}

/**
 * The real fail-closed authority for offline roll call, independent of the
 * UI. Mirrors `recordRollCall`'s server-side gate exactly (src/db/manifests.ts:
 * `if (input.status === "boarded" && checkpoint === "departure")`): readiness
 * blocks boarding only at the "departure" checkpoint. After any numbered dive,
 * boarding is a pure head count — a diver already aboard is recorded present
 * regardless of a paperwork state that changed after the boat left.
 *
 * A missing `checkpoint` argument used to make this the same check at every
 * checkpoint, always keyed off `snapshot.manifests[0]` (whichever manifest
 * happens to be first, always "departure" per `rollCallCheckpoints`) — so an
 * offline board recorded after dive 1 against a not-ready snapshot was
 * silently refused here even though the UI renders a live "Board" button for
 * exactly that case (`ready || !isDeparture` in OfflineManifestView). See the
 * regression test in offline-manifests.test.ts and offline-manifest-store.test.ts.
 *
 * The **roster** is read from the checkpoint's own manifest for the same
 * reason, and `latestOfflineRollCall` below already did (DOM-L4, review
 * 20260802). Reading `manifests[0]` was survivable only because every snapshot
 * written so far carries one manifest per checkpoint with an identical diver
 * list; the moment one carries a checkpoint the others don't — a diver seated
 * after departure, a snapshot assembled from a narrower window — the two
 * functions would disagree about who is on the boat, and this one would answer
 * for the wrong checkpoint. Answering from the checkpoint asked about is also
 * what makes the unknown-checkpoint case fail *closed*: no manifest means no
 * diver means no boarding, rather than a readiness verdict borrowed from a
 * checkpoint the caller never named.
 */
export function canRecordOfflineStatus(
  snapshot: OfflineManifestSnapshot,
  bookingId: string,
  status: OfflineRollCallEvent["status"],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
): boolean {
  // "Is this booking on this dock copy at all?" is asked across every manifest,
  // and it is asked first. A booking id nothing here has heard of is refused
  // outright: there is no name behind it, so the event would queue a claim
  // about nobody.
  const known = snapshot.manifests.some((manifest) =>
    manifest.divers.some((entry) => entry.bookingId === bookingId),
  );
  if (!known) return false;

  // **A real diver can always be recorded as not aboard**, at any checkpoint,
  // including one this snapshot carries no manifest for. That is not a
  // permissive fallback, it is the whole point: after a numbered dive
  // `not_boarded` means *this person did not come back*, the loudest row the
  // app has, and nothing about a gap in the saved copy's contents makes it less
  // true. Refusing it would silence the alarm and hand the crew the readiness
  // refusal's copy — "this diver isn't ready to board yet" — which is the worst
  // sentence this product could show at that moment (dive-domain-expert review,
  // 2026-08-06). The server re-validates checkpoint, tenant, staff and booking
  // on reconcile, so the worst case is an event it rejects, not a bad write.
  //
  // **A retraction is refused on exactly the same terms — never** (ADR
  // 20260815-offline-can-unsay-a-missing-diver). `cleared` returns a row to
  // awaiting; it puts nobody on a boat and closes no checkpoint, so there is
  // nothing here for it to fail closed *against*. A crew that cannot unsay a
  // mis-tap is a crew that stops tapping the control at all, and the loudest
  // row the product has becomes the one nobody dares raise.
  if (status === "not_boarded" || status === "cleared") return true;

  // Boarding, by contrast, is answered only from the checkpoint's own manifest,
  // and having no manifest for it refuses — fail closed in the direction that
  // puts someone on a boat (DOM-L4).
  const diver = snapshot.manifests
    .find((manifest) => manifest.checkpoint === checkpoint)
    ?.divers.find((entry) => entry.bookingId === bookingId);
  if (!diver) return false;
  if (checkpoint !== "departure") return true;
  return diver.readiness.status === "ready";
}

/**
 * The crew sibling of {@link canRecordOfflineStatus} — a separate function, not
 * a branch inside it. Crew differ from divers in two ways that are easy to get
 * wrong once and never notice:
 *
 * - **No readiness gate at departure.** Crew hold no booking and therefore no
 *   readiness, so there is nothing to check and nothing to refuse. That mirrors
 *   `recordCrewRollCall`, which has no readiness gate either.
 * - **A crew member with no `id` is refused.** A copy saved before H-46 carries
 *   crew with no person id, so there is no subject to write an event against;
 *   that crew member stays uncounted on that copy and the checkpoint stays
 *   open, exactly as it does today. Fail closed, and closed here means the
 *   checkpoint stays *open* — the dangerous direction is a device calling a
 *   head count done while somebody is still in the water.
 *
 * What is identical is the rule that matters most: **`not_boarded` is always
 * recordable**, at any checkpoint, including one this snapshot carries no
 * manifest for. After a numbered dive it means *this person did not come back*
 * — the loudest thing this app can say — and a gap in the saved copy's contents
 * never makes that less true or gives the deck a reason to stay quiet.
 */
export function canRecordOfflineCrewStatus(
  snapshot: OfflineManifestSnapshot,
  crewPersonId: string,
  status: OfflineRollCallEvent["status"],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
): boolean {
  // "Is this person on this dock copy's crew at all?", asked across every
  // manifest and asked first, the same way a booking is. An id nothing here
  // has heard of — including the `undefined` an older snapshot's crew carry —
  // is refused outright rather than queuing a claim about nobody.
  if (!crewPersonId) return false;
  const known = snapshot.manifests.some((manifest) =>
    manifest.crew.some((member) => member.id === crewPersonId),
  );
  if (!known) return false;

  // Same two always-recordable statements the diver path allows, for the same
  // reasons: the alarm, and taking the alarm back.
  if (status === "not_boarded" || status === "cleared") return true;

  // Aboard is answered from the checkpoint's own manifest, and having no
  // manifest for it refuses — the same DOM-L4 rule the diver path follows,
  // minus the readiness question crew do not have.
  return !!snapshot.manifests
    .find((manifest) => manifest.checkpoint === checkpoint)
    ?.crew.some((member) => member.id === crewPersonId);
}

/**
 * The checklist sibling of `canRecordOfflineStatus`/`canRecordOfflineCrewStatus`,
 * and much simpler: there is no checkpoint and no status this snapshot must
 * refuse. `checked` and `cleared` are both always allowed once the item is one
 * this copy has heard of — neither is an alarm and neither is a boarding
 * claim, so there is no direction here that needs to fail closed.
 */
export function canRecordOfflineChecklistCheck(
  snapshot: OfflineManifestSnapshot,
  checklistItemId: string,
): boolean {
  return !!snapshot.checklist?.items.some((item) => item.id === checklistItemId);
}

/**
 * What this device currently shows for one checklist item: its own queued
 * taps first, the snapshot's last known answer behind them — the same
 * precedence `explicitResultAt` gives roll call, minus the checkpoint,
 * carry-forward and rejection-rescue machinery that exists there only to
 * protect the missing-diver alarm (see `pre-departure-check.ts`'s doc
 * comment for why none of that applies here).
 */
export type OfflineChecklistCheckResult = {
  state: "checked";
  occurredAt: string;
  note: string | null;
  pending: boolean;
  /** This device queued the tap itself — see `OfflineRollCallResult.local`. */
  local: boolean;
  clientEventId?: string;
  /**
   * Who recorded it, when this is a *saved* (server-resolved) reading. A
   * locally queued tap carries no name — nothing on this device knows who is
   * holding it — the same omission `OfflineRollCallResult` makes, and the UI
   * renders its own "you" wording for a `local` result instead.
   */
  recordedByName?: string;
};

export function latestOfflineChecklistCheck(
  snapshot: OfflineManifestSnapshot,
  checklistItemId: string,
  queuedEvents: readonly OfflineChecklistEvent[],
): OfflineChecklistCheckResult | undefined {
  const forItem = queuedEvents.filter((event) => event.checklistItemId === checklistItemId);
  const latestLocal = latestPreDepartureCheck(forItem);
  if (latestLocal) {
    return {
      state: "checked",
      occurredAt: latestLocal.occurredAt,
      note: latestLocal.note,
      pending: latestLocal.syncStatus === "pending",
      local: true,
      clientEventId: latestLocal.clientEventId,
    };
  }
  // A queued `cleared` with nothing standing beneath it must not fall through
  // to the snapshot's own stale "checked" — that would hand the mark right
  // back to whoever just tapped it off, the same rule roll call's `cleared`
  // follows.
  if (forItem.some((event) => event.status === "cleared")) return undefined;
  const saved = snapshot.checklist?.items.find((item) => item.id === checklistItemId)?.check;
  return saved ? { ...saved, pending: false, local: false } : undefined;
}

/**
 * The single latest of a subject's queued attempts, newest `occurredAt` first
 * and **ties broken by queue position** — the later-queued event wins.
 *
 * The tie is not exotic. `occurredAt` is millisecond-resolution, so two
 * deliberate taps sharing one is close to unreachable in production; but the
 * e2e fleet freezes the clock so visual baselines stay pixel-stable, which
 * makes every offline event for one subject share a timestamp and the tie the
 * normal case. A stable `.sort()` returning 0 for every pair used to leave the
 * *first-pushed* event at `[0]` — the older tap — so a captain who marked the
 * wrong row and immediately corrected it kept reading the mistake.
 *
 * Later-queued wins because that is what the server already does. `events` is
 * append-only, and `recordRollCall`/`recordCrewRollCall` (src/db/manifests.ts)
 * refuse an offline event only when `newest.occurredAt > occurredAt` — so an
 * equal timestamp is accepted and, read back with
 * `orderBy(desc(occurredAt), desc(createdAt))`, the later-appended row wins.
 * Before this the device and the server broke the same tie in opposite
 * directions, and the screen a captain was holding disagreed with what the
 * server would say about the very same two events once they synced.
 *
 * Shared by both readers rather than written twice, so the two halves of one
 * head count cannot drift apart on the ordering question.
 *
 * `accepts` narrows which attempts are eligible. It exists for exactly one
 * caller — the rejected-attempt rescue in {@link explicitResultAt}, which has
 * to ask "what did this device last say that the server did *not* refuse?" —
 * and it defaults to every attempt, so the ordering rule above is the same one
 * in both passes.
 */
function latestQueuedAttempt(
  events: readonly OfflineRollCallEvent[],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
  matches: (subject: NonNullable<ReturnType<typeof offlineRollCallSubject>>) => boolean,
  accepts: (event: OfflineRollCallEvent) => boolean = () => true,
): OfflineRollCallEvent | undefined {
  let latest: OfflineRollCallEvent | undefined;
  for (const event of events) {
    if (event.checkpoint !== checkpoint) continue;
    // Attributed through the one reader of the subject fields rather than by
    // testing a field directly. A record already in IndexedDB is a cast, not a
    // parse — `appendOfflineRollCall` and the sync route's schema both refuse a
    // both-subjects event on the way in, but neither can vouch for what is
    // already stored. Matching on `bookingId` alone would let one such event be
    // counted by *both* readers: one tap, two people marked, on the one screen
    // that says who came back from a dive.
    const subject = offlineRollCallSubject(event);
    if (!subject || !matches(subject) || !accepts(event)) continue;
    // `>=`, not `>`: reaching an equal timestamp later in append order means
    // this is the newer tap, so it supersedes what is held. Plain string
    // comparison because these are fixed-width `toISOString()` values, where
    // lexicographic order *is* chronological order — no collation involved.
    if (!latest || event.occurredAt >= latest.occurredAt) latest = event;
  }
  return latest;
}

/**
 * One person's result at one checkpoint, as this device reads it: the device's
 * own queued events first, the saved snapshot behind them, and the
 * carried-forward dock default behind that.
 *
 * `occurredAt` is an ISO string rather than a `Date` (this comes off storage),
 * and `pending` says the statement has not reached DiveDay yet — the two
 * fields that make it *not* a {@link RollCallRecord}. Everything that decides
 * meaning is shared with the live manifest: `state` and `implied` go through
 * `rollCallLabel`/`isNotBackAboard`/`rollCallRowState` exactly as a server
 * record does.
 */
export type OfflineRollCallResult = {
  state: "boarded" | "not_boarded";
  occurredAt: string;
  pending: boolean;
  implied: boolean;
  /**
   * This reading comes from an event **this device queued**, rather than from
   * the saved snapshot — i.e. somebody tapped it here.
   *
   * It is what scopes the retraction (ADR 20260815-offline-can-unsay-a-missing-diver,
   * amended after the 2026-08-15 security review). A retraction aimed at a
   * *snapshot* result — a copy up to fourteen days old, which a live write or
   * another device may have superseded since — is a claim about a statement this
   * device never saw made; one aimed at this device's own queued statement undoes
   * the tap the crew member just made, which is the case the control exists for.
   *
   * The **first** of the two guards on that write, and still load-bearing. The
   * second is `clientEventId` below: the server now compares the named event
   * against the newest one standing before applying a retraction (ADR
   * 20260815-an-offline-retraction-names-its-target), which catches the case this
   * flag cannot — a mark this device queued, synced, and retracts an hour later,
   * by which time a second device has changed the row. Belt and braces, not one
   * guard written twice: this one keeps the control honest about *whose*
   * statement it offers to undo, and a snapshot reading has no id to name anyway.
   *
   * A carried-forward value inherits it from the departure result it came from,
   * so undoing a dock no-show is offered exactly where the dock no-show was
   * recorded here.
   */
  local: boolean;
  /**
   * The queued event this reading came from, when it came from one — the id a
   * retraction of it must name (ADR 20260815-an-offline-retraction-names-its-target).
   *
   * Undefined for a snapshot reading, which is not a coincidence but the same
   * fact `local: false` states: a result off the saved copy has no client event
   * id here to name, and the control refuses to aim a retraction at it anyway.
   * A carried-forward value inherits the departure event's id along with
   * `local`, which is inert — `rollCallRowState`'s `recordedNotBoarded` is false
   * for a carried result, so no control offers a retraction there, and the
   * server's compare-and-set would refuse one aimed at a checkpoint the named
   * event was not recorded at.
   */
  clientEventId?: string;
};

/**
 * What one queued event states.
 *
 * A result, or **`null` for a retraction** — "nothing stands here", the same
 * collapse the server does (`listLatestRollCallByBooking` marks the subject
 * seen and leaves it out of the map). `null` rather than `undefined` because
 * the difference is load-bearing one layer up: "this device said to take the
 * mark off" must not fall through to the snapshot's own stale result, which
 * would make the undo a no-op and hand the crew back the mark they just
 * removed, while "this device has said nothing" must.
 *
 * Always explicit: a device records at the checkpoint it is looking at.
 */
function recordedResult(event: OfflineRollCallEvent): OfflineRollCallResult | null {
  if (event.status === "cleared") return null;
  return {
    state: event.status,
    occurredAt: event.occurredAt,
    pending: event.syncStatus === "pending",
    implied: false,
    local: true,
    // Carried so a retraction of this reading can name the statement it undoes.
    // Set here, in the one function both readers build a local result through,
    // for the same reason the tie-break is: the diver and crew halves of one
    // head count must not disagree about which event a row is showing.
    clientEventId: event.clientEventId,
  };
}

/**
 * How loudly a result speaks, for the one comparison that needs an order: a
 * stated "did not come back" outranks any settled result, which outranks
 * nothing at all.
 *
 * Read through `isNotBackAboard`, not through a checkpoint test of its own,
 * which is what confines the rescue below to after a numbered dive without a
 * second rule to keep in sync: at `departure` a `not_boarded` means "never got
 * on the boat", and that is a benign, accounted-for state, so it scores the
 * same as any other settled result there.
 */
function resultStrength(
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
  result: OfflineRollCallResult | undefined,
): number {
  if (!result) return 0;
  return isNotBackAboard(checkpoint, result) ? 2 : 1;
}

/**
 * What was **recorded at this checkpoint** for one subject — the device's own
 * queued statement, else the snapshot's own explicit result. Never a
 * carried-forward value: those are rebuilt from this by the chain below, so a
 * `implied` the snapshot baked in can be *broken* by something this device
 * recorded since.
 *
 * The rejected-attempt rule and its one asymmetry live here (ADR
 * 20260815-a-rejected-correction-may-not-silence-a-missing-diver):
 *
 * - A rejection means the server has authoritative information this device
 *   does not (another device wrote first, the booking became unavailable,
 *   readiness changed), so the *default* is the snapshot — falling through to
 *   an older local event would re-assert exactly the stale optimism
 *   reconciliation exists to overrule (a "boarded" corrected to "not_boarded",
 *   the correction rejected, and the diver still reading Boarded).
 * - But that rule used to be applied symmetrically to two directions that are
 *   not equally dangerous. Crew mark a diver **not back aboard** after dive 1;
 *   they queue a correction to boarded; the server rejects it; the snapshot
 *   holds nothing for that diver at an after-dive checkpoint, so the row read
 *   **awaiting** — demoting the loudest row the product has to a clerical gap,
 *   on the device the crew is holding, at the moment it matters most.
 *
 * So on a rejection: the snapshot stands, **unless** a non-rejected local
 * event states a "not back aboard" that the snapshot does not — the one
 * direction that can only ever raise an alarm the server has not seen. A local
 * `boarded`, or a local retraction, never survives a rejection; it is the
 * optimism the server refused.
 *
 * One rejection carries more information than "the server knows something",
 * and it is spent here rather than thrown away: `retraction_superseded` (ADR
 * 20260815-an-offline-retraction-names-its-target) says precisely *the newest
 * statement at this subject and checkpoint is not the one you named*. Two
 * consequences, both below — the value that would otherwise stand is read down
 * to awaiting unless it is an alarm, and a rescued alarm stops presenting
 * itself as this device's own statement to undo.
 */
function explicitResultAt(
  events: readonly OfflineRollCallEvent[],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
  matches: (subject: NonNullable<ReturnType<typeof offlineRollCallSubject>>) => boolean,
  saved: OfflineRollCallResult | undefined,
): OfflineRollCallResult | null | undefined {
  const latestAttempt = latestQueuedAttempt(events, checkpoint, matches);
  if (!latestAttempt) return saved;
  if (latestAttempt.syncStatus !== "rejected") return recordedResult(latestAttempt);
  const rescued = latestQueuedAttempt(
    events,
    checkpoint,
    matches,
    (event) => event.syncStatus !== "rejected",
  );
  const local = rescued ? recordedResult(rescued) : null;
  // Only the alarm is eligible, which is what keeps this from resurrecting a
  // superseded "boarded" — `resultStrength` alone would rank one above the
  // snapshot's silence.
  //
  // **And only while the snapshot has not already answered it.** A stated
  // "did not come back" outranks a *silence*, never a later sighting: on a
  // two-device boat the second crew member records the diver back aboard on
  // the live manifest, this device's next auto-save brings that home, and a
  // rejection here must not re-raise an alarm two newer server statements
  // have settled (dive-domain review, 2026-08-15). Plain string comparison
  // because both are fixed-width `toISOString()` values, the same reason
  // `latestQueuedAttempt` compares them that way.
  const alarm =
    local && isNotBackAboard(checkpoint, local) && (!saved || local.occurredAt >= saved.occurredAt)
      ? local
      : undefined;
  // A `retraction_superseded` refusal is the one rejection that says something
  // *specific*, and both branches below spend it.
  const superseded =
    latestAttempt.status === "cleared" && latestAttempt.rejectionReason === RETRACTION_SUPERSEDED;
  // `alarm &&` is redundant to the comparison — an absent alarm scores 0 and
  // can never outrank anything — and is written for the type narrowing alone.
  if (alarm && resultStrength(checkpoint, alarm) > resultStrength(checkpoint, saved)) {
    // The alarm stands — but it is no longer *this device's* statement to take
    // back, and the row must stop saying it is. Left `local`, the hint under it
    // keeps reading "tap again to undo" and every tap queues another retraction
    // the server refuses identically: an undo that can never succeed, under copy
    // promising it will (dive-domain review, 2026-08-15). Dropping `local` and
    // the id switches the line to "Recorded on another device or on the live
    // manifest — undo it there, not here", which is exactly what the refusal
    // just told us.
    return superseded ? { ...alarm, local: false, clientEventId: undefined } : alarm;
  }
  // What the refusal means, spelled out: *the server holds a statement newer
  // than anything this device can see*. So the value that would otherwise stand
  // here is known-stale, and this copy has no current answer — which is
  // `awaiting`, and `null` rather than `undefined` because the chain above must
  // not then fall through to the snapshot the retraction was aimed at.
  //
  // **It matters most at `departure`, which is why refusing is not enough on its
  // own.** After a dive, leaving a mark standing holds a count open. At the dock
  // `not_boarded` means *never left* — an accounted-for state that carries
  // forward — so leaving it standing does not hold one count open, it closes
  // every later one: the crew's own dock mark, superseded by a desk that boarded
  // the diver after all, would read "not boarded · carried" after dive 1 and
  // print roll call complete about somebody in the water (dive-domain review,
  // 2026-08-15). Awaiting is the fail-open answer, the same call ADR
  // 20260815-a-rejected-correction-may-not-silence-a-missing-diver made one door
  // along.
  //
  // Never over an alarm, though, whoever recorded it: a stated "did not come
  // back" is the one value where silence *is* the failure, so it outranks this
  // whole rule.
  if (superseded && !isNotBackAboard(checkpoint, saved)) return null;
  return saved;
}

/**
 * The checkpoints this copy's trip has, in departure→last order — the order
 * `carryForwardNotBoarded` requires.
 *
 * Derived from the trip's own planned-dive count rather than from the saved
 * `manifests` array, so it is the identical list the server carried forward
 * over (`getTripManifests`) even if a manifest is missing from the copy.
 */
function offlineCheckpointOrder(
  snapshot: OfflineManifestSnapshot,
): OfflineManifestSnapshot["manifests"][number]["checkpoint"][] {
  const plannedDives = snapshot.manifests[0]?.trip.plannedDives;
  return plannedDives === undefined ? [] : rollCallCheckpoints(plannedDives);
}

/**
 * One subject's effective result at one checkpoint — the whole reading, shared
 * by both readers below so the two halves of one head count cannot answer it
 * differently.
 *
 * The carry-forward step is the device's half of ADR
 * 20260815-roll-call-order-is-a-property-of-the-data: `carryForwardNotBoarded`
 * ran only when the *server* assembled a manifest, so a diver marked not
 * boarded offline **at the dock** read "awaiting" at every later checkpoint on
 * that device, where online they read "not boarded · carried". The trap was
 * the wording, not the count: the only offline control that will take a result
 * for that person after a dive is "Mark not back aboard", which there means
 * *did not return from a dive* — so a crew member tidying the count writes a
 * genuine missing-diver event about somebody in the marina car park, and it
 * does not even close the checkpoint.
 *
 * Explicit results feed the chain and carried ones are recomputed, which is
 * what makes the interaction with the snapshot's own baked-in `implied` values
 * come out right in **both** directions: a dock result this device recorded
 * carries forward even though the snapshot predates it, and an explicit
 * `boarded` this device recorded at the dock *breaks* a chain the server had
 * carried, reopening the later checkpoints rather than leaving them reading
 * "ashore, accounted for" about somebody who is now in the water.
 */
function offlineRollCallAt(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
  matches: (subject: NonNullable<ReturnType<typeof offlineRollCallSubject>>) => boolean,
  savedAt: (
    checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
  ) => OfflineRollCallResult | undefined,
): OfflineRollCallResult | undefined {
  // Only a result recorded *here* feeds the chain: an `implied` value the
  // snapshot carries is the server's own carry-forward, and re-deriving it is
  // the point.
  const explicitAt = (at: OfflineManifestSnapshot["manifests"][number]["checkpoint"]) => {
    const saved = savedAt(at);
    return explicitResultAt(events, at, matches, saved?.implied ? undefined : saved);
  };
  const order = offlineCheckpointOrder(snapshot);
  const index = order.indexOf(checkpoint);
  // A checkpoint this copy's trip does not have (a hand-edited URL, a trip
  // whose dive count shrank since it was saved): answer for it alone. There is
  // no chain to place it in, and inventing one would be guessing.
  if (index < 0) {
    const only = explicitAt(checkpoint);
    return only === null ? undefined : (only ?? savedAt(checkpoint));
  }
  const stated = order.map(explicitAt);
  const carried = carryForwardNotBoarded(stated.map((result) => result ?? undefined));
  const here = carried[index];
  if (here) return here;
  // Nothing carries, so this checkpoint is awaiting — as long as somebody has
  // *said* so. Three ways to get here, and only the last one may read the
  // snapshot:
  //
  // - this device retracted here (`null`): the undo stands, and a fallback
  //   would hand the mark straight back;
  // - the dock's own result is known and does not carry (this device recorded
  //   the diver aboard after all, breaking a chain the server had carried);
  // - nothing explicit exists anywhere on this copy, in which case whatever
  //   the snapshot holds here is the only statement there is — including a
  //   carried `implied` value from a departure manifest this copy is missing.
  if (stated[index] === null || stated[0] === null) return undefined;
  return carried[0] === undefined ? savedAt(checkpoint) : undefined;
}

/** The saved result a snapshot holds for one subject at one checkpoint, or nothing. */
function savedResult(
  saved: { state: "boarded" | "not_boarded"; occurredAt: string; implied?: boolean } | undefined,
): OfflineRollCallResult | undefined {
  return saved
    ? {
        state: saved.state,
        occurredAt: saved.occurredAt,
        pending: false,
        implied: saved.implied ?? false,
        local: false,
      }
    : undefined;
}

export function latestOfflineRollCall(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  bookingId: string,
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
): OfflineRollCallResult | undefined {
  return offlineRollCallAt(
    snapshot,
    events,
    checkpoint,
    (subject) => subject.kind === "diver" && subject.bookingId === bookingId,
    (at) =>
      savedResult(
        snapshot.manifests
          .find((manifest) => manifest.checkpoint === at)
          ?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall,
      ),
  );
}

/**
 * The crew sibling of {@link latestOfflineRollCall}. Still a separate exported
 * function — the subject spaces must not leak into one another — but every
 * rule below the surface is now literally the same code: the tie-break, the
 * rejected-attempt asymmetry, the retraction, and the dock carry-forward.
 *
 * `crewPersonId` is required, so a crew member an older snapshot carries with
 * no id never reaches this: the caller reads that member's saved result
 * directly, which is all a pre-H-46 copy has. Both routes agree that *absence*
 * is awaiting, never accounted for.
 */
export function latestOfflineCrewRollCall(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  crewPersonId: string,
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
): OfflineRollCallResult | undefined {
  return offlineRollCallAt(
    snapshot,
    events,
    checkpoint,
    (subject) => subject.kind === "crew" && subject.crewPersonId === crewPersonId,
    (at) =>
      savedResult(
        snapshot.manifests
          .find((manifest) => manifest.checkpoint === at)
          ?.crew.find((member) => member.id === crewPersonId)?.rollCall,
      ),
  );
}
