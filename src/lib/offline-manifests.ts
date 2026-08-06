import { nowDate } from "./clock";
import type { TripManifest } from "./manifests";
import type { ReadinessBlocker, ReadinessBlockerCode } from "./readiness";

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

export const OFFLINE_MANIFEST_CURRENT_MS = 15 * 60 * 1000;
export const OFFLINE_MANIFEST_AGING_MS = 4 * 60 * 60 * 1000;
export const OFFLINE_MANIFEST_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Unchanged at seven days post-trip (owner decision 2026-07-26, H-05): there's
// no manual delete button (ADR 20260726), so this lazy-on-read expiry is the
// only way a device copy goes away once it's no longer needed.
export const OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineManifestFreshness = "current" | "aging" | "stale";

export type OfflineManifestPayload = {
  shop: { slug: string; name: string; timezone: string };
  manifests: Array<
    Omit<TripManifest, "trip" | "divers" | "crew" | "completeness"> & {
      trip: Omit<TripManifest["trip"], "startsAt" | "endsAt"> & {
        startsAt: string;
        endsAt: string;
      };
      /**
       * Names, roles, and each crew member's saved result — **no person ids**.
       * The live manifest carries ids because they are the subject of a crew
       * roll-call write (ADR 20260803-per-person-crew-roll-call); the dock copy
       * cannot record one, so it needs only what it shows.
       *
       * `rollCall` absent means nobody had said, and that is what makes this
       * fail closed: an older snapshot carries no crew results at all, so every
       * crew member on it reads as awaiting and the checkpoint stays open here
       * exactly as it does online. Never the reverse.
       */
      crew: Array<
        Pick<TripManifest["crew"][number], "fullName" | "roles"> & {
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
            note: string | null;
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
        > & {
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
            note: string | null;
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

export type OfflineRollCallEvent = {
  clientEventId: string;
  snapshotId: string;
  snapshotSavedAt: string;
  tripId: string;
  bookingId: string;
  checkpoint: TripManifest["checkpoint"];
  status: "boarded" | "not_boarded";
  note: string | null;
  occurredAt: string;
  syncStatus: "pending" | "applied" | "rejected";
  rejectionReason?: string;
};

export type OfflineManifestEnvelope = {
  snapshot: OfflineManifestSnapshot;
  events: OfflineRollCallEvent[];
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
): OfflineManifestPayload {
  return {
    shop,
    manifests: manifests.map(({ completeness: _completeness, ...manifest }) => ({
      ...manifest,
      trip: {
        ...manifest.trip,
        startsAt: manifest.trip.startsAt.toISOString(),
        endsAt: manifest.trip.endsAt.toISOString(),
      },
      crew: manifest.crew.map((member) => ({
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
              note: member.rollCall.note,
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
              note: diver.rollCall.note,
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
  if (status === "not_boarded") return true;

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

export function latestOfflineRollCall(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  bookingId: string,
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
):
  | { state: "boarded" | "not_boarded"; occurredAt: string; pending: boolean; implied: boolean }
  | undefined {
  // The single latest attempt for this booking+checkpoint, across every sync
  // status — not "the latest non-rejected one." A rejection means the server
  // has authoritative information this device doesn't (another device's write
  // landed first, the booking became unavailable, readiness changed): falling
  // through to an *older*, superseded local event on rejection would silently
  // re-assert exactly the stale optimism reconciliation exists to overrule —
  // e.g. a correction from "boarded" to "not_boarded" gets rejected, and the
  // diver keeps reading "Boarded" on the captain's screen. See the regression
  // test in offline-manifests.test.ts.
  const latestAttempt = events
    .filter((event) => event.bookingId === bookingId && event.checkpoint === checkpoint)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (latestAttempt && latestAttempt.syncStatus !== "rejected") {
    // A result recorded on this device at this checkpoint is always explicit.
    return {
      state: latestAttempt.status,
      occurredAt: latestAttempt.occurredAt,
      pending: latestAttempt.syncStatus === "pending",
      implied: false,
    };
  }
  const server = snapshot.manifests
    .find((manifest) => manifest.checkpoint === checkpoint)
    ?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall;
  return server
    ? {
        state: server.state,
        occurredAt: server.occurredAt,
        pending: false,
        implied: server.implied ?? false,
      }
    : undefined;
}
