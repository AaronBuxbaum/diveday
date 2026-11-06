/**
 * Waivers: the bearer's side — resolving a token, saving a draft, the
 * guardian's co-signature, emergency contacts, and completing the release.
 * Imported through the `./waivers` barrel.
 */
import { and, desc, eq, getTableColumns, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { readEmergencyContact } from "@/lib/contact";
import {
  type GuardianRelationship,
  guardianSignatureRequired,
  isGuardianRelationship,
  signingDate,
} from "@/lib/guardian";
import { calculateMedicalResult, validateMedicalAnswers } from "@/lib/medical";
import { readDraftMedicalAlert, readMedicalAlert } from "@/lib/medical-alert";
import { personNamesMatch } from "@/lib/person-name";
import { localTypedConsentProvider } from "@/lib/signatures";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_SIGNED,
  waiverIntegrityVerdict,
} from "@/lib/waiver-integrity";
import { buildShopAnswers, draftShopAnswersFrom } from "@/lib/waiver-questions";
import { isUnresolvedMedicalHold, needsMedicalReview } from "@/lib/waivers";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import {
  capabilityClaim,
  claimCapability,
  spendCapability,
  type VerifiedCapability,
  verifyCapability,
} from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import type { DraftGuardian, MedicalAnswers } from "./schema";
import { activityEvents, bookings, capabilities, people, waiverRecords } from "./schema";
import { seatNotCancelled } from "./trips-queries";
import { withVerifiedClearance } from "./waiver-record-columns";
import { personContactLeadTyped, seatMinorDeclared } from "./waiver-signing";
import { doctorPageOpen } from "./waivers-medical";
import {
  getCurrentWaiverTemplate,
  getWaiverTemplateQuestions,
  shopTimezone,
} from "./waivers-templates";

export type TokenWaiverState =
  | { state: "unavailable" }
  | { state: "available"; record: typeof waiverRecords.$inferSelect }
  | { state: "completed"; record: typeof waiverRecords.$inferSelect };

/**
 * **Which record a signing request is about**, as a key this module made: the
 * record the diver's readiness link resolved for its own seat
 * (`ThreadWaiverKey`), or the release a link names (`LinkWaiverKey`): a
 * counter link, or a release link to a release with no seat. Never a raw
 * token: a server action's arguments are whatever the browser sends.
 */
export type WaiverKey = ThreadWaiverKey | LinkWaiverKey;

/**
 * The capabilities that open one release and nothing else, claimed by the first
 * device that opens them: a counter link (a seat's or one with no seat) and a
 * party member's door (a seat's only).
 */
const COUNTER_DOOR_PURPOSES = ["waiver_link", "party_waiver_link"] as const;
export type WaiverDoorPurpose = (typeof COUNTER_DOOR_PURPOSES)[number];
/** Every capability a `LinkWaiverKey` comes from. */
type LinkPurpose = WaiverDoorPurpose | "release_link";

/**
 * **A release opened through a link** (`waiverLinkDoor`), re-checked on every
 * read (revoked, expired, or spent on a release still unsigned opens nothing)
 * and spent in the transaction that records the signature (`completeWaiver`).
 *
 * - `counter`: a `waiver_link`, shown as a QR on the counter tablet for a
 *   seat's release (issue #2743), or handed to staff by Copy link for a release
 *   with no seat (issue #3983). Half an hour, on the first phone to open it.
 * - `release`: a `release_link`, mailed or texted to the contact on file for a
 *   release with no seat (issue #3983). A week; never handed to staff.
 *
 * It carries no readiness authority: neither link is the diver's thread link.
 */
export type LinkWaiverKey = {
  readonly kind: "counter" | "release";
  /**
   * Which door opened it. A `counter` key comes from the counter tablet's QR or
   * Copy link (`waiver_link`), or from the waiver-only door the join email sent
   * a party member (`party_waiver_link`, issue #3986); a `release` key from a
   * mailed or texted `release_link`. The signature spends the link of this
   * purpose and no other.
   */
  readonly purpose: LinkPurpose;
  readonly shopId: string;
  /** The seat the release is for; null for a release with no seat. */
  readonly bookingId: string | null;
  readonly recordId: string;
  /** The link itself, spent by the signature. */
  readonly token: string;
  /** The link's row id: the drafts saved through a counter link are that phone's own. */
  readonly linkId: string;
  /** When the link stops opening anything, for the form's "works until" line. */
  readonly expiresAt: Date;
};

/** A counter tablet's or a Copy link's key (`waiver_link`). */
export type CounterWaiverKey = LinkWaiverKey & { readonly kind: "counter" };

/**
 * **The release signed in the diver's own thread** (issue #2743): the seat's
 * record, pinned by id at the start of the request, so every re-read inside the
 * lock reaches the same row a token would. Only `threadWaiverKey` makes one,
 * and only a caller that has already verified the readiness capability for
 * `bookingId`, or the party lead's for a seat whose parent's door is open
 * (`partySeatWaiverKey`), may call that: the key is the authority, as the
 * token is.
 */
export type ThreadWaiverKey = {
  readonly kind: "thread";
  readonly shopId: string;
  readonly bookingId: string;
  readonly recordId: string;
};

/**
 * Every thread key `threadWaiverKey` handed out, by identity. A server action's
 * arguments are whatever the browser sends, so an object shaped like a key is
 * not one: `currentRecordForToken` reaches a record only through a key this
 * module made (security review of #2743, F1).
 */
const issuedThreadKeys = new WeakSet<ThreadWaiverKey>();

/** Every link key `waiverLinkDoor` handed out, by identity, for the same reason. */
const issuedLinkKeys = new WeakSet<LinkWaiverKey>();

/**
 * The seat's own current release, for a caller holding a verified readiness
 * capability for `bookingId`. The newest record not superseded, issued for this
 * booking, and naming the person who holds the seat now: a release issued
 * before the seat moved to someone else is not theirs to see or sign. A
 * cancelled seat has no release to sign, as it has no link to issue one.
 */
export async function threadWaiverKey(
  db: DbExecutor,
  input: { shopId: string; bookingId: string },
): Promise<ThreadWaiverKey | null> {
  const [row] = await db
    .select({
      id: waiverRecords.id,
      status: waiverRecords.status,
      templateId: waiverRecords.templateId,
      templateVersion: waiverRecords.templateVersion,
      templateGeneration: waiverRecords.templateGeneration,
    })
    .from(waiverRecords)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, waiverRecords.bookingId),
        eq(bookings.shopId, waiverRecords.shopId),
        eq(bookings.personId, waiverRecords.personId),
      ),
    )
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.bookingId, input.bookingId),
        isNull(waiverRecords.supersededAt),
        seatNotCancelled,
        // A held seat's link may be in someone else's hands: the thread opens
        // nothing on it, not even a signed release's medical status.
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    // diveday:allow-time-id-order: picks the seat's one current release; nobody is shown this order.
    .orderBy(desc(waiverRecords.createdAt), desc(waiverRecords.id))
    .limit(1);
  if (!row) return null;
  // An unsigned release on terms the shop has since changed would read as
  // lapsed the moment it was signed: the thread opens none, and the Sign step
  // starts a fresh one on the current terms instead (`openWaiverInThread`).
  if (row.status === "pending") {
    const template = await getCurrentWaiverTemplate(db, input.shopId);
    if (
      !template ||
      row.templateId !== template.id ||
      row.templateVersion !== template.version ||
      row.templateGeneration !== template.materialGeneration
    ) {
      return null;
    }
  }
  const key: ThreadWaiverKey = Object.freeze({
    kind: "thread",
    shopId: input.shopId,
    bookingId: input.bookingId,
    recordId: row.id,
  });
  issuedThreadKeys.add(key);
  return key;
}

/**
 * Whether the seat's own release, as the thread reaches it, was signed and now
 * waits on a physician: the one case the thread's Sign step offers its receipt
 * again (`/ready/<token>/waiver`), where the doctor's page is.
 */
export async function threadWaiverAwaitsPhysician(
  db: DbExecutor,
  input: { shopId: string; bookingId: string },
): Promise<boolean> {
  const key = await threadWaiverKey(db, input);
  if (!key) return false;
  const state = await getWaiverForToken(db, key);
  if (state.state !== "completed" || !isUnresolvedMedicalHold(state.record)) return false;
  // Only a real physician referral: a hold whose doctor's form is already with
  // the shop, or one the shop reviews itself, has no doctor's page to open.
  const { record } = state;
  if (record.diverMedicalFormSentAt || !record.medicalAnswers) return false;
  if (calculateMedicalResult(record.medicalAnswers).status !== "physician_review") return false;
  return doctorPageOpen(db, record);
}

/**
 * The record a key reaches, or null. A thread key reaches only the one record
 * it was resolved to, and only while it is still that seat's. A link key
 * reaches its release while the link stands and the release is still the one
 * it was opened for; a spent link reaches only the receipt of the signature
 * that spent it.
 */
async function currentRecordForToken(db: DbExecutor, key: WaiverKey, now = nowDate()) {
  if (key.kind === "thread") {
    if (!issuedThreadKeys.has(key)) return null;
    return seatRecord(db, key);
  }
  if (!issuedLinkKeys.has(key)) return null;
  const link = await standingLink(db, key, now);
  if (!link) return null;
  const record = key.bookingId
    ? await seatRecord(db, { ...key, bookingId: key.bookingId })
    : await seatlessRecord(db, key);
  if (!record || (link.usedAt ? record.status === "pending" : record.status !== "pending"))
    return null;
  return record;
}

/**
 * A release with no seat, re-read by id: still this shop's, still seatless,
 * and not superseded (a fresh release, a contact change, a merge or an
 * erasure supersedes the one a link named).
 */
async function seatlessRecord(db: DbExecutor, key: { shopId: string; recordId: string }) {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.id, key.recordId),
        eq(waiverRecords.shopId, key.shopId),
        isNull(waiverRecords.bookingId),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .limit(1);
  return record ?? null;
}

/**
 * The record a seat key pins, re-read (inside the lock too): the seat must
 * still be this person's, not cancelled and not held, as it was when the key
 * was made.
 */
async function seatRecord(
  db: DbExecutor,
  key: { shopId: string; bookingId: string; recordId: string },
) {
  const [record] = await db
    .select(getTableColumns(waiverRecords))
    .from(waiverRecords)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, waiverRecords.bookingId),
        eq(bookings.shopId, waiverRecords.shopId),
        eq(bookings.personId, waiverRecords.personId),
      ),
    )
    .where(
      and(
        eq(waiverRecords.id, key.recordId),
        eq(waiverRecords.shopId, key.shopId),
        eq(waiverRecords.bookingId, key.bookingId),
        isNull(waiverRecords.supersededAt),
        seatNotCancelled,
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .limit(1);
  return record ?? null;
}

/**
 * The link behind a key while it still stands: its purpose, this release,
 * this shop, not revoked and not expired. A spent one stands too (`usedAt`),
 * for the receipt; the caller decides what a spent link opens.
 */
async function standingLink(db: DbExecutor, key: LinkWaiverKey, now: Date) {
  const [link] = await db
    .select({ usedAt: capabilities.usedAt })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, key.purpose),
        eq(capabilities.tokenHash, hashBearerToken(key.token)),
        eq(capabilities.shopId, key.shopId),
        eq(capabilities.waiverRecordId, key.recordId),
        isNull(capabilities.revokedAt),
        gt(capabilities.expiresAt, now),
      ),
    )
    .limit(1);
  return link ?? null;
}

/**
 * **What `/waivers/<token>` opens** (issue #2743, ADR
 * 20261105-waiver-folds-into-the-thread; issue #3983). A counter link
 * (`waiver_link`) opens its release while the link stands and the release is
 * still the one it was opened for: a seat's current release, or a release
 * with no seat. A release link (`release_link`) opens only a release with no
 * seat, never a seat's. Null for anything else, a dead link included: the
 * page then asks `staleWaiverRecordForToken` whether it is a release link its
 * owner can be sent a fresh one of. Every action of the page goes through
 * this, never a raw token.
 *
 * A counter link opens on one phone only (attacker review S1): the first one
 * to claim it (`claimCounterLink`) keeps the secret as `device`. Until then it
 * is `counter_unclaimed`; to any other phone it is `counter_elsewhere`.
 */
export async function waiverLinkDoor(
  db: DbExecutor,
  token: string,
  options: { device?: string; now?: Date } = {},
): Promise<WaiverLinkDoor> {
  if (token.length === 0) return null;
  const now = options.now ?? nowDate();
  const link = await verifiedCounterDoor(db, token);
  if (link) {
    const key = await linkWaiverKey(db, "counter", link, token, now);
    if (!key) return null;
    const via = link.purpose === "party_waiver_link" ? "mail" : "counter";
    const claim = await capabilityClaim(db, {
      purpose: link.purpose,
      token,
      device: options.device,
    });
    if (claim === "unclaimed") return { door: "counter_unclaimed", via };
    if (claim !== "this_device") return { door: "counter_elsewhere", via };
    return { door: "counter", key: key as CounterWaiverKey };
  }
  const release = await verifyCapability(db, { purpose: "release_link", token });
  if (!release) return null;
  const key = await linkWaiverKey(
    db,
    "release",
    { ...release, purpose: "release_link" },
    token,
    now,
  );
  if (!key || key.bookingId !== null) return null;
  return { door: "release", key };
}

/**
 * **A counter code that has closed** (issue #3985): a `waiver_link` that ran
 * out, or that a newer code replaced, before it was signed. Its way on is a
 * fresh code from the staff, so the page names the shop and nothing else: no
 * record, no person, no answers. Null for a live or spent code, and for
 * anything that is not a counter code.
 */
export async function closedCounterCode(
  db: DbExecutor,
  token: string,
  now: Date = nowDate(),
): Promise<{ shopId: string } | null> {
  if (token.length === 0) return null;
  const link = await verifyCapability(db, { purpose: "waiver_link", token });
  if (!link || link.usedAt) return null;
  const closed = link.revokedAt !== null || !link.expiresAt || link.expiresAt <= now;
  return closed ? { shopId: link.shopId } : null;
}

export type WaiverLinkDoor =
  | { door: "counter"; key: CounterWaiverKey }
  /** `via`: a counter QR or Copy link, or the door a party member's join email carried. */
  | { door: "counter_unclaimed"; via: "counter" | "mail" }
  | { door: "counter_elsewhere"; via: "counter" | "mail" }
  | { door: "release"; key: LinkWaiverKey }
  | null;

/** The counter door a token names, of either purpose, with the purpose it was minted for. */
async function verifiedCounterDoor(
  db: DbExecutor,
  token: string,
): Promise<(VerifiedCapability<WaiverDoorPurpose> & { purpose: WaiverDoorPurpose }) | null> {
  for (const purpose of COUNTER_DOOR_PURPOSES) {
    const link = await verifyCapability(db, { purpose, token });
    if (link) return { ...link, purpose };
  }
  return null;
}

/**
 * The first phone to open a counter link claims it: the secret it keeps in a
 * cookie, or null when the link is already claimed or opens nothing (expired,
 * replaced, spent, or its release no longer the one it was opened for).
 */
export async function claimCounterLink(
  db: DbExecutor,
  token: string,
  now: Date = nowDate(),
): Promise<string | null> {
  if (token.length === 0) return null;
  const link = await verifiedCounterDoor(db, token);
  if (!link || !(await linkWaiverKey(db, "counter", link, token, now))) return null;
  return claimCapability(db, { purpose: link.purpose, token, now });
}

/**
 * The key a live link makes, or null: the link stands, and the release it
 * names is still the one it was opened for. A seat's must still be that
 * seat's current release, for the person who holds it now, on the shop's
 * current terms (the thread's own rule); one with no seat must still be the
 * person's open release, on the current terms while unsigned. A release link
 * never names a seat's release (`waiverLinkDoor` refuses it).
 */
async function linkWaiverKey(
  db: DbExecutor,
  kind: LinkWaiverKey["kind"],
  link: VerifiedCapability<LinkPurpose> & { purpose: LinkPurpose },
  token: string,
  now: Date,
): Promise<LinkWaiverKey | null> {
  if (link.revokedAt || !link.expiresAt || link.expiresAt <= now) return null;
  const [record] = await db
    .select({
      id: waiverRecords.id,
      bookingId: waiverRecords.bookingId,
      status: waiverRecords.status,
      supersededAt: waiverRecords.supersededAt,
      templateId: waiverRecords.templateId,
      templateVersion: waiverRecords.templateVersion,
      templateGeneration: waiverRecords.templateGeneration,
    })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, link.subjectId), eq(waiverRecords.shopId, link.shopId)))
    .limit(1);
  if (!record || record.supersededAt) return null;
  // A link opens the receipt of the signature that spent it and of no other:
  // a release signed by another route (the thread, the desk, a newer door)
  // shows nothing to a door that did not sign it (security review).
  if (link.usedAt ? record.status === "pending" : record.status !== "pending") return null;
  if (record.bookingId) {
    // Still the seat's current release, for the person who holds it now, on
    // the shop's current terms: the thread's own rule.
    const current = await threadWaiverKey(db, {
      shopId: link.shopId,
      bookingId: record.bookingId,
    });
    if (current?.recordId !== record.id) return null;
  } else if (link.purpose === "party_waiver_link") {
    // A party member's door names their seat's release, never one with no
    // seat, which would cover every seat they hold (issue #3986).
    return null;
  } else if (record.status === "pending") {
    // An unsigned release on terms the shop has since changed would read as
    // lapsed the moment it was signed: the link opens nothing, and the next
    // send opens a fresh release on the current terms.
    const template = await getCurrentWaiverTemplate(db, link.shopId);
    if (
      !template ||
      record.templateId !== template.id ||
      record.templateVersion !== template.version ||
      record.templateGeneration !== template.materialGeneration
    )
      return null;
  }
  const key: LinkWaiverKey = Object.freeze({
    kind,
    purpose: link.purpose,
    shopId: link.shopId,
    bookingId: record.bookingId,
    recordId: record.id,
    token,
    linkId: link.id,
    expiresAt: link.expiresAt,
  });
  issuedLinkKeys.add(key);
  return key;
}

/** A bearer token reveals only its own record and is rejected on expiry/supersession. */
export async function getWaiverForToken(
  db: DbExecutor,
  token: WaiverKey,
  now: Date = nowDate(),
): Promise<TokenWaiverState> {
  const record = await currentRecordForToken(db, token, now);
  if (!record) return { state: "unavailable" };
  // A clearance counts only while its seal verifies (issue #3987): the record this hands the token
  // page and the thread never shows a bare stamp as an answer.
  if (record.status !== "pending") {
    return { state: "completed", record: withVerifiedClearance(record) };
  }
  // A held seat (`identity_unconfirmed_at`) is reached by no key: its link may
  // be in someone else's hands, so it opens no form, names nobody and takes
  // no draft or signature until the desk confirms who it is (issue #2125).
  return { state: "available", record };
}

/**
 * **The release behind a release link that no longer opens it**, for the
 * rescue card: the link expired, or was revoked (a newer link, a contact
 * change), or its release was superseded, while the release still waits for
 * its signature. The rescue then sends a fresh link to the contact on file,
 * never to the caller (`emailFreshWaiverLink`), so this is what keeps the same
 * dead URL landing on that card on every refresh.
 *
 * Deliberately narrow: a release link to a release with no seat, or a party
 * member's door to a seat's release (issue #4003); never a counter link (its
 * way on is a fresh code from the staff), never a live link and never a
 * signed release, so this can't become a second way to reach a signable link
 * or to read signed evidence. It returns the record for context only.
 */
export async function staleWaiverRecordForToken(
  db: DbExecutor,
  token: string,
  now: Date = nowDate(),
): Promise<typeof waiverRecords.$inferSelect | null> {
  if (token.length === 0) return null;
  const release = await verifyCapability(db, { purpose: "release_link", token });
  const door = release ? null : await verifyCapability(db, { purpose: "party_waiver_link", token });
  const link = release ?? door;
  if (!link) return null;
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.id, link.subjectId),
        eq(waiverRecords.shopId, link.shopId),
        release ? isNull(waiverRecords.bookingId) : isNotNull(waiverRecords.bookingId),
      ),
    )
    .limit(1);
  if (record?.status !== "pending" || record.anonymizedAt) return null;
  const linkLive = !link.revokedAt && !link.usedAt && link.expiresAt && link.expiresAt > now;
  if (linkLive && !record.supersededAt) {
    // A live door whose release is no longer the seat's own (the shop changed
    // its terms) opens nothing, so it is rescued like a dead one (issue #4003).
    if (!door || !record.bookingId) return null;
    const current = await threadWaiverKey(db, {
      shopId: record.shopId,
      bookingId: record.bookingId,
    });
    if (current?.recordId === record.id) return null;
  }
  return record;
}

type SaveWaiverDraftInput = {
  signerName?: string;
  acknowledged: boolean;
  medicalAnswers: MedicalAnswers;
  /** The guardian section as typed, for a parent who comes back to the link. */
  guardian?: DraftGuardian;
  /**
   * The shop questions as typed, raw by question id. Kept only where a value
   * reads as a valid answer to a question the record's own template version
   * asks; omitted, the saved draft is left as it was.
   */
  shopAnswers?: Readonly<Record<string, string>>;
  /**
   * The medical alert for the crew as typed. Kept when signing would keep
   * it, dropped otherwise; omitted, the saved draft is left as it was.
   */
  medicalAlert?: string;
  emergencyContact?: EmergencyContactInput;
  now?: Date;
};

export async function recordWaiverDraft(
  db: AppDb,
  token: WaiverKey,
  input: SaveWaiverDraftInput,
): Promise<boolean> {
  const initial = await currentRecordForToken(db, token, input.now);
  if (!initial) return false;
  return db.transaction(async (tx) => {
    if (await lockWaiverForWriting(tx, initial)) return false;
    return saveWaiverDraftLocked(tx, token, input);
  });
}

async function saveWaiverDraftLocked(
  db: DbExecutor,
  token: WaiverKey,
  input: SaveWaiverDraftInput,
): Promise<boolean> {
  const state = await getWaiverForToken(db, token, input.now);
  if (state.state !== "available") return false;
  const now = input.now ?? nowDate();
  const shopAnswers = input.shopAnswers;
  const draftShopAnswers =
    shopAnswers === undefined
      ? undefined
      : draftShopAnswersFrom(
          await getWaiverTemplateQuestions(db, state.record.shopId, state.record.templateId),
          (id) => shopAnswers[id],
        );
  // Template-question reads can wait on I/O; the bearer must still be live
  // at the write even though its row stayed locked throughout.
  if ((await getWaiverForToken(db, token, input.now ?? nowDate())).state !== "available")
    return false;
  const [saved] = await db
    .update(waiverRecords)
    .set({
      startedAt: state.record.startedAt ?? now,
      draftSignerName: input.signerName?.trim() || null,
      draftAcknowledged: input.acknowledged,
      draftMedicalAnswers: input.medicalAnswers,
      // A link gets back only the medical answers saved through it (dock
      // review B1; issue #3983 review): never another phone's, and never a
      // draft left on an earlier link months ago.
      draftViaLinkId: token.kind === "thread" ? null : token.linkId,
      ...(input.guardian === undefined ? {} : { draftGuardian: input.guardian }),
      ...(draftShopAnswers === undefined ? {} : { draftShopAnswers }),
      ...(input.medicalAlert === undefined
        ? {}
        : { draftMedicalAlert: readDraftMedicalAlert(input.medicalAlert) }),
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id });
  if (saved && input.emergencyContact) {
    if (state.record.bookingId)
      await saveEmergencyContact(db, state.record.bookingId, input.emergencyContact);
    else
      await recordPersonEmergencyContact(db, {
        shopId: state.record.shopId,
        personId: state.record.personId,
        ...input.emergencyContact,
      });
  }
  return Boolean(saved);
}

export type CompleteWaiverOutcome =
  | { ok: true; status: "completed" | "medical_review"; idempotent: boolean }
  | {
      ok: false;
      /**
       * A shop question's answer is missing (a required one left blank) or is
       * not a value its kind can hold. Never about *which* answer was given:
       * shop questions inform and never gate (dive-domain review B1).
       */
      reason: "invalid_shop_answers";
      /** The first refused question in the shop's order, for the page to ring. */
      questionId: string;
    }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "invalid_signature"
        | "name_mismatch"
        | "invalid_medical"
        /**
         * The medical alert for the crew is longer than the box allows or
         * carries a control character. Never about what it says: the alert
         * informs and never gates (issue #2960).
         */
        | "invalid_medical_alert"
        /** The diver is a minor on the signing day and no guardian section came with the signature. */
        | "guardian_required"
        /**
         * A minor's seat signed on a door the desk never vouched a guardian
         * for: an emailed door, or a counter code shown before the diver read
         * as a minor (issue #4003). The desk shows a fresh code.
         */
        | "guardian_at_counter"
        /** A guardian section came, and it is not a signature: no consent, no relationship, no email, or the diver's own name. */
        | "guardian_invalid"
        /** The booking is a held seat: nothing is signed onto the matched record until the desk confirms (issue #2125). */
        | "identity_unconfirmed"
        /**
         * A counter link's release was already signed: this submit's answers
         * are not saved, and never reported as that signature (attacker
         * review S1).
         */
        | "already_signed";
    };

/**
 * The guardian's half of a minor's release, as the page collects it (ADR
 * 20260907-guardian-co-signature). `agreed` is the guardian's own consent box,
 * the same assurance the diver's signature takes — a typed name is not a
 * signature until it is ticked.
 */
/** Local part, `@`, domain with at least one dot — the shape an address has. */
const GUARDIAN_EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GuardianInput = {
  name: string;
  relationship: string;
  email: string;
  agreed: boolean;
};

/**
 * What the guardian section has to be before it counts as a signature, given
 * the diver it is for. Returns the evidence to write, or the reason it is not.
 *
 * The name check is the co-signature's own version of the name-mismatch rule
 * two lines below for the diver: a minor typing their own name twice is one
 * signature wearing two hats, and the whole point of a second signer is that
 * they are somebody else.
 */
function guardianEvidence(
  guardian: GuardianInput,
  diverFullName: string,
  now: Date,
):
  | {
      ok: true;
      name: string;
      relationship: GuardianRelationship;
      /** Null when the family gave none — the column is nullable (issue #1453). */
      email: string | null;
      method: string;
      consentedAt: Date;
      signedAt: Date;
    }
  | { ok: false } {
  const evidence = localTypedConsentProvider.capture({
    signerName: guardian.name,
    agreed: guardian.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false };
  if (!isGuardianRelationship(guardian.relationship)) return { ok: false };
  const email = guardian.email.trim().toLowerCase();
  // **Optional, shape-checked when given** (issue #1453, owner decision
  // 2026-09-10). Blank is a family with no address — a grandparent at a
  // counter, or a household sharing the one the diver already gave — and
  // refusing them outright was the wrong end of the promise, since nothing
  // ever sent to the column. What is *not* relaxed is the shape: the page
  // dropped `required`, so this is what stands between a hand-built request
  // and an address on a signed release that nobody can ever reach the guardian
  // at. A malformed address is still a refusal, never a silent null.
  if (email !== "" && !GUARDIAN_EMAIL_SHAPE.test(email)) return { ok: false };
  // **The online path has no namesake exception and must never grow one**
  // (issue #1573, owner decision 2026-09-10). The paper path does, because a
  // named staffer physically watched two people sign; here the shop has no
  // evidence a second person exists at all, so a co-signer with the diver's
  // own name is one signature wearing two hats and is refused. `GuardianInput`
  // deliberately carries no field a request could set to get past this.
  if (personNamesMatch(evidence.signerName, diverFullName)) return { ok: false };
  return {
    ok: true,
    name: evidence.signerName,
    relationship: guardian.relationship,
    email: email === "" ? null : email,
    method: evidence.method,
    consentedAt: evidence.consentedAt,
    signedAt: evidence.signedAt,
  };
}

function completedStatus(
  status: typeof waiverRecords.$inferSelect.status,
): "completed" | "medical_review" {
  return status === "medical_review" ? "medical_review" : "completed";
}

/** Optional emergency contact captured alongside the waiver, stored on the person. */
export type EmergencyContactInput = { name?: string; phone?: string };

/**
 * Write the diver's emergency contact to their person record, as a pair or not
 * at all — `readEmergencyContact` holds that rule and says why a half-filled
 * submission is refused rather than merged. Both boxes blank is still the
 * no-change case: a diver who leaves the section alone must never wipe a value
 * the shop already has on file. The person is reached through the record's
 * booking, so a bearer token can only ever touch its own diver.
 */
async function saveEmergencyContact(
  db: DbExecutor,
  bookingId: string,
  contact: EmergencyContactInput,
): Promise<void> {
  const submitted = readEmergencyContact(contact);
  if (submitted.kind !== "pair") return;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [booking] = await db
    .select({ personId: bookings.personId, identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  // A held seat's link may be in someone else's hands: never write onto the
  // diver record it was matched to until staff confirm who it is (#2082).
  if (!booking || booking.identityUnconfirmedAt) return;
  await db.update(people).set(patch).where(eq(people.id, booking.personId));
}

/**
 * The diver's emergency contact on file as the bearer waiver page may show it,
 * reached through their booking. Blank and `held` on a held seat (`identity_unconfirmed_at`): the bearer link that
 * reads it may not belong to the diver record the seat was matched to, so the
 * page asks for nothing it could not save (#2082).
 */
export async function getEmergencyContactForBearer(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<{ name: string | null; phone: string | null; held: boolean } | null> {
  const [row] = await db
    .select({
      name: people.emergencyContactName,
      phone: people.emergencyContactPhone,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  if (row.identityUnconfirmedAt) return { name: null, phone: null, held: true };
  return { name: row.name, phone: row.phone, held: false };
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
    // diveday:allow-deleted-people: the emergency contact of a person on this manifest.
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/**
 * Save an emergency contact for a booking's diver, scoped to the shop so a
 * bearer-token surface (the `/ready` page) can only ever write to its own
 * booking's person. Blanks never overwrite an existing value, and a name
 * without a number (or a number without a name) writes nothing at all and
 * returns `false` — `readEmergencyContact` is where that rule lives. Callers
 * that can say so to a person check the pair themselves first, so the refusal
 * arrives as words rather than as a save that quietly did not happen.
 */
export async function recordBookingEmergencyContact(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    name?: string;
    phone?: string;
    /**
     * Who is writing. A bearer link on a held seat (`identity_unconfirmed_at`)
     * may belong to someone other than the diver record it was matched to, so
     * it never writes onto that record until staff confirm who it is (#2082).
     * Staff on a held seat write the seat's own contact (#2145), never the
     * matched record's.
     */
    actor: "bearer" | "staff";
  },
): Promise<boolean> {
  const submitted = readEmergencyContact(input);
  if (submitted.kind !== "pair") return false;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [booking] = await db
    .select({ personId: bookings.personId, identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return false;
  if (booking.identityUnconfirmedAt) {
    if (input.actor === "bearer") return false;
    // **A held seat's contact is the seat's** (issue #2145): the matched
    // record's next of kin may be somebody else's, so the desk's answer for
    // the person in front of them goes on the booking and is shown in place
    // of the withheld one. Nothing is written to the matched record.
    const [held] = await db
      .update(bookings)
      .set({
        heldEmergencyContactName: submitted.name,
        heldEmergencyContactPhone: submitted.phone,
      })
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          isNotNull(bookings.identityUnconfirmedAt),
        ),
      )
      .returning({ id: bookings.id });
    return Boolean(held);
  }
  const [updated] = await db
    .update(people)
    .set(patch)
    // The shop is restated rather than inherited from the read above. That
    // read proves the *booking* is this shop's; it does not prove
    // `bookings.person_id` points at a person inside it. This is the write a
    // bearer-token page reaches, so a row that ever goes wrong that way is
    // non-exploitable instead of merely unlikely — the same predicate
    // `recordPersonEmergencyContact` below makes.
    .where(and(eq(people.id, booking.personId), eq(people.shopId, input.shopId)))
    .returning({ id: people.id });
  return Boolean(updated);
}

/**
 * Save a person-level emergency contact when the waiver has no booking context.
 * Same pair-or-nothing rule as `recordBookingEmergencyContact`.
 */
export async function recordPersonEmergencyContact(
  db: DbExecutor,
  input: { shopId: string; personId: string; name?: string; phone?: string },
): Promise<boolean> {
  const submitted = readEmergencyContact(input);
  if (submitted.kind !== "pair") return false;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [updated] = await db
    .update(people)
    .set(patch)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .returning({ id: people.id });
  return Boolean(updated);
}

type CompleteWaiverInput = {
  signerName: string;
  agreed: boolean;
  medicalAnswers: MedicalAnswers;
  emergencyContact?: EmergencyContactInput;
  /**
   * The guardian's half, when the page collected one. Required when the
   * diver is a minor on the signing day; ignored otherwise — an adult's
   * release carries no co-signer, whatever was typed into a section the
   * page never rendered for them.
   */
  guardian?: GuardianInput;
  /**
   * The diver's answers to the shop's own questions, raw by question id.
   * Only the ids are trusted: the questions, their prompts, kinds and
   * options are read from the record's own template version, and the
   * sealed snapshot is built from those (dive-domain review B1).
   */
  shopAnswers?: Readonly<Record<string, string>>;
  /**
   * The medical alert for the crew as typed (glossary *Medical alert for
   * the crew*). Stored trimmed, blank as null; nothing reads what it says.
   */
  medicalAlert?: string;
  now?: Date;
};

async function lockWaiverForWriting(
  tx: DbExecutor,
  initial: typeof waiverRecords.$inferSelect,
): Promise<"unavailable" | "identity_unconfirmed" | null> {
  // Erasure and person merge take the matching exclusive lock before rows.
  await lockBoardingCertificationEvidence(tx, initial.shopId, "boarding");
  // Writers that issue a link and provider sends share person-before-booking
  // ordering, so completing a link must take the same route before locking its
  // waiver record.
  const [person] = await tx
    .select({
      id: people.id,
      anonymizedAt: people.anonymizedAt,
      mergedIntoPersonId: people.mergedIntoPersonId,
    })
    .from(people)
    // diveday:allow-deleted-people: an issued release may belong to a removed person; erasure is refused below.
    .where(and(eq(people.id, initial.personId), eq(people.shopId, initial.shopId)))
    // diveday:allow-update-lock: the signer and guardian facts must not change while the signature is recorded.
    .for("update")
    .limit(1);
  if (!person || person.anonymizedAt || person.mergedIntoPersonId) return "unavailable";
  if (initial.bookingId) {
    const [seat] = await tx
      .select({
        personId: bookings.personId,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      })
      .from(bookings)
      .where(and(eq(bookings.id, initial.bookingId), eq(bookings.shopId, initial.shopId)))
      .for("update")
      .limit(1);
    if (!seat || seat.personId !== initial.personId) return "unavailable";
    if (seat.identityUnconfirmedAt) return "identity_unconfirmed";
  }
  const [record] = await tx
    .select()
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, initial.id), eq(waiverRecords.shopId, initial.shopId)))
    .for("update")
    .limit(1);
  if (
    !record ||
    record.supersededAt ||
    record.personId !== initial.personId ||
    record.bookingId !== initial.bookingId
  )
    return "unavailable";
  return null;
}

export async function completeWaiver(
  db: AppDb,
  token: WaiverKey,
  input: CompleteWaiverInput,
): Promise<CompleteWaiverOutcome> {
  const initial = await currentRecordForToken(db, token, input.now);
  if (!initial) return { ok: false, reason: "unavailable" };
  const outcome = await db.transaction(async (tx): Promise<CompleteWaiverOutcome> => {
    const refusal = await lockWaiverForWriting(tx, initial);
    if (refusal) return { ok: false, reason: refusal };
    // The underlying and outer expiry are both checked by the locked reader.
    return completeWaiverLocked(tx, token, input);
  });
  if (outcome.ok && !outcome.idempotent)
    await publishManifestEventsForPerson(db, initial.shopId, initial.personId);
  return outcome;
}

async function completeWaiverLocked(
  db: DbExecutor,
  token: WaiverKey,
  input: CompleteWaiverInput,
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
  if (state.state === "completed") {
    if (isCounterKey(token)) return { ok: false, reason: "already_signed" };
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
    .select({ fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    // diveday:allow-deleted-people: the signer of a release already issued.
    .where(eq(people.id, state.record.personId))
    .limit(1);
  if (!signer || !personNamesMatch(evidence.signerName, signer.fullName)) {
    return { ok: false, reason: "name_mismatch" };
  }

  // A minor signs twice (ADR 20260907-guardian-co-signature): the same
  // typed-consent evidence, from a parent or legal guardian, on the same
  // sitting. Decided on the shop's calendar day the signature is given, from
  // the date of birth on file — never from anything the form claims about
  // the diver's age. Refused before the record is touched, like the name
  // mismatch above, so a family that missed the section keeps the link.
  const timezone = await shopTimezone(db, state.record.shopId);
  const minor = guardianSignatureRequired(
    signer.dateOfBirth,
    signingDate(now, timezone),
    // The booker's "Under 18" on this release's seat, read where the page
    // reads it, so the two can never disagree about asking.
    await seatMinorDeclared(db, state.record, now),
  );
  let guardian: ReturnType<typeof guardianEvidence> | null = null;
  // A minor's release signed on a counter door needs the desk's word that a
  // parent or guardian is here, given for this very code (issues #4003, and
  // #4019 for a release with no seat): a birth date or "Under 18" that
  // arrived after the code was shown is asked again here, and a party
  // member's emailed door never carries that word.
  if (minor && isCounterKey(token) && !(await deskSawGuardian(db, token, state.record.personId)))
    return { ok: false, reason: "guardian_at_counter" };
  // A mailed release link to a minor whose contact a party's lead typed: that
  // inbox cannot prove a guardian, so whoever holds it signs nothing, however
  // the diver came to read as a minor after it was sent (issue #4019).
  if (minor && (await releaseKeyLeadTyped(db, token, state.record.personId)))
    return { ok: false, reason: "guardian_at_counter" };
  if (minor) {
    if (!input.guardian) return { ok: false, reason: "guardian_required" };
    guardian = guardianEvidence(input.guardian, signer.fullName, now);
    if (!guardian.ok) return { ok: false, reason: "guardian_invalid" };
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
  // **The shop's own questions** (glossary *Shop question*), read from the
  // version this link was issued under, the way `template_body` is: a link
  // signs against what the diver was shown, never what the shop publishes
  // later. Refused before the record is touched, like every refusal above.
  // The outcome is a snapshot or a refusal and nothing else: no answer, of
  // any kind, reaches the status, the medical review, or anything that reads
  // them. `required` is answered, never a particular answer.
  const questions = await getWaiverTemplateQuestions(
    db,
    state.record.shopId,
    state.record.templateId,
  );
  const submittedShopAnswers = input.shopAnswers ?? {};
  const shopAnswers = buildShopAnswers(questions, (id) =>
    Object.hasOwn(submittedShopAnswers, id) ? submittedShopAnswers[id] : null,
  );
  if (!shopAnswers.ok) {
    return { ok: false, reason: "invalid_shop_answers", questionId: shopAnswers.questionId };
  }
  // **The medical alert for the crew** (issue #2960), refused before the
  // record is touched only for its shape (too long, a control character).
  // What it says reaches nothing below: `needsMedicalReview` reads the
  // standard answers alone, so "stent placed in June" written here with every
  // answer No completes as `completed` and readiness clears as it would
  // without it. The alert informs the crew; it never refers anyone.
  const medicalAlert = readMedicalAlert(input.medicalAlert);
  if (!medicalAlert.ok) return { ok: false, reason: "invalid_medical_alert" };
  const medicalReviewRequired = needsMedicalReview(input.medicalAnswers);
  const status = medicalReviewRequired ? ("medical_review" as const) : ("completed" as const);
  // The questionnaire and template reads above can wait past either the
  // wrapper's or the underlying link's expiry. Recheck at the write boundary.
  const atWrite = await getWaiverForToken(db, token, input.now ?? nowDate());
  if (atWrite.state === "unavailable") return { ok: false, reason: "unavailable" };
  if (atWrite.state === "completed") {
    if (isCounterKey(token)) return { ok: false, reason: "already_signed" };
    return { ok: true, status: completedStatus(atWrite.record.status), idempotent: true };
  }
  // A link is spent by the signature it carries, in this transaction: a
  // refusal below rolls the spend back, and a link spent, revoked or expired
  // since the read above signs nothing.
  if (token.kind !== "thread") {
    const spent = await spendCapability(db, {
      purpose: token.purpose,
      token: token.token,
      now: input.now ?? nowDate(),
      alsoRequire: and(
        eq(capabilities.shopId, token.shopId),
        eq(capabilities.waiverRecordId, token.recordId),
      ),
    });
    if (!spent) return { ok: false, reason: "unavailable" };
  }
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
      // In the same pending-guarded update as the signature, so the seal
      // below covers it. Null exactly when the version asked nothing.
      shopAnswers: shopAnswers.snapshot,
      // Sealed with the signature only when there is one (`signedMetadata`).
      medicalAlert: medicalAlert.value,
      completedAt: now,
      // The guardian's half, on a minor's release only. The draft goes with
      // the rest of the unsubmitted state: what was typed is now what was
      // signed, and a draft of a signed section is a second copy of personal
      // data with no reader.
      ...(guardian?.ok
        ? {
            guardianName: guardian.name,
            guardianRelationship: guardian.relationship,
            guardianEmail: guardian.email,
            guardianSignatureMethod: guardian.method,
            guardianConsentedAt: guardian.consentedAt,
            guardianSignedAt: guardian.signedAt,
          }
        : {}),
      draftGuardian: null,
      draftShopAnswers: null,
      draftMedicalAlert: null,
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
      const sealed = {
        ...signedRecord,
        integrityHash: computeWaiverIntegrityHash(signedRecord),
        integrityVersion: WAIVER_INTEGRITY_VERSION_SIGNED,
      };
      await db
        .update(waiverRecords)
        .set({
          integrityHash: sealed.integrityHash,
          integrityVersion: sealed.integrityVersion,
          ...waiverIntegrityVerdict(sealed, now),
        })
        .where(eq(waiverRecords.id, signedRecord.id));
    }
    if (input.emergencyContact) {
      if (state.record.bookingId) {
        await saveEmergencyContact(db, state.record.bookingId, input.emergencyContact);
      } else {
        await recordPersonEmergencyContact(db, {
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
    if (isCounterKey(token)) return { ok: false, reason: "already_signed" };
    return { ok: true, status: completedStatus(current.status), idempotent: true };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * A counter link is a QR any camera can read, so a release it reaches that is
 * already signed refuses a second submit rather than reporting the first one
 * as its own: a different set of answers is never silently dropped.
 */
/**
 * **The desk said a guardian is here, for this code** (issues #3986, #4003):
 * the `waiver_counter_guardian_confirmed` line on the diver's trail, naming
 * this release and this very code (`params.link`), written when the code was
 * shown. A party member's emailed door is never vouched for: nobody at the
 * desk saw who opened it.
 */
async function deskSawGuardian(
  db: DbExecutor,
  key: CounterWaiverKey,
  personId: string,
): Promise<boolean> {
  if (key.purpose !== "waiver_link") return false;
  const [line] = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.shopId, key.shopId),
        eq(activityEvents.code, "waiver_counter_guardian_confirmed"),
        eq(activityEvents.subjectPersonId, personId),
        sql`${activityEvents.params}->>'record' = ${key.recordId}`,
        sql`${activityEvents.params}->>'link' = ${key.linkId}`,
      ),
    )
    .limit(1);
  return Boolean(line);
}

/**
 * A mailed release link (`release_link`) whose diver's contact a party's lead
 * typed (`personContactLeadTyped`, issue #4019): for a minor, that inbox
 * cannot prove a guardian.
 */
async function releaseKeyLeadTyped(
  db: DbExecutor,
  key: WaiverKey,
  personId: string,
): Promise<boolean> {
  if (key.kind !== "release" || key.bookingId !== null) return false;
  return personContactLeadTyped(db, key.shopId, personId);
}

/**
 * **A door that cannot sign this minor's release, said before the form**
 * (issue #4003 reviews): the diver reads as under 18 today and the desk never
 * vouched a guardian for this code, or the door is a mailed release link to a
 * contact a party's lead typed (issue #4019), so the page shows why instead of
 * a form the family would fill in only to be refused at Sign.
 */
export async function doorNeedsDeskGuardian(
  db: DbExecutor,
  key: LinkWaiverKey,
  now: Date = nowDate(),
): Promise<boolean> {
  const [signer] = await db
    .select({ personId: waiverRecords.personId, dateOfBirth: people.dateOfBirth })
    .from(waiverRecords)
    .innerJoin(people, eq(people.id, waiverRecords.personId))
    .where(and(eq(waiverRecords.id, key.recordId), eq(waiverRecords.shopId, key.shopId)))
    .limit(1);
  if (!signer) return false;
  const minor = guardianSignatureRequired(
    signer.dateOfBirth,
    signingDate(now, await shopTimezone(db, key.shopId)),
    await seatMinorDeclared(
      db,
      { shopId: key.shopId, personId: signer.personId, bookingId: key.bookingId },
      now,
    ),
  );
  if (!minor) return false;
  if (isCounterKey(key)) return !(await deskSawGuardian(db, key, signer.personId));
  return releaseKeyLeadTyped(db, key, signer.personId);
}

function isCounterKey(token: WaiverKey): token is CounterWaiverKey {
  return token.kind === "counter";
}
