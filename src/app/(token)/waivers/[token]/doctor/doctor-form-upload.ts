import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  PDF_CONTENT_TYPE,
} from "@/lib/storage/limits";

/**
 * What the doctor's page takes as a signed form, by the browser's claim
 * (issue #2797): a photo or a PDF, not empty, at most `MAX_IMAGE_BYTES`.
 * A cheap first refusal before any decode; the bytes are proven again by
 * `storeMedicalClearanceDocument`, which never trusts this type.
 */
export const DOCTOR_FORM_TYPES: readonly string[] = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  PDF_CONTENT_TYPE,
];

export function isDoctorFormUpload(value: unknown): value is File {
  return (
    value instanceof File &&
    value.size > 0 &&
    value.size <= MAX_IMAGE_BYTES &&
    DOCTOR_FORM_TYPES.includes(value.type)
  );
}
