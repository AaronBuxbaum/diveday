import { canPersonReadMedicalClearanceDocument } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordDiverActivity } from "@/db/operations";
import { getShopById } from "@/db/shops";
import { getMedicalClearanceDocument } from "@/db/waivers";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { log } from "@/lib/log";
import { mediaStorageConfigFromEnvironment, readS3Object } from "@/lib/storage";
import {
  MEDICAL_CLEARANCE_PREFIX,
  medicalDocumentResponse,
  medicalDocumentUnauthenticated,
  medicalDocumentNotFound as notFound,
} from "../document-response";

/**
 * **The physician's evaluation, handed back to the shop that stored it**
 * (issue #1283).
 *
 * #1252 shipped the write before the read, which was the right order — a read
 * path needs a permission gate and an IAM grant that did not exist. But the
 * residual was real: a shop uploaded the most sensitive document the product
 * holds and could never retrieve it, buying retention liability with no
 * retrieval value.
 *
 * ## Why this is a route and not a link
 *
 * The media bucket blocks all public access, and `medical-clearances/` has no
 * CloudFront behaviour **by construction** — `PUBLIC_MEDIA_PREFIXES` in
 * `infra/lib/infra-stack.ts` omits it and `media-distribution.test.ts` fails
 * if it ever appears. So the stored URL is not fetchable by anybody, including
 * the diver, including the shop. The bytes come back through DiveDay, signed
 * as the uploader credential, or not at all.
 *
 * Deliberately **not a presigned URL**. A presigned URL is a bearer capability
 * that outlives the check that minted it: it can be pasted into a chat, kept
 * in a browser history, or forwarded, and nothing revokes it. Every request
 * here re-derives the session, the shop and the caller's *live* roles, so a
 * manager demoted this morning is refused on their next click rather than at
 * the end of somebody's expiry window.
 *
 * ## The gate
 *
 * Owner or manager (`canReadMedicalClearanceDocument`), which is **not** who
 * may record a clearance. The reasoning is written at the capability; the
 * short of it is that recording is counter work and reading is not, and
 * nothing operational needs this file — readiness already answers "is this
 * diver cleared?" without it.
 *
 * A 404 for every refusal, including "wrong shop" and "no such record", so the
 * route never distinguishes a document this caller may not see from one that
 * does not exist. A staff GET answers 401 rather than redirecting, the same
 * call `src/app/api/search/route.ts` makes and for the same reason.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const session = await auth();
  // A pre-filter, not the gate, and ahead of any database work: a caller with
  // no session, or a token that never claimed a staff role, costs no
  // connection. The roles it reads are whatever the JWT was stamped with at
  // sign-in, which is exactly why it cannot be the last word.
  if (!session?.user || !isStaff(session.user.roles)) {
    return medicalDocumentUnauthenticated();
  }

  const { recordId } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return notFound();
  if (!(await canPersonReadMedicalClearanceDocument(db, shop.id, session.user.personId))) {
    return notFound();
  }

  // Scoped by the session's own shop, never a slug or an id from the caller.
  const document = await getMedicalClearanceDocument(db, shop.id, recordId);
  if (!document) return notFound();

  const parsed = mediaStorageConfigFromEnvironment();
  if (!parsed.success) {
    // Storage is not configured in this environment — the same absence that
    // makes the *upload* a no-op. A 404 rather than a 500: there is genuinely
    // no document here to hand back, and the shop has no action to take.
    return notFound();
  }

  const object = await readS3Object(document.url, parsed.data, {
    prefix: MEDICAL_CLEARANCE_PREFIX,
  });
  if (!object.ok) {
    // Logged without the URL: the key names the shop's own storage layout and
    // this line goes to CloudWatch. The record id is enough to find it again.
    log("medical_clearance_read_failed", "warn", { recordId, reason: object.error });
    return notFound();
  }

  // **Who opened it, on the diver's own record** — the same handle #726 uses
  // to record that a diver's file was exported. Every other act of comparable
  // weight in this app leaves a row: the incident export stamps its generator
  // into the document, seating a diver appends to this trail, a buddy-team
  // change appends to its own. Without it an owner or manager could read any
  // cleared diver's physician letter, repeatedly, and the shop would have no
  // way to know — which is what makes the owner-or-manager gate defensible
  // rather than merely convenient.
  //
  // Written after the bytes are in hand, so the trail records a read that
  // happened rather than one that was attempted and 404'd — and **not**
  // swallowed, which is the same call the diver-export route makes one door
  // over. An audit trail that can be skipped by breaking it is not one: if the
  // shop cannot record who opened this file, the file does not go out.
  await recordDiverActivity(db, {
    shopId: shop.id,
    personId: document.personId,
    actorPersonId: session.user.personId,
    code: "medical_clearance_opened",
  });

  return medicalDocumentResponse(object);
}
