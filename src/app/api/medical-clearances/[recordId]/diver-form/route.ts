import { canPersonReadDiverMedicalForm } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordDiverActivity } from "@/db/operations";
import { getShopById } from "@/db/shops";
import { getDiverMedicalForm } from "@/db/waivers";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { log } from "@/lib/log";
import { mediaStorageConfigFromEnvironment, readS3Object } from "@/lib/storage";
import {
  MEDICAL_CLEARANCE_PREFIX,
  medicalDocumentResponse,
  medicalDocumentUnauthenticated,
  medicalDocumentNotFound as notFound,
} from "../../document-response";

/**
 * **The signed doctor's form a diver sent, for the staff who record the
 * answer** (issue #2797, ADR 20261024-diver-sent-doctors-form).
 *
 * The evaluation route's twin, one segment down, and the same shape on
 * purpose: the object sits under the private `medical-clearances/` prefix,
 * which has no CloudFront behaviour, so the bytes come back through DiveDay
 * signed as the uploader credential or not at all. Never a presigned URL;
 * every request re-reads the session, the shop and the caller's live roles.
 *
 * The gate is `canReadDiverMedicalForm`: every live staff role, because that
 * is who may record the physician's answer this form is evidence for. Wider
 * than the evaluation's owner-or-manager, and only until the answer is
 * recorded, after which this column is empty. A 404 for every refusal, and
 * every open is written to the diver's record before the bytes go out.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const session = await auth();
  // A pre-filter on the token's roles, ahead of any database work; the live
  // check below is the gate.
  if (!session?.user || !isStaff(session.user.roles)) return medicalDocumentUnauthenticated();

  const { recordId } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return notFound();
  if (!(await canPersonReadDiverMedicalForm(db, shop.id, session.user.personId))) {
    return notFound();
  }

  // Scoped by the session's own shop, never a slug or an id from the caller.
  const form = await getDiverMedicalForm(db, shop.id, recordId);
  if (!form) return notFound();

  const parsed = mediaStorageConfigFromEnvironment();
  if (!parsed.success) return notFound();

  const object = await readS3Object(form.url, parsed.data, { prefix: MEDICAL_CLEARANCE_PREFIX });
  if (!object.ok) {
    // Without the URL: the key names the shop's storage layout.
    log("diver_medical_form_read_failed", "warn", { recordId, reason: object.error });
    return notFound();
  }

  // Who opened it, on the diver's own record, after the bytes are in hand and
  // not swallowed: if the shop cannot record the read, the file does not go out.
  // A `false` (no live actor or diver row to name) is a read nobody recorded.
  const recorded = await recordDiverActivity(db, {
    shopId: shop.id,
    personId: form.personId,
    actorPersonId: session.user.personId,
    code: "diver_medical_form_opened",
    // Which form: accepting it as the evaluation asks for this line (issue #2797).
    waiverRecordId: recordId,
  });
  if (!recorded) return notFound();

  return medicalDocumentResponse(object);
}
