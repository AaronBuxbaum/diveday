import { canPersonReadMedicalClearanceDocument } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordDiverActivity } from "@/db/operations";
import { getShopById } from "@/db/shops";
import { getMedicalClearanceDocument } from "@/db/waivers";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { log } from "@/lib/log";
import { readS3Object, s3StorageConfigSchema } from "@/lib/storage";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The one prefix `storeMedicalClearanceDocument` writes under, and the only one this reads. */
const MEDICAL_CLEARANCE_PREFIX = "medical-clearances";

/**
 * What the uploader can actually have stored: a re-encoded image, or a PDF
 * proven by its magic bytes (`src/lib/storage/index.ts`). Anything else means
 * the object is not what this route thinks it is, and it goes out as bytes
 * rather than as a type the browser might act on.
 */
const SERVED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

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
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
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

  const parsed = s3StorageConfigSchema.safeParse({
    bucket: process.env.MEDIA_S3_BUCKET,
    region: process.env.MEDIA_S3_REGION,
    accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
    publicUrlBase: process.env.MEDIA_PUBLIC_URL_BASE,
  });
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
    action: "opened the physician's evaluation for",
  });

  return new Response(object.bytes, {
    headers: {
      // **Allow-listed, not echoed.** The stored type was established against
      // the real bytes on the way in — `storeImage` re-encodes through sharp
      // and `storePdfDocument` proves the magic bytes — but the value now
      // round-trips through an external service, and a type this route did not
      // choose is one assumption too many for the file it is handing over.
      "Content-Type": SERVED_TYPES.has(object.contentType)
        ? object.contentType
        : "application/octet-stream",
      // Never rendered inline: an evaluation is a PDF or a photograph of one,
      // and a page that framed it would put a diver's medical document into
      // the browser's own history and preview cache.
      "Content-Disposition": "attachment",
      // Belt and braces beside the header below — this response must not be
      // stored by a shared cache or indexed.
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...NO_STORE,
    },
  });
}

/** Every refusal looks the same from outside, so the route is not an oracle. */
function notFound() {
  return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}
