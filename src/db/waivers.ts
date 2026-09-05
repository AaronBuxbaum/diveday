import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { flaggedMedicalPrompts, validateMedicalAnswers } from "@/lib/medical";
import { operationalWindow } from "@/lib/operational-window";
import { personNamesMatch } from "@/lib/person-name";
import { openSecret, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { inPersonAttestationProvider, localTypedConsentProvider } from "@/lib/signatures";
import { isUuid } from "@/lib/uuid";
import { computeWaiverIntegrityHash, verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import {
  DEFAULT_WAIVER_TITLE,
  isCompletedWaiverCurrent,
  isUnresolvedMedicalHold,
  needsMedicalReview,
  WAIVER_LINK_TTL_MS,
  WAIVER_SIGNATURE_VALIDITY_MS,
} from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import type { MedicalAnswers } from "./schema";
import {
  bookings,
  notificationDeliveries,
  people,
  shops,
  trips,
  waiverDeliveries,
  type waiverDeliveryChannel,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { liveTrip } from "./trips-live";

/** The three ways a shop hands a link over — the schema enum, named for callers. */
export type WaiverDeliveryChannel = (typeof waiverDeliveryChannel.enumValues)[number];

export type SaveWaiverTemplateInput = {
  shopId: string;
  /**
   * Omitted by the editor, which is the only surface that saves one. The title
   * is immutable in the UI — there is no field for it — so a save cannot mean
   * "rename", and the current version's title carries forward. Passing the
   * platform default instead renamed a shop's own release ("Blue Mantis Diving
   * Release" → "Diving Release & Liability Waiver") on the first edit, silently,
   * for as long as the editor has existed.
   */
  title?: string;
  body: string;
  /** Explicit human answer for an edit that may affect existing signatures. */
  material?: boolean;
  /** Staff member who made the materiality assertion. Required by the UI path. */
  actorPersonId?: string;
};

/**
 * A shop has exactly one waiver, kept as an append-only chain of versions. The
 * most recent version is what a newly issued link snapshots.
 */
export async function getCurrentWaiverTemplate(db: DbExecutor, shopId: string) {
  const [template] = await db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.deletedAt)))
    .orderBy(desc(waiverTemplates.createdAt))
    .limit(1);
  return template ?? null;
}

/** The full version history, newest first, for a read-only audit trail. */
export async function listWaiverTemplateHistory(db: DbExecutor, shopId: string) {
  return db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.deletedAt)))
    .orderBy(desc(waiverTemplates.version));
}

/** How many audit rows the Signatures tab shows per page. */
export const WAIVER_INTEGRITY_PAGE_SIZE = PAGE_SIZE.list;

/** The join shape both `listWaiverIntegrityAudit` and `getSignedWaiverRecordForShop` select. */
type WaiverAuditJoinRow = {
  record: typeof waiverRecords.$inferSelect;
  personName: string;
  tripId: string | null;
  tripTitle: string | null;
  tripStartsAt: Date | null;
};

/**
 * Shared row shaping for the signature log: never the bearer token, never
 * the raw medical questionnaire — a medical hold surfaces only as
 * `flaggedPrompts`, the "answered yes" prompts a reviewer must check, the
 * same summary `flaggedMedicalPrompts` already gives the trip roster
 * (`RosterSection.tsx`).
 */
function toSignedWaiverEntry(row: WaiverAuditJoinRow) {
  return {
    id: row.record.id,
    personId: row.record.personId,
    personName: row.personName,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    status: row.record.status,
    signedAt: row.record.signedAt,
    /**
     * Which release this signature was given against — the fact that decides
     * whether it still counts (`isCompletedWaiverCurrent`), and the one thing
     * a reviewer reading the log back cannot infer from anything else on the
     * row. Already on `row.record`, so it costs no column and no join.
     */
    templateVersion: row.record.templateVersion,
    integrity: verifyWaiverIntegrity(row.record),
    flaggedPrompts:
      row.record.status === "medical_review" && row.record.medicalAnswers
        ? flaggedMedicalPrompts(row.record.medicalAnswers)
        : [],
  };
}

export type SignedWaiverEntry = ReturnType<typeof toSignedWaiverEntry>;

export type WaiverIntegrityAuditPage = {
  entries: SignedWaiverEntry[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * Signed evidence audit — the signature log's data (`/shop/[shopSlug]/waivers`)
 * and its integrity check. Every row is shop-scoped by `shopId` (never trust a
 * route param for this — see the query's `where`), joins the trip the record
 * was issued against (null only for an imported record, which carries no
 * booking), and intentionally excludes bearer tokens and the raw medical
 * questionnaire (see `toSignedWaiverEntry`). One page at a time (ordered by
 * signature, then id for a stable tiebreak) so a shop with years of signed
 * waivers costs one page, not the whole table.
 *
 * Offset-paged, like the roster and the orders index. It was a forward-only
 * keyset cursor, which meant a staffer auditing deep history had "Show more"
 * and "Back to top" and nothing in between — no way back one page, and no way
 * to see how much evidence was left (ADR 20260803-one-pagination-model). This
 * is an audit trail, so "page 4 of 31" is not a nicety: it is how a reviewer
 * knows what they have and have not walked.
 *
 * The count carries the same `innerJoin people` the page does, so the two can
 * never disagree about how many rows exist.
 */
export async function listWaiverIntegrityAudit(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; limit?: number } = {},
): Promise<WaiverIntegrityAuditPage> {
  const scope = and(
    eq(waiverRecords.shopId, shopId),
    inArray(waiverRecords.status, ["completed", "medical_review"]),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? WAIVER_INTEGRITY_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(waiverRecords)
        .innerJoin(people, eq(people.id, waiverRecords.personId))
        .where(scope);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          record: waiverRecords,
          personName: people.fullName,
          tripId: trips.id,
          tripTitle: trips.title,
          tripStartsAt: trips.startsAt,
        })
        .from(waiverRecords)
        .innerJoin(people, eq(people.id, waiverRecords.personId))
        .leftJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
        .leftJoin(trips, eq(trips.id, bookings.tripId))
        .where(scope)
        .orderBy(desc(waiverRecords.signedAt), desc(waiverRecords.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    entries: paged.rows.map(toSignedWaiverEntry),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * One signed record, by id, for the Signatures tab's "jump to a record"
 * entry point — the trip roster's "View signed record" link
 * (`RosterSection.tsx`), which a shop with a lot of signed history can
 * easily point past `listWaiverIntegrityAudit`'s current page. Shop-scoped
 * exactly like the audit: `shopId` gates the row, never a route param, so a
 * copied or guessed record id from another shop resolves to nothing rather
 * than that shop's medical-adjacent record.
 */
export async function getSignedWaiverRecordForShop(
  db: DbExecutor,
  shopId: string,
  recordId: string,
) {
  const [row] = await db
    .select({
      record: waiverRecords,
      personName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(waiverRecords)
    .innerJoin(people, eq(people.id, waiverRecords.personId))
    .leftJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(waiverRecords.id, recordId),
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    )
    .limit(1);
  return row ? toSignedWaiverEntry(row) : null;
}

export type SaveWaiverTemplateResult = {
  template: typeof waiverTemplates.$inferSelect;
  /**
   * False when the submitted text was character-for-character the current
   * version and nothing was written. Callers report it differently — "saved"
   * against an unchanged release is a lie with consequences (issue #720).
   */
  versioned: boolean;
};

/**
 * Saves an edit as the next version. Versions increment per shop — history reads
 * v1 → v2 → v3 — and the most recent version is always what new links snapshot.
 * The previous version stays intact so a record already signed against it is never rewritten.
 *
 * **An unchanged body is not a new version.** Publishing one is not a quiet
 * write: `isCompletedWaiverCurrent` reads a signature against an older version
 * as no longer current, so a fresh version invalidates every signature the shop
 * holds at once — every booked diver on every forward departure flips to
 * blocked, and the sign-once carry-across that covers a shop's regulars is
 * neutralised in the same instant. A staffer who opens the editor to *read* the
 * release and presses Save on the way out had done all of that, and been told
 * "Saved" (issue #720). So an identical body saves nothing and says so.
 *
 * The comparison is exact, on the trimmed text, and deliberately dumb. Whether
 * a *real* edit is material enough to require re-signing is a legal question
 * (H-01/H-03), and DiveDay must never infer materiality from a diff — this only
 * recognises the case where there is no diff at all.
 */
export async function saveWaiverTemplate(
  db: AppDb,
  input: SaveWaiverTemplateInput,
): Promise<SaveWaiverTemplateResult> {
  return db.transaction(async (tx) => {
    // Locks the shop row before computing the next version — under READ
    // COMMITTED, two concurrent saves could otherwise both read the same max
    // version and both insert, colliding or creating an ambiguous legal
    // ordering (CR-015). Locking the shop row (rather than the existing
    // waiver_templates rows) also correctly serializes a shop's very first
    // template, when a row lock on the target table would have nothing yet
    // to hold. The unit suite runs on PGlite, which is single-connection and
    // cannot exhibit the race; the real-Postgres CI job is where a lock like
    // this one is provable (see `src/db/bookings.postgres.test.ts` for the
    // pattern — this particular lock does not yet have its own such test).
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shopId)).for("update");
    // The whole current row, not just the version numbers: the body is needed
    // for the comparison below, and the highest version is the current one.
    const [current] = await tx
      .select()
      .from(waiverTemplates)
      // `version`, not `createdAt` — that is transaction time, the same trap
      // `roll_call_events.seq` exists for. And live rows only: comparing a
      // staffer's text against a *deleted* body would silently refuse a real
      // edit while the release actually in force is different
      // (`dive-domain-expert`).
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.deletedAt)))
      .orderBy(desc(waiverTemplates.version))
      .limit(1);
    const title = (input.title?.normalize("NFC").trim() || current?.title) ?? DEFAULT_WAIVER_TITLE;
    // Newlines normalised, not just trimmed. A browser submits a `<textarea>`
    // with CRLF line breaks whatever it was rendered with (the HTML form
    // payload spec), so a release stored with LF comes back with a `\r` on
    // every line and compares unequal to itself — the no-op check below would
    // never once fire in a real browser while passing every unit test, and the
    // stored text would gain a `\r` per line on each save. Normalising on the
    // way in keeps one spelling in the column.
    // Newlines *and* Unicode form. A browser submits a `<textarea>` with CRLF
    // whatever it was rendered with, so a release stored with LF comes back
    // with a `\r` on every line — the no-op check below would never once fire
    // in a real browser while passing every unit test.
    //
    // NFC for the same class of invisible difference: text pasted back from
    // Word, Pages or an email can arrive decomposed, so `exención` is
    // byte-unequal to the identical-looking stored string. A Spanish shop is
    // the likeliest victim, and the cost is an edit nobody made invalidating
    // every signature the shop holds (`dive-domain-expert`, after #720
    // shipped). Safe in a way semantic diffing is not: NFC is *canonical
    // equivalence*, so the rendered legal text is the same document — this is
    // not inferring materiality from a diff.
    const body = input.body.replace(/\r\n?/g, "\n").normalize("NFC").trim();
    if (current && current.title === title && current.body === body) {
      return { template: current, versioned: false };
    }
    const material = input.material ?? true;
    const nextVersion = (current?.version ?? 0) + 1;
    const materialGeneration = current ? current.materialGeneration + (material ? 1 : 0) : 1;
    const [template] = await tx
      .insert(waiverTemplates)
      .values({
        shopId: input.shopId,
        title,
        body,
        version: nextVersion,
        materialGeneration,
      })
      .returning();
    if (!template) throw new Error("saveWaiverTemplate: insert returned no row");
    if (input.actorPersonId) {
      const [actor] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
        .limit(1);
      if (!actor) throw new Error("waiver materiality actor is not a person of this shop");
      await tx.insert(waiverMaterialityDecisions).values({
        shopId: input.shopId,
        templateId: template.id,
        material,
        actorPersonId: input.actorPersonId,
      });
    }
    return { template, versioned: true };
  });
}

/**
 * Who publishing a new version would put back in the queue, and how many of
 * them board soon — the sentence a staffer needs *before* they tap Save, and
 * the count reported after.
 *
 * **Divers, not records.** This counted `waiver_records` rows and both strings
 * called them divers, which is not the same number: one diver can hold several
 * standing records on the current version, because `issueWaiverRequest`'s
 * `alreadyStanding` check for a booking subject only inspects records on *that
 * booking*, so a staff "Send waiver" on a second seat mints a second link for
 * someone who already signed. It also counted records belonging to people the
 * shop has deleted or erased — `anonymizeDiver` leaves the completed record
 * standing — i.e. people who will never sign anything again. Counting distinct
 * live `people` makes the noun true (issue #790).
 *
 * **And the operational half, which is the half that changes a decision.** A
 * three-season shop read "the release that 812 divers have signed": accurate,
 * alarming, and useless. A shop that must publish a legally revised release
 * will publish it regardless; what they need is which boat it lands on this
 * afternoon. `boardingSoon` is those divers with an active booking inside the
 * same `operationalWindow` the readiness side already uses, so the two halves
 * of the app answer "soon" the same way — and so every diver the sentence
 * counts is one the notice's "Send them by departure" link can reach.
 *
 * **Bookings only, and crew are outside it on purpose.** A divemaster reaches a
 * departure through `trip_crew`, never a booking, so they can never appear in
 * `boardingSoon` — and that is the answer, not an accident of which table got
 * joined. The release is the agreement between a shop and someone paying to be
 * taken diving; what stands behind staff in the water is the employment
 * relationship and the professional liability their agency or the shop carries.
 * A release signed by an employee does not create employer coverage, and asking
 * for one blurs which relationship is which. So DiveDay neither counts crew here
 * nor chases them for a signature (issue #842, settled 2026-08-27; the glossary's
 * "waiver / release" entry carries the reasoning, and a shop whose counsel wants
 * otherwise still has the paper/in-person path).
 *
 * **A divemaster who *is* also a diver on a departure is counted**, because then
 * they hold a booking like anyone else — the rule is about the seat, not the job.
 *
 * Walk-ups and wait-list divers are outside it for a different, structural
 * reason and need no decision — they have no booking yet, and counter check-in
 * evaluates readiness live.
 *
 * Mirrors the conditions in `isCompletedWaiverCurrent` (`src/lib/waivers.ts`)
 * that a version bump is what breaks, and only those:
 *
 * - **`completed`, not superseded** — a record parked in medical review or
 *   already replaced is not standing evidence, so a bump costs it nothing.
 * - **Not `imported`** — that record is exempt from the version check
 *   altogether (ADR 20260724-import-waiver-acceptance), so it survives a bump.
 * - **On the current version** — one already against an older version is
 *   already not current.
 * - **Still inside the validity window** — a signature that has aged out was
 *   not going to clear anyone tomorrow either. Counting it would overstate the
 *   damage, and a number a shop can disprove is a number they stop reading.
 *
 * The `now` parameter is the clock rule (`src/lib/clock.ts`), so the e2e fleet's
 * frozen instant reaches this count like every other read.
 */
export type StandingWaiverExposure = {
  /** Distinct live divers whose current signature a version bump would void. */
  divers: number;
  /** How many of those divers board inside the operational window. */
  boardingSoon: number;
};

export async function standingWaiverExposure(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<StandingWaiverExposure> {
  const [current] = await db
    .select({
      version: waiverTemplates.version,
      materialGeneration: waiverTemplates.materialGeneration,
    })
    .from(waiverTemplates)
    // Same reader shape as `saveWaiverTemplate` above, and for the same reason:
    // a count against a version readiness does not consider current is a
    // number nobody can act on.
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.deletedAt)))
    .orderBy(desc(waiverTemplates.version))
    .limit(1);
  if (!current) return { divers: 0, boardingSoon: 0 };
  const signedAfter = new Date(now.getTime() - WAIVER_SIGNATURE_VALIDITY_MS);
  const window = operationalWindow(now);
  const [row] = await db
    .select({
      // `count(distinct person_id)`, so a diver holding two standing records is
      // one diver. Drizzle's `countDistinct` over the joined column.
      divers: countDistinct(waiverRecords.personId),
      // The same set, narrowed to those with an active booking on a live
      // departure inside the horizon. `filter (where …)` rather than a second
      // query: one scan, and the two numbers cannot disagree about which
      // records they counted.
      // Keyed on `trips.id`, not `bookings.id`: the booking join matches any
      // non-cancelled seat the diver holds, on any departure ever, so filtering
      // on it counted every booked diver and the second sentence read "127 of
      // them board in the next 7 days" beside "127 divers have signed". It is
      // the *trip* join that carries the window.
      boardingSoon: sql<number>`count(distinct ${waiverRecords.personId}) filter (where ${trips.id} is not null)::int`,
    })
    .from(waiverRecords)
    // **Erased, not deleted.** An erased person genuinely will never sign
    // anything again, so their standing record is not exposure — and
    // `anonymizeDiver` stamps `deleted_at` too, so this one predicate covers
    // them.
    //
    // A *deleted* diver is a different matter and must stay counted:
    // `deleteDiver` says in as many words that it is "removal from the active
    // lists, not erasure", and leaves the bookings live. `getTripRoster` and
    // `listTripsWaiverStatuses` both honour that — so a soft-deleted diver
    // holding a live seat is on the manifest, is in the readiness queue, and
    // does owe a fresh signature. Dropping them here would make this number
    // *smaller than the boat*, which is the one direction it must never err
    // (`dive-domain-expert`, on issue #790). A shop merging a duplicate diver
    // mid-season is the ordinary way that happens.
    .innerJoin(people, and(eq(people.id, waiverRecords.personId), isNull(people.anonymizedAt)))
    .leftJoin(
      bookings,
      and(eq(bookings.personId, waiverRecords.personId), ne(bookings.status, "cancelled")),
    )
    .leftJoin(
      trips,
      and(
        eq(trips.id, bookings.tripId),
        // Re-proved here rather than rested on the person being shop-scoped
        // (CR-007), the way every other reader in `src/db` does it.
        eq(trips.shopId, shopId),
        liveTrip(),
        // `liveTrip()` is only `deleted_at is null`. A blow-out sets
        // `status = 'cancelled'` and leaves the bookings alone until staff
        // work the cascade per seat, so without this a called-off Saturday
        // still counts a boatload of divers as boarding — the same filter
        // `src/db/today.ts` carries, and for the same reason.
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, window.from),
        lte(trips.startsAt, window.to),
      ),
    )
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.status, "completed"),
        isNull(waiverRecords.supersededAt),
        // `or(isNull, ne)`, not a bare `ne`: in SQL `x <> 'imported'` is NULL for
        // a NULL column and the row silently drops out, while the JS predicate
        // this mirrors (`isCompletedWaiverCurrent`) treats the same record as
        // *not* imported and does apply the version check. These two exist to
        // agree; a bare `ne` is where they stop.
        or(isNull(waiverRecords.signatureMethod), ne(waiverRecords.signatureMethod, "imported")),
        eq(waiverRecords.templateGeneration, current.materialGeneration),
        // `signedAt ?? completedAt`, the same fallback `isCompletedWaiverCurrent`
        // applies, resolved in SQL so this stays one counting query.
        gt(sql`coalesce(${waiverRecords.signedAt}, ${waiverRecords.completedAt})`, signedAfter),
      ),
    );
  return { divers: row?.divers ?? 0, boardingSoon: row?.boardingSoon ?? 0 };
}

export type IssueWaiverOutcome =
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      recordId: string;
      /**
       * True when this handed back the link the diver already had rather than
       * minting one. Callers do not branch on it — a reused link and a fresh
       * one are the same URL to send — but it is what a test asserts, and what
       * tells you at a glance whether the deployment has a sealing key.
       */
      reused: boolean;
    }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "person_not_found"
        | "template_not_found"
        | "already_completed";
    };

/**
 * Issue the diver's waiver link — **the same one they already have**, whenever
 * they still have one that works.
 *
 * A shop reaches for this several times in one conversation: copy the link,
 * paste it into their own WhatsApp, then tap "Text waiver" to be sure. Every
 * one of those used to mint a fresh token and supersede the last, so the URL
 * just pasted was dead, and a diver part-way through signing online lost the
 * draft with it. So a live pending link is reused and its clock refreshed
 * (ADR 20260820-waiver-links-are-reused-not-reissued).
 *
 * "Live" is narrow, and each condition is load-bearing:
 *
 * - **Pending and not superseded.** A completed record has nothing to hand out.
 * - **Not expired.** The TTL stays a real bound; a link that already died is
 *   not resurrected, because reviving a months-old URL is exactly what a leak
 *   would want. A fresh one is minted instead.
 * - **Snapshotted from the template that is current now.** A shop that edited
 *   its release since has different terms, and letting the old link stand would
 *   collect a signature against wording the shop has withdrawn.
 * - **Openable.** Without `SECRET_ENCRYPTION_KEY` there is no readable copy of
 *   the token, so this falls back to minting — the behaviour it had before.
 *
 * When none of that holds it does what it always did: mint, supersede whatever
 * was pending, and insert. So an old token still cannot complete later; it just
 * stops being the *usual* outcome of asking twice.
 */
export async function issueWaiverRequest(
  db: AppDb,
  input: { shopId: string; bookingId?: string; personId?: string; now?: Date },
): Promise<IssueWaiverOutcome> {
  if (!input.bookingId && !input.personId) return { ok: false, reason: "person_not_found" };
  const now = input.now ?? nowDate();
  const token = createWaiverToken();
  const tokenHash = hashWaiverToken(token);
  const expiresAt = new Date(now.getTime() + WAIVER_LINK_TTL_MS);
  const keyResult = secretKeyFromEnvironment();
  const sealingKey = keyResult.status === "ok" ? keyResult.key : null;

  return db.transaction(async (tx): Promise<IssueWaiverOutcome> => {
    const booking = input.bookingId
      ? await tx
          .select({ id: bookings.id, personId: bookings.personId, tripStatus: trips.status })
          .from(bookings)
          .innerJoin(trips, eq(trips.id, bookings.tripId))
          .where(
            and(
              eq(bookings.id, input.bookingId),
              eq(bookings.shopId, input.shopId),
              ne(bookings.status, "cancelled"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    if (input.bookingId && !booking) return { ok: false, reason: "booking_not_found" };
    if (booking && booking.tripStatus !== "scheduled") {
      return { ok: false, reason: "booking_unavailable" };
    }
    const personId = booking?.personId ?? input.personId;
    if (!personId) return { ok: false, reason: "person_not_found" };
    if (!booking) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(eq(people.id, personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
        )
        .limit(1);
      if (!person) return { ok: false, reason: "person_not_found" };
    }

    const [template] = await tx
      .select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.deletedAt)))
      .orderBy(desc(waiverTemplates.createdAt))
      .limit(1);
    if (!template) return { ok: false, reason: "template_not_found" };

    const current = await tx
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          booking
            ? eq(waiverRecords.bookingId, booking.id)
            : and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)),
          isNull(waiverRecords.supersededAt),
        ),
      );
    const alreadyStanding = booking
      ? current.some((record) => record.status !== "pending")
      : current.some(
          (record) =>
            isUnresolvedMedicalHold(record) ||
            isCompletedWaiverCurrent(record, template.materialGeneration, now),
        );
    if (alreadyStanding) {
      return { ok: false, reason: "already_completed" };
    }

    // The link this diver already holds, if it is still one they can sign.
    const live = sealingKey
      ? current.find(
          (record) =>
            record.status === "pending" &&
            record.supersededAt === null &&
            record.expiresAt > now &&
            record.templateId === template.id &&
            record.templateVersion === template.version &&
            record.templateGeneration === template.materialGeneration &&
            record.tokenSealed,
        )
      : undefined;
    const reusedToken =
      live?.tokenSealed && sealingKey ? openSecret(live.tokenSealed, sealingKey) : null;
    if (live && reusedToken) {
      // Same record, same URL, fresh clock: whoever was just handed this link
      // gets the full window to sign, and the copy already pasted somewhere
      // keeps working. Nothing is superseded, so a half-filled draft on this
      // record survives being sent again.
      const refreshedExpiry = new Date(now.getTime() + WAIVER_LINK_TTL_MS);
      await tx
        .update(waiverRecords)
        .set({ expiresAt: refreshedExpiry })
        .where(eq(waiverRecords.id, live.id));
      return {
        ok: true,
        token: reusedToken,
        expiresAt: refreshedExpiry,
        recordId: live.id,
        reused: true,
      };
    }

    if (current.length > 0) {
      await tx
        .update(waiverRecords)
        // The old link is dead, so its openable copy has no reason to exist.
        .set({ supersededAt: now, tokenSealed: null })
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            booking
              ? eq(waiverRecords.bookingId, booking.id)
              : and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)),
            isNull(waiverRecords.supersededAt),
          ),
        );
    }

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: booking?.id ?? null,
        personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        tokenHash,
        tokenSealed: sealingKey ? sealSecret(token, sealingKey) : null,
        expiresAt,
      })
      .returning();
    if (!record) throw new Error("issueWaiverRequest: insert returned no row");
    return { ok: true, token, expiresAt, recordId: record.id, reused: false };
  });
}

export type TokenWaiverState =
  | { state: "unavailable" }
  // Carries the record (a real, once-valid link) so the page can still
  // identify the shop and its contact channels, and the record's own
  // `expiresAt` — a diver reading a dead link still deserves a name and a
  // way to reach someone, not a wall with nothing to click.
  | { state: "expired"; record: typeof waiverRecords.$inferSelect }
  | { state: "available"; record: typeof waiverRecords.$inferSelect }
  | { state: "completed"; record: typeof waiverRecords.$inferSelect };

/**
 * `bookingId` is nullable for imported, paper, and independent digital waivers.
 * A bearer token only needs the record's shop and person, so token pages handle
 * both booking-scoped and person-scoped releases.
 */
async function currentRecordForToken(db: AppDb, token: string) {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(
      and(eq(waiverRecords.tokenHash, hashWaiverToken(token)), isNull(waiverRecords.supersededAt)),
    )
    .limit(1);
  return record ?? null;
}

/** A bearer token reveals only its own record and is rejected on expiry/supersession. */
export async function getWaiverForToken(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<TokenWaiverState> {
  const record = await currentRecordForToken(db, token);
  if (!record) return { state: "unavailable" };
  if (record.status !== "pending") return { state: "completed", record };
  if (record.expiresAt <= now) return { state: "expired", record };
  return { state: "available", record };
}

/**
 * The record behind a token that can no longer be signed but is still, provably,
 * the diver's own: pending and either past its expiry or superseded by a fresher
 * link. `getWaiverForToken` reports the first as `expired` and the second as
 * `unavailable`, and issuing a replacement supersedes the very record that asked
 * for it — so this is what keeps the same stale URL landing on the self-serve
 * "email me a fresh link" card on the second tap and every refresh after,
 * instead of a dead end that looks like the tap broke something.
 *
 * Deliberately narrow: never a live record and never a completed one, so this
 * can't become a second way to reach a signable link or to read signed evidence.
 * It returns the record for context only — the rescue flow issues its own fresh
 * token and hands it to the address on file, never back to the caller.
 */
export async function staleWaiverRecordForToken(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<typeof waiverRecords.$inferSelect | null> {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(eq(waiverRecords.tokenHash, hashWaiverToken(token)))
    .limit(1);
  if (record?.status !== "pending") return null;
  if (!record.supersededAt && record.expiresAt > now) return null;
  return record;
}

/**
 * Does this booking already have a waiver link a diver could sign *right now*?
 *
 * The rescue flow's guard rail. Issuing supersedes every non-superseded record
 * for the booking, and a superseded record takes the diver's saved draft
 * (`draftMedicalAnswers`, emergency contact answers, half-filled medical
 * questionnaire) out of reach with it. So a stale token whose booking has since
 * been given a *fresher, still-live* link must never trigger another issue: the
 * bearer of the dead URL would be silently killing the link the diver is
 * actually working in, and wiping what they had typed.
 *
 * Deliberately a bare boolean — the caller learns only that a live link exists,
 * never its token, its address, or when it was issued.
 */
export async function hasLiveWaiverRequest(
  db: DbExecutor,
  bookingId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const [live] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.bookingId, bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
        gt(waiverRecords.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(live);
}

/** The schedule-free counterpart used when a waiver belongs to the person. */
export async function hasLivePersonWaiverRequest(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const [live] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        isNull(waiverRecords.bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
        gt(waiverRecords.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(live);
}

export async function saveWaiverDraft(
  db: AppDb,
  token: string,
  input: { signerName?: string; acknowledged: boolean; medicalAnswers: MedicalAnswers; now?: Date },
): Promise<boolean> {
  const state = await getWaiverForToken(db, token, input.now);
  if (state.state !== "available") return false;
  const now = input.now ?? nowDate();
  const [saved] = await db
    .update(waiverRecords)
    .set({
      startedAt: state.record.startedAt ?? now,
      draftSignerName: input.signerName?.trim() || null,
      draftAcknowledged: input.acknowledged,
      draftMedicalAnswers: input.medicalAnswers,
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id });
  return Boolean(saved);
}

export type CompleteWaiverOutcome =
  | { ok: true; status: "completed" | "medical_review"; idempotent: boolean }
  | {
      ok: false;
      reason: "unavailable" | "expired" | "invalid_signature" | "name_mismatch" | "invalid_medical";
    };

function completedStatus(
  status: typeof waiverRecords.$inferSelect.status,
): "completed" | "medical_review" {
  return status === "medical_review" ? "medical_review" : "completed";
}

/** Optional emergency contact captured alongside the waiver, stored on the person. */
export type EmergencyContactInput = { name?: string; phone?: string };

/**
 * Write the diver's emergency contact to their person record, but only fill
 * blanks it actually supplied — a diver who leaves a field empty must never
 * wipe a value the shop already has on file. The person is reached through the
 * record's booking, so a bearer token can only ever touch its own diver.
 */
async function saveEmergencyContact(
  db: AppDb,
  bookingId: string,
  contact: EmergencyContactInput,
): Promise<void> {
  const name = contact.name?.trim();
  const phone = contact.phone?.trim();
  if (!name && !phone) return;
  const patch: Partial<typeof people.$inferInsert> = {};
  if (name) patch.emergencyContactName = name;
  if (phone) patch.emergencyContactPhone = phone;
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return;
  await db.update(people).set(patch).where(eq(people.id, booking.personId));
}

/** The diver's emergency contact on file, reached through their booking. */
export async function getEmergencyContactForBooking(
  db: AppDb,
  bookingId: string,
): Promise<{ name: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({
      name: people.emergencyContactName,
      phone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

/** The same person-level contact read used by a waiver with no booking. */
export async function getEmergencyContactForPerson(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ name: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({ name: people.emergencyContactName, phone: people.emergencyContactPhone })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/**
 * Save an emergency contact for a booking's diver, scoped to the shop so a
 * bearer-token surface (the `/ready` page) can only ever write to its own
 * booking's person. Blanks never overwrite an existing value.
 */
export async function saveBookingEmergencyContact(
  db: AppDb,
  input: { shopId: string; bookingId: string; name?: string; phone?: string },
): Promise<boolean> {
  const name = input.name?.trim();
  const phone = input.phone?.trim();
  if (!name && !phone) return false;
  const patch: Partial<typeof people.$inferInsert> = {};
  if (name) patch.emergencyContactName = name;
  if (phone) patch.emergencyContactPhone = phone;
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return false;
  const [updated] = await db
    .update(people)
    .set(patch)
    .where(eq(people.id, booking.personId))
    .returning({ id: people.id });
  return Boolean(updated);
}

/** Save a person-level emergency contact when the waiver has no booking context. */
export async function savePersonEmergencyContact(
  db: DbExecutor,
  input: { shopId: string; personId: string; name?: string; phone?: string },
): Promise<boolean> {
  const name = input.name?.trim();
  const phone = input.phone?.trim();
  if (!name && !phone) return false;
  const patch: Partial<typeof people.$inferInsert> = {};
  if (name) patch.emergencyContactName = name;
  if (phone) patch.emergencyContactPhone = phone;
  const [updated] = await db
    .update(people)
    .set(patch)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .returning({ id: people.id });
  return Boolean(updated);
}

export async function completeWaiver(
  db: AppDb,
  token: string,
  input: {
    signerName: string;
    agreed: boolean;
    medicalAnswers: MedicalAnswers;
    emergencyContact?: EmergencyContactInput;
    now?: Date;
  },
): Promise<CompleteWaiverOutcome> {
  const now = input.now ?? nowDate();
  const evidence = localTypedConsentProvider.capture({
    signerName: input.signerName,
    agreed: input.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false, reason: "invalid_signature" };

  const state = await getWaiverForToken(db, token, now);
  if (state.state === "unavailable") return { ok: false, reason: "unavailable" };
  if (state.state === "expired") return { ok: false, reason: "expired" };
  if (state.state === "completed") {
    return { ok: true, status: completedStatus(state.record.status), idempotent: true };
  }

  // "Type your full name" is the signature. It accepted anything at least two
  // characters long, so a release could be executed under "asdf" and still read
  // as a signed waiver on the manifest. The typed name must plausibly be the
  // diver the record belongs to — `personNamesMatch` tolerates case, accents,
  // punctuation, word order and a middle initial (the noise that is *not* a
  // different person) and refuses anything that changes a name token.
  //
  // Refused *before* the record is touched, so a mismatch leaves the link
  // signable rather than burning it. A diver whose booking genuinely holds the
  // wrong name is directed to the shop, which can correct the record.
  const [signer] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, state.record.personId))
    .limit(1);
  if (!signer || !personNamesMatch(evidence.signerName, signer.fullName)) {
    return { ok: false, reason: "name_mismatch" };
  }

  // The form is conditional: closed boxes are not submitted, but every
  // applicable question must be answered before signed evidence is written.
  // `requireCurrent`: a retired questionnaire version stays readable so stored
  // evidence can be interpreted, but must never be the question set a *new*
  // signature is taken against — otherwise a corrected form could be answered
  // under the version it corrected. The page already derives the version
  // server-side; this makes that structural rather than a property of one call
  // site staying careful (`coderabbitai`).
  const medicalValidation = validateMedicalAnswers(input.medicalAnswers, {
    requireComplete: true,
    requireCurrent: true,
  });
  if (!medicalValidation.ok) {
    return { ok: false, reason: "invalid_medical" };
  }
  const medicalReviewRequired = needsMedicalReview(input.medicalAnswers);
  const status = medicalReviewRequired ? ("medical_review" as const) : ("completed" as const);
  const [saved] = await db
    .update(waiverRecords)
    .set({
      status,
      signedName: evidence.signerName,
      signatureMethod: evidence.method,
      consentedAt: evidence.consentedAt,
      signedAt: evidence.signedAt,
      medicalAnswers: input.medicalAnswers,
      medicalReviewRequired,
      completedAt: now,
      // Signed: the link has done its job, so the openable copy goes. The token
      // still *resolves* (a diver revisiting sees their signed release) — it
      // just can no longer be read back out of the database and re-sent.
      tokenSealed: null,
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id, status: waiverRecords.status });
  if (saved) {
    const [signedRecord] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, saved.id))
      .limit(1);
    if (signedRecord) {
      await db
        .update(waiverRecords)
        .set({
          integrityHash: computeWaiverIntegrityHash(signedRecord),
          integrityVersion: 1,
        })
        .where(eq(waiverRecords.id, signedRecord.id));
    }
    if (input.emergencyContact) {
      if (state.record.bookingId) {
        await saveEmergencyContact(db, state.record.bookingId, input.emergencyContact);
      } else {
        await savePersonEmergencyContact(db, {
          shopId: state.record.shopId,
          personId: state.record.personId,
          name: input.emergencyContact.name,
          phone: input.emergencyContact.phone,
        });
      }
    }
    return { ok: true, status: completedStatus(saved.status), idempotent: false };
  }

  // Another submit won the race. Do not overwrite its evidence; report that
  // stable result instead, which makes duplicate browser submits harmless.
  const current = await currentRecordForToken(db, token);
  if (current?.status === "completed" || current?.status === "medical_review") {
    return { ok: true, status: completedStatus(current.status), idempotent: true };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Every *signed* release on file for a set of divers at a shop, grouped by
 * person — the evidence the sign-once rule draws on. Includes both `completed`
 * and `medical_review` records (superseded ones excluded): the caller needs the
 * medical holds too, so a stale clean signature can never carry a diver past a
 * newer, unresolved medical review. Currency (template version, age) is decided
 * per booking by `effectiveWaiverForBooking`.
 */
export async function listSignedWaiversByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: string[],
): Promise<Map<string, (typeof waiverRecords.$inferSelect)[]>> {
  const byPerson = new Map<string, (typeof waiverRecords.$inferSelect)[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, personIds),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
        isNull(waiverRecords.supersededAt),
      ),
    );
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push(row);
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

/**
 * How far the diver's outstanding waiver has actually got.
 *
 * `link_copied` sits between `not_sent` and `not_signed` because a copied link
 * is genuinely between them: a live release exists and a staffer has the URL,
 * and nothing DiveDay can see has reached the diver. Reporting it as
 * `not_signed` (which the surface words as "sent") credited us with a delivery
 * that never happened; reporting it as `not_sent` would deny the link exists
 * and offer to issue another.
 */
export type DiverWaiverRequestStatus = "not_sent" | "failed" | "link_copied" | "not_signed";

/**
 * Persist the delivery outcome on the waiver itself, including person-scoped
 * links — twice, deliberately, and to answer two different questions.
 *
 * The columns on `waiver_records` are **the latest attempt on this link**,
 * whichever way it went: the delivery webhook keys on them, and
 * `getDiverWaiverRequestStatus` reads them for "has this diver been reached at
 * all?". The `waiver_deliveries` row is **this channel's** current state, and
 * it exists because tapping Text must not erase what we knew about the email.
 */
export async function recordWaiverDelivery(
  db: DbExecutor,
  input: {
    shopId: string;
    waiverRecordId: string;
    channel: WaiverDeliveryChannel;
    delivery: {
      status: "sent" | "failed" | "not_configured";
      providerMessageId?: string;
      detail?: string;
    };
    now?: Date;
  },
) {
  const providerStatus = null;
  const deliveryStatus =
    input.delivery.status === "sent"
      ? ("sent" as const)
      : input.delivery.status === "not_configured"
        ? ("not_configured" as const)
        : ("failed" as const);
  const detail = input.delivery.status === "failed" ? (input.delivery.detail ?? null) : null;
  const attemptedAt = input.now ?? nowDate();
  await db
    .update(waiverRecords)
    .set({
      deliveryStatus,
      deliveryProviderMessageId: input.delivery.providerMessageId ?? null,
      deliveryProviderStatus: providerStatus,
      deliveryProviderStatusAt: null,
      deliveryError: detail,
    })
    .where(eq(waiverRecords.id, input.waiverRecordId));
  // Current state per channel, so a second send on the same channel replaces
  // its row rather than stacking one. Any provider verdict already on the row
  // is cleared: it belonged to the message this attempt just superseded.
  await db
    .insert(waiverDeliveries)
    .values({
      shopId: input.shopId,
      waiverRecordId: input.waiverRecordId,
      channel: input.channel,
      status: deliveryStatus,
      providerMessageId: input.delivery.providerMessageId ?? null,
      detail,
      attemptedAt,
    })
    .onConflictDoUpdate({
      target: [waiverDeliveries.waiverRecordId, waiverDeliveries.channel],
      set: {
        status: deliveryStatus,
        providerMessageId: input.delivery.providerMessageId ?? null,
        providerStatus: null,
        providerStatusAt: null,
        detail,
        attemptedAt,
      },
    });
}

/**
 * The provider verdicts that mean a message that left DiveDay never landed.
 * Shared by the diver's overall request status and the per-channel one, so a
 * bounce can never read as delivered on one surface and failed on another.
 */
const FAILED_PROVIDER_STATUSES = new Set(["bounced", "complained", "failed", "suppressed"]);

/**
 * What a channel button on the diver record should wear. `unknown` is the
 * honest answer for a channel nobody has tried on this link — and the reason
 * this is a five-state code rather than a boolean.
 *
 * `copied` is the `link` channel's only success, and it is deliberately not
 * `sent`: a staffer taking the URL means *they* have it, and nothing at all
 * about whether the diver does. Where it went next — a WhatsApp message, a
 * text from the staffer's own phone, a laptop turned round on the counter —
 * happened outside DiveDay, so claiming a send would be inventing an event we
 * never saw. `sent` never appears on the link channel and `copied` never
 * appears on the other two.
 */
export type WaiverChannelDeliveryState =
  | "unknown"
  | "sent"
  | "copied"
  | "failed"
  | "not_configured";

export type WaiverChannelDeliveryStates = Record<WaiverDeliveryChannel, WaiverChannelDeliveryState>;

const NO_WAIVER_CHANNEL_STATES: WaiverChannelDeliveryStates = {
  email: "unknown",
  text: "unknown",
  link: "unknown",
};

/**
 * Per-channel delivery state for the diver's current outstanding waiver link.
 *
 * Scoped to the *pending, unsuperseded* record on purpose: a channel's outcome
 * describes one link, so carrying last month's bounce onto a link issued this
 * morning would be a button lying about a message that was never sent. When
 * there is no such record — nothing outstanding — every channel is `unknown`.
 */
export async function getDiverWaiverChannelStates(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<WaiverChannelDeliveryStates> {
  const [record] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .orderBy(desc(waiverRecords.createdAt))
    .limit(1);
  if (!record) return NO_WAIVER_CHANNEL_STATES;

  const rows = await db
    .select({
      channel: waiverDeliveries.channel,
      status: waiverDeliveries.status,
      providerStatus: waiverDeliveries.providerStatus,
    })
    .from(waiverDeliveries)
    .where(
      and(eq(waiverDeliveries.shopId, shopId), eq(waiverDeliveries.waiverRecordId, record.id)),
    );

  const states: WaiverChannelDeliveryStates = { ...NO_WAIVER_CHANNEL_STATES };
  for (const row of rows) {
    // A provider verdict outranks our own send result: "we handed it to SES"
    // and "SES says it bounced" are both true, and only the second one matters
    // to a staffer deciding whether to try another way.
    if (row.providerStatus && FAILED_PROVIDER_STATUSES.has(row.providerStatus)) {
      states[row.channel] = "failed";
      continue;
    }
    // The link channel stores `sent` — those columns answer "is there a live
    // link", and there is — but it must never *read* as sent. Nothing was
    // delivered; a staffer picked the URL up.
    states[row.channel] = row.channel === "link" && row.status === "sent" ? "copied" : row.status;
  }
  return states;
}

/**
 * The delivery state of the latest outstanding waiver request for one diver.
 * A missing delivery row is treated as a failed handoff: the waiver record
 * can exist even when there was no usable email/origin to attempt delivery.
 */
export async function getDiverWaiverRequestStatus(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<DiverWaiverRequestStatus> {
  const [row] = await db
    .select({
      recordId: waiverRecords.id,
      recordDeliveryStatus: waiverRecords.deliveryStatus,
      recordProviderStatus: waiverRecords.deliveryProviderStatus,
      deliveryStatus: notificationDeliveries.status,
      providerStatus: notificationDeliveries.providerStatus,
    })
    .from(waiverRecords)
    .leftJoin(
      notificationDeliveries,
      and(
        eq(notificationDeliveries.shopId, shopId),
        eq(notificationDeliveries.bookingId, waiverRecords.bookingId),
        eq(notificationDeliveries.kind, "waiver_request"),
      ),
    )
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .orderBy(desc(waiverRecords.createdAt))
    .limit(1);

  if (!row) return "not_sent";
  const deliveryStatus = row.recordDeliveryStatus ?? row.deliveryStatus;
  const providerStatus = row.recordProviderStatus ?? row.providerStatus;
  if (
    deliveryStatus !== "sent" ||
    (providerStatus !== null && FAILED_PROVIDER_STATUSES.has(providerStatus))
  ) {
    return "failed";
  }
  // The record's columns are the latest attempt *whichever way it went*, so a
  // "Copy link" tap after a real email leaves them saying `sent` about a
  // handover nobody watched. The per-channel rows are where the two are still
  // told apart: a message actually left DiveDay only if some channel other
  // than `link` is standing at `sent`.
  //
  // A second query rather than a join: this runs on an executor that may be a
  // transaction (one checked-out client), and it is only reached for a diver
  // who has an outstanding link at all.
  const channelRows = await db
    .select({ channel: waiverDeliveries.channel, status: waiverDeliveries.status })
    .from(waiverDeliveries)
    .where(
      and(eq(waiverDeliveries.shopId, shopId), eq(waiverDeliveries.waiverRecordId, row.recordId)),
    );
  // No per-channel rows at all means the record's own columns are all we have,
  // and they say a message went — the notification-table fallback lands here.
  if (channelRows.length === 0) return "not_signed";
  // Reaching this line means the latest attempt stood at `sent`. If no channel
  // other than `link` is standing there, the only thing that can have set it is
  // a staffer taking the URL.
  return channelRows.some(
    (channelRow) => channelRow.channel !== "link" && channelRow.status === "sent",
  )
    ? "not_signed"
    : "link_copied";
}

export type InPersonWaiverOutcome =
  | { ok: true; recordId: string; alreadySigned: boolean }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "person_not_found"
        | "template_not_found"
        | "staff_not_found"
        | "medical_attestation_required"
        | "invalid_signature";
    };

/**
 * The `people.id` of the staff member whose name goes on a paper release, or
 * `null` when whoever is claiming to attest it is not this shop's live staff
 * right now.
 *
 * This used to be a hand-rolled `person_roles` join here — `people.id` /
 * `people.shopId` / `person_roles.role` and nothing else. That catches what it
 * was written for (a diver, or somebody demoted out of every staff role) and
 * misses the two cases `loadActiveStaffRoles` exists for: a **deleted** person,
 * because `deleteDiver` sets `people.deleted_at` and leaves every role row
 * where it is, and a **disabled** account, because `setStaffAccountStatus`
 * revokes sign-in and leaves `person_roles` entirely intact — a suspended
 * employee keeps every role row they had. Both wrote a real, immutable
 * `waiver_records` row stamped `recorded_by_person_id`.
 *
 * That row is a signed medical and liability release, and the stamp is the
 * shop's answer to "who watched this diver sign?". A release attributed to
 * somebody the shop had already removed is a document that may have to stand up
 * outside the company, so the gate belongs in the writer rather than only in
 * the two server actions above it.
 *
 * `src/db/authz.ts` is the one place the rule lives; `loadActiveStaffRoles`
 * takes a `DbExecutor`, so it composes inside this transaction unchanged and
 * "who counts as live staff" widens once for the role gates and this writer
 * together. Same shape as `activeStaffRecorderId` in `src/db/manifests.ts`.
 */
async function activeStaffAttestorId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

/** The diver a paper release will be filed for, resolved from either subject. */
type WaiverSigner = {
  ok: true;
  /** Null for a person-scoped record — there is no seat to stamp on it. */
  bookingId: string | null;
  personId: string;
  fullName: string;
};

async function bookingSigner(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<WaiverSigner | Extract<InPersonWaiverOutcome, { ok: false }>> {
  const [booking] = await tx
    .select({
      id: bookings.id,
      personId: bookings.personId,
      fullName: people.fullName,
      tripStatus: trips.status,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return { ok: false, reason: "booking_not_found" };
  if (booking.tripStatus !== "scheduled") return { ok: false, reason: "booking_unavailable" };
  return {
    ok: true,
    bookingId: booking.id,
    personId: booking.personId,
    fullName: booking.fullName,
  };
}

/**
 * The diver themselves, with no seat in sight.
 *
 * Deliberately does *not* require a `diver` role row: a shop hands a release to
 * whoever is about to get in the water, and the record is evidence of that act
 * rather than a claim about how the person is filed. It does require a live
 * record of this shop's — removed or erased people cannot be attested for, the
 * same rule `activeStaffAttestorId` applies to the staffer signing it off.
 */
async function personSigner(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<WaiverSigner | Extract<InPersonWaiverOutcome, { ok: false }>> {
  const [person] = await tx
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!person) return { ok: false, reason: "person_not_found" };
  return { ok: true, bookingId: null, personId: person.id, fullName: person.fullName };
}

/**
 * The record that makes filing another one pointless, or null when there is
 * none — the idempotency check, and the one place the two subjects differ.
 *
 * A booking asks "does this seat already have an answer?", because that is the
 * question the roster and the counter are looking at. A person asks "does this
 * diver still hold one?" — a lapsed signature is exactly what a shop standing
 * there with a fresh sheet of paper is replacing, so it must not read as done.
 */
async function standingWaiverRecord(
  tx: DbExecutor,
  input: {
    shopId: string;
    bookingId: string | null;
    personId: string;
    templateGeneration: number;
    now: Date;
  },
) {
  if (input.bookingId) {
    const current = await tx
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, input.bookingId), isNull(waiverRecords.supersededAt)));
    return current.find(
      (record) => record.status === "completed" || record.status === "medical_review",
    );
  }
  const held = await tx
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return held.find(
    (record) =>
      isUnresolvedMedicalHold(record) ||
      isCompletedWaiverCurrent(record, input.templateGeneration, input.now),
  );
}

/**
 * Who a paper release is being recorded for.
 *
 * A signature is a fact about a **person and a shop** — one current record
 * clears every booking the diver holds here (`effectiveWaiverForBooking`) — so
 * a seat is context, not a requirement. Both shapes write the same record;
 * `bookingId` only says where the shop was standing when they filed it.
 *
 * - `{ bookingId }` — the roster and the check-in queue, where the staffer is
 *   already looking at one departure. The seat is stamped on the record, and
 *   the booking's own live pending link is retired.
 * - `{ personId }` — the diver's record, where the conversation is about the
 *   diver: they phoned ahead, or handed the release over months before they
 *   book anything. `bookingId` stays null, exactly as it does for an imported
 *   record (ADR 20260811-person-scoped-paper-waivers).
 */
export type InPersonWaiverSubject = { bookingId: string } | { personId: string };

/**
 * A staff member records that a diver signed the release on paper — a copy on
 * the boat or handed over on shore — for a diver the app never sees sign. The
 * result is the same immutable completed record a diver self-service completion
 * produces (ADR 20260718), snapshotting the current template, but marked
 * `in_person_attested` and stamped with the accountable staff member. Because
 * the record is person-scoped it carries forward like any other signature.
 *
 * The medical block is load-bearing and cannot be conjured from thin air: this
 * path records a clean release only, so the caller must pass an explicit
 * `medicalAttested` — staff affirming they reviewed the paper medical form and
 * no answer needs physician sign-off. Without it the record is refused, and a
 * flagged medical must go through the diver-facing link, which captures the
 * questionnaire and routes to review. The actor must be this shop's live staff
 * either way; a booking subject must additionally be a live seat on a scheduled
 * trip, the same guard `issueWaiverRequest` applies.
 *
 * Idempotent, and the two subjects mean subtly different things by it. A
 * booking already signed or in medical review keeps its existing record rather
 * than stacking a second one. A *person* is only "already done" if what they
 * hold still stands — a current clean signature or an unresolved medical hold —
 * because a lapsed release is precisely what the shop is standing there with a
 * fresh sheet of paper to replace.
 */
export async function recordInPersonWaiver(
  db: AppDb,
  input: {
    shopId: string;
    subject: InPersonWaiverSubject;
    recordedByPersonId: string;
    medicalAttested: boolean;
    now?: Date;
  },
): Promise<InPersonWaiverOutcome> {
  const now = input.now ?? nowDate();
  if (!input.medicalAttested) return { ok: false, reason: "medical_attestation_required" };
  const bookingSubject = "bookingId" in input.subject ? input.subject.bookingId : null;
  return db.transaction(async (tx): Promise<InPersonWaiverOutcome> => {
    const attestedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!attestedBy) return { ok: false, reason: "staff_not_found" };

    const signer = bookingSubject
      ? await bookingSigner(tx, input.shopId, bookingSubject)
      : await personSigner(tx, input.shopId, (input.subject as { personId: string }).personId);
    if (!signer.ok) return signer;

    const [template] = await tx
      .select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.deletedAt)))
      .orderBy(desc(waiverTemplates.createdAt))
      .limit(1);
    if (!template) return { ok: false, reason: "template_not_found" };

    const standing = await standingWaiverRecord(tx, {
      shopId: input.shopId,
      bookingId: signer.bookingId,
      personId: signer.personId,
      templateGeneration: template.materialGeneration,
      now,
    });
    if (standing) return { ok: true, recordId: standing.id, alreadySigned: true };

    const evidence = inPersonAttestationProvider.capture({
      signerName: signer.fullName,
      agreed: true,
      signedAt: now,
    });
    if (!evidence) return { ok: false, reason: "invalid_signature" };

    // Retire this booking's live pending link so its bearer token can never
    // complete a second record after the shop has recorded the paper copy.
    // Person-scoped records leave other bookings' links alone: those are a
    // different seat's paperwork, and a diver part-way through signing one
    // online should not find it dead.
    if (signer.bookingId) {
      await tx
        .update(waiverRecords)
        .set({ supersededAt: now, tokenSealed: null })
        .where(
          and(
            eq(waiverRecords.bookingId, signer.bookingId),
            eq(waiverRecords.status, "pending"),
            isNull(waiverRecords.supersededAt),
          ),
        );
    }

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: signer.bookingId,
        personId: signer.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        status: "completed",
        // No link is ever handed out for a paper record; a random unusable hash
        // keeps the unique token column satisfied without granting bearer access.
        tokenHash: hashWaiverToken(createWaiverToken()),
        expiresAt: now,
        signedName: evidence.signerName,
        signatureMethod: evidence.method,
        recordedByPersonId: attestedBy,
        consentedAt: evidence.consentedAt,
        signedAt: evidence.signedAt,
        completedAt: now,
      })
      .returning();
    if (!record) throw new Error("recordInPersonWaiver: insert returned no row");
    await tx
      .update(waiverRecords)
      .set({ integrityHash: computeWaiverIntegrityHash(record), integrityVersion: 1 })
      .where(eq(waiverRecords.id, record.id));
    return { ok: true, recordId: record.id, alreadySigned: false };
  });
}

/**
 * **Which way the physician answered.** The RSTC Physician's Evaluation Form
 * has two outcomes, and until issue #1283 DiveDay modelled only the first.
 *
 * `not_cleared` is not a weaker clearance: it is the absence of one, recorded.
 * The hold stands either way it is written down — what changes is that the
 * record can finally say the answer *arrived*, so the shop stops chasing a
 * diver whose doctor has already said no and the crew learns it before the
 * dock rather than at it.
 */
export type MedicalEvaluationOutcome = "cleared" | "not_cleared";

/**
 * What happened when a shop tried to record a physician's answer.
 *
 * `no_medical_hold` is the interesting refusal: this diver has nothing parked
 * in review here, so there is nothing to answer. It is not an error state to
 * apologise for — it is the answer to a question the staffer asked — and the
 * surface words it as such.
 */
export type MedicalEvaluationResult =
  | {
      ok: true;
      recordId: string;
      /** Which answer now stands on the record — the one just written, or the one already there. */
      outcome: MedicalEvaluationOutcome;
      /** The answer was already on file, so nothing was written. A double submit, not a failure. */
      alreadyRecorded: boolean;
    }
  | {
      ok: false;
      reason:
        | "staff_not_found"
        | "no_medical_hold"
        /**
         * This record already carries the *other* answer, and neither
         * overwrites the other. A physician's "no" is not erasable by whoever
         * is at the desk next, and a diver re-evaluated after a refusal is
         * answering a fresh disclosure — which signs a new release and parks a
         * new hold that can be cleared on its own terms.
         */
        | "answer_already_recorded"
        /** No evaluation date, or one that is not a calendar date. */
        | "evaluation_date_required"
        /**
         * The letter predates the answers it is supposed to clear. A physician
         * evaluation written in March cannot clear a stent placed in June, and
         * a shop handed a stale letter should be told so rather than have it
         * recorded as a fresh clearance (`dive-domain-expert` review, #1252).
         */
        | "evaluation_predates_disclosure"
        /** An evaluation dated after today is a typo, not a clearance. */
        | "evaluation_in_future"
        /**
         * Neither the evaluation nor the physician's name. Without one of them
         * the row records only that a member of the shop's own staff pressed a
         * button, which is the hearsay the paper-waiver attestation's checkbox
         * exists to avoid.
         */
        | "evidence_required";
    };

/**
 * Whether this diver has a medical hold **no physician has answered yet**, at
 * this shop.
 *
 * A cheap read the surface runs **before** it stores a physician's evaluation.
 * Without it, uploading first and refusing second left the most sensitive file
 * the product holds sitting in the bucket with no row pointing at it — reachable
 * by neither the media-deletion ledger nor `anonymizeDiver`, which walks rows
 * (security review H2). The honest-mistake path was the bad one: a staffer opens
 * the wrong diver's record, uploads a real evaluation, and is told there is
 * nothing to clear.
 *
 * **Not the same question as `isUnresolvedMedicalHold`, and the difference is
 * the point of issue #1283.** That one asks *may this diver board* — a refusal
 * leaves it `true`, because the block stands. This one asks *is there an answer
 * outstanding*, and a refusal makes it `false`: the answer arrived. Reading
 * either for the other's question inverts a safety property in one direction or
 * re-opens a settled refusal in the other, so they are deliberately two
 * functions with two names rather than one shared predicate.
 */
export async function hasUnansweredMedicalHold(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        isNull(waiverRecords.supersededAt),
        isNull(waiverRecords.anonymizedAt),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * **A staff member records what a physician said about this diver.**
 *
 * The questionnaire refers a diver, the release parks in `medical_review`, and
 * readiness refuses to board them (`src/lib/readiness.ts`). Then the diver comes
 * back holding a signed physician evaluation — and until this existed the only
 * lift was `recordInPersonWaiver`'s attestation, whose staff-facing words are
 * "no answer needs physician sign-off": the opposite of what the diver is
 * standing there with. A staffer either attested to something untrue or left a
 * cleared diver blocked (issue #1252).
 *
 * So this is its own act, and deliberately not a widening of that one. It never
 * writes a release, never touches the signed evidence or its integrity seal,
 * and cannot be reached by a tap on "Mark ready" — it stamps the answer and its
 * evidence onto the record that was referred, one column of which is always the
 * accountable staff member.
 *
 * **The subject is the person, and the record is resolved here rather than
 * posted.** A client that could name the waiver record it is clearing could
 * name a different diver's; the caller passes the diver whose page they are on
 * (itself a path segment the surface already gates), and this finds their most
 * recent unresolved hold at *this shop*. Nothing else is clearable.
 *
 * **Fails closed on every unknown.** No live hold and no clearance already on
 * file is a refusal, never a silent success; an erased record is not clearable
 * (there is no longer a questionnaire to have been evaluated); and the actor
 * must be this shop's live staff, the same rule paper attestation applies.
 *
 * Idempotent: a diver whose hold already carries this answer comes back
 * `alreadyRecorded` rather than being stamped twice, so a double submit cannot
 * rewrite who recorded it or when. The *other* answer is a refusal rather than
 * an overwrite — see `answer_already_recorded`.
 *
 * **Both outcomes, one act** (issue #1283). "Not cleared" asks for exactly the
 * same evidence and runs exactly the same refusals, because it is the same
 * conversation at the desk with the opposite result — and it is the outcome
 * with teeth, since it is the one that keeps a paying diver off the boat. What
 * it does *not* do is lift anything: a refusal writes no `medicalClearedAt`, so
 * `isUnresolvedMedicalHold` still holds the diver and readiness still refuses to
 * board them. Nothing about the block changes; only what the surfaces can say
 * about it.
 */
export async function recordMedicalEvaluation(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    recordedByPersonId: string;
    /** Which way the physician answered. Never inferred — the staffer says which. */
    outcome: MedicalEvaluationOutcome;
    /** The day the physician evaluated the diver, as printed on the form. */
    evaluatedOn: string;
    /** The clinician who signed it. Required unless the evaluation itself is attached. */
    physicianName?: string | null;
    /** The physician's evaluation, already re-stored through `storeMedicalClearanceDocument`. */
    documentUrl?: string | null;
    now?: Date;
  },
): Promise<MedicalEvaluationResult> {
  const now = input.now ?? nowDate();
  const physicianName = input.physicianName?.trim() || null;
  const documentUrl = input.documentUrl ?? null;
  if (!isValidCalendarDate(input.evaluatedOn)) {
    return { ok: false, reason: "evaluation_date_required" };
  }
  if (!documentUrl && !physicianName) return { ok: false, reason: "evidence_required" };
  // The shop's own day, not the host's: on a UTC box a Key Largo evening is
  // already tomorrow, and a form dated today would read as the future.
  if (input.evaluatedOn > calendarDateInTimezone(now, "UTC")) {
    return { ok: false, reason: "evaluation_in_future" };
  }
  return db.transaction(async (tx): Promise<MedicalEvaluationResult> => {
    const recordedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const held = await tx
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.personId, input.personId),
          eq(waiverRecords.status, "medical_review"),
          isNull(waiverRecords.supersededAt),
          isNull(waiverRecords.anonymizedAt),
        ),
      )
      .orderBy(desc(waiverRecords.completedAt));

    // "Answered" is either stamp: a refusal resolves the question as
    // conclusively as a clearance does, and only an unanswered record is open
    // to be written.
    const answered = held.find(
      (record) => record.medicalClearedAt !== null || record.medicalClearanceDeclinedAt !== null,
    );
    const open = held.find(
      (record) => record.medicalClearedAt === null && record.medicalClearanceDeclinedAt === null,
    );
    if (!open) {
      if (!answered) return { ok: false, reason: "no_medical_hold" };
      const standing: MedicalEvaluationOutcome = answered.medicalClearedAt
        ? "cleared"
        : "not_cleared";
      // The same answer twice is a double submit. The opposite answer is
      // somebody trying to overwrite a physician's word from the desk, and it
      // is refused in both directions: a "no" is not erasable, and a "yes" is
      // not quietly downgraded either.
      return standing === input.outcome
        ? { ok: true, recordId: answered.id, outcome: standing, alreadyRecorded: true }
        : { ok: false, reason: "answer_already_recorded" };
    }

    // The evaluation must post-date the answers it clears. Compared as calendar
    // dates in UTC, matching how the column is read back everywhere else.
    const disclosedOn = open.signedAt ?? open.completedAt ?? open.createdAt;
    if (input.evaluatedOn < calendarDateInTimezone(disclosedOn, "UTC")) {
      return { ok: false, reason: "evaluation_predates_disclosure" };
    }

    const cleared = input.outcome === "cleared";
    const [written] = await tx
      .update(waiverRecords)
      .set({
        medicalClearedAt: cleared ? now : null,
        medicalClearedByPersonId: cleared ? recordedBy : null,
        medicalClearanceDeclinedAt: cleared ? null : now,
        medicalClearanceDeclinedByPersonId: cleared ? null : recordedBy,
        medicalClearanceEvaluatedOn: input.evaluatedOn,
        medicalClearancePhysicianName: physicianName,
        medicalClearanceDocumentUrl: documentUrl,
      })
      // Both stamps are in the guard, not just the one being written: two
      // staffers answering opposite ways in the same breath must not both
      // succeed, and narrowing on only the column this call sets would let the
      // second overwrite the first's row from the other side.
      .where(
        and(
          eq(waiverRecords.id, open.id),
          isNull(waiverRecords.medicalClearedAt),
          isNull(waiverRecords.medicalClearanceDeclinedAt),
        ),
      )
      .returning({ id: waiverRecords.id });
    // Lost the race: somebody else answered in the same breath. Re-read rather
    // than assume it was the same answer — reporting a refusal as a recorded
    // clearance is the one mistake this whole path exists to prevent.
    if (!written) {
      const [current] = await tx
        .select({ clearedAt: waiverRecords.medicalClearedAt })
        .from(waiverRecords)
        .where(eq(waiverRecords.id, open.id))
        .limit(1);
      const standing: MedicalEvaluationOutcome = current?.clearedAt ? "cleared" : "not_cleared";
      return standing === input.outcome
        ? { ok: true, recordId: open.id, outcome: standing, alreadyRecorded: true }
        : { ok: false, reason: "answer_already_recorded" };
    }
    return { ok: true, recordId: written.id, outcome: input.outcome, alreadyRecorded: false };
  });
}

/**
 * The stored physician's evaluation for one waiver record, or null (issue
 * #1283).
 *
 * Shop-scoped in the query rather than by the caller, and narrowed to a record
 * that actually holds a physician's answer: a URL on a row carrying neither
 * stamp cannot exist (the `waiver_records_medical_clearance_attributed` check
 * refuses it), and asking for one anyway means the read matches the state the
 * route claims to be showing rather than whatever the column happens to hold.
 *
 * Returns the URL rather than the bytes. Fetching is `src/lib/storage`'s job
 * and `src/db` has no business signing an S3 request; keeping the split means
 * this stays a plain, testable read. The diver's id rides along because the
 * route has to write who opened their file onto their own record.
 */
export async function getMedicalClearanceDocument(
  db: DbExecutor,
  shopId: string,
  recordId: string,
): Promise<{ url: string; personId: string } | null> {
  // An id Postgres cannot parse raises 22P02 rather than selecting nothing, and
  // the throw would escape the route as a 500 where it promises a uniform 404.
  // The house rule is written at `src/lib/uuid.ts`: an unparseable id names no
  // row, which is a 404.
  if (!isUuid(recordId)) return null;
  const [row] = await db
    // The person as well as the file: opening a diver's medical document is an
    // act their own record has to be able to show (issue #1283).
    .select({ url: waiverRecords.medicalClearanceDocumentUrl, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.id, recordId),
        eq(waiverRecords.shopId, shopId),
        // Either answer, because a physician's letter saying *no* is a stored
        // evaluation like any other — the `..._attributed` check lets a
        // document hang off either stamp, and a read narrowed to clearances
        // would leave the refusal's own evidence unreachable, which is the
        // retention-liability-with-no-retrieval-value shape issue #1283 exists
        // to close.
        or(
          isNotNull(waiverRecords.medicalClearedAt),
          isNotNull(waiverRecords.medicalClearanceDeclinedAt),
        ),
        // An erased diver's document is destroyed, and the row keeps the
        // stamp. Reading through it would be reaching for bytes that are gone.
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .limit(1);
  return row?.url ? { url: row.url, personId: row.personId } : null;
}

/**
 * Staff roster view: only the current record joins each active booking. The
 * single-trip form of `listTripsWaiverStatuses` below — one query, one rule,
 * so the two can never disagree about which record is current.
 */
export async function listTripWaiverStatuses(db: DbExecutor, shopId: string, tripId: string) {
  return listTripsWaiverStatuses(db, shopId, [tripId]);
}

/**
 * Staff roster view: only the current record joins each active booking across
 * multiple trips.
 *
 * Ordered by seat time then id, for the reason `getTripRoster` states in full:
 * `bookings.created_at` ties across a seeding transaction, and since
 * `createBooking` stamps the application clock it ties across a spec's own
 * writes too. A list a staffer works down is not left to the heap.
 */
export async function listTripsWaiverStatuses(db: DbExecutor, shopId: string, tripIds: string[]) {
  if (tripIds.length === 0) return [];
  return db
    .select({ booking: bookings, person: people, waiver: waiverRecords })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      waiverRecords,
      and(eq(waiverRecords.bookingId, bookings.id), isNull(waiverRecords.supersededAt)),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, tripIds),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(bookings.id));
}
