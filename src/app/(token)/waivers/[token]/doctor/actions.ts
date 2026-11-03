"use server";

import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  type DoctorAnswersState,
  type DoctorFormState,
  revealDoctorAnswersFor,
  sendDoctorFormFor,
} from "./doctor-core";

/** The shared per-IP bucket every waiver-link action spends from. */
async function waiverLinkAllowed(): Promise<boolean> {
  const ip = await clientIp();
  return (await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction))
    .allowed;
}

/**
 * **Unlock the doctor's page's answers with the diver's date of birth**
 * (security review of layer r5-3, F1). The waiver link alone shows the page;
 * which conditions the diver answered yes to needs something only the diver
 * knows. Two nets: the shared per-IP bucket every waiver-link action spends
 * from, and a narrow one per diver that fails closed, so a rotating set of
 * addresses cannot walk the birthdays either; under both, the record's
 * lifetime ceiling of wrong dates (`revealDoctorReferral`). Only the outcome
 * comes back: the published prompts on a match, and never the date on file.
 */
export async function revealDoctorAnswersAction(
  token: string,
  _previous: DoctorAnswersState,
  formData: FormData,
): Promise<DoctorAnswersState> {
  if (!(await waiverLinkAllowed())) return { status: "rate" };
  return revealDoctorAnswersFor(token, formData);
}

/**
 * **Send the signed doctor's form from the doctor's page** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form). The waiver link is the whole authority,
 * as it is for the page.
 *
 * In order, and each step before anything is stored: the shared per-IP bucket,
 * the link, a per-diver bucket that fails closed, the file's claimed type and
 * size, and whether the release still takes a form (`diverMedicalFormOpen`).
 * Then the bytes go through `storeMedicalClearanceDocument`, which decides by
 * the bytes themselves (an image is decoded and re-encoded, a PDF must start
 * `%PDF-`), into the private `medical-clearances` prefix. The write takes one
 * form per release; a file it refuses is queued for deletion, never left in
 * the bucket. Only the outcome comes back, never the stored address.
 */
export async function sendDoctorFormAction(
  token: string,
  _previous: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  if (!(await waiverLinkAllowed())) return { status: "rate" };
  return sendDoctorFormFor(token, formData);
}
