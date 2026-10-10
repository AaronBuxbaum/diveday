/**
 * Waivers: the shop's release text — the current template, its version
 * history, saving a new version, and what a change would expose. Imported
 * through the `./waivers` barrel.
 */
import { and, countDistinct, desc, eq, gt, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { DEFAULT_WAIVER_TITLE, WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import type { AppDb, DbExecutor } from "./client";
import {
  bookings,
  people,
  shops,
  trips,
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

/**
 * The current release's material generation alone — what every readiness pass
 * compares a signature against (`isCompletedWaiverCurrent`). The same row
 * {@link getCurrentWaiverTemplate} reads, without its body: a roster, a
 * handoff or a counter rental never shows the release text, and reading it on
 * every pass is the widest column in the shop's waiver tables for nothing.
 */
export async function getCurrentWaiverGeneration(
  db: DbExecutor,
  shopId: string,
): Promise<{ materialGeneration: number } | null> {
  const [template] = await db
    .select({ materialGeneration: waiverTemplates.materialGeneration })
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

/**
 * The shop's own zone, which is what turns a signing instant into the calendar
 * day the guardian rule measures the diver's age on. Every writer here that
 * asks the rule reads it from the row rather than from a caller, for the same
 * reason the writers resolve the shop from the record: a bearer token must
 * never be able to name a different zone than the shop it belongs to.
 */
export async function shopTimezone(tx: DbExecutor, shopId: string): Promise<string> {
  const [shop] = await tx
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) throw new Error(`waivers: shop ${shopId} not found`);
  return shop.timezone;
}
