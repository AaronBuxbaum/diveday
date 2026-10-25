/**
 * **How a stored medical document leaves DiveDay**, for both doors onto the
 * private `medical-clearances` prefix: the physician's evaluation staff
 * recorded (`/api/medical-clearances/[recordId]`, issue #1283) and the signed
 * form a diver sent from the doctor's page (`.../diver-form`, issue #2797).
 * One copy, so the two cannot drift on a header that matters.
 */

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The one prefix `storeMedicalClearanceDocument` writes under, and the only one these read. */
export const MEDICAL_CLEARANCE_PREFIX = "medical-clearances";

/**
 * What the uploader can actually have stored: a re-encoded image, or a PDF
 * proven by its magic bytes (`src/lib/storage/index.ts`). Anything else means
 * the object is not what the route thinks it is, and it goes out as bytes
 * rather than as a type the browser might act on.
 */
const SERVED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Every refusal looks the same from outside, so neither route is an oracle. */
export function medicalDocumentNotFound() {
  return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}

/** A staff GET with no staff session answers 401, the call `src/app/api/search/route.ts` makes. */
export function medicalDocumentUnauthenticated() {
  return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
}

export function medicalDocumentResponse(object: { bytes: ArrayBuffer; contentType: string }) {
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
      // Never rendered inline: a medical document is a PDF or a photograph of
      // one, and a page that framed it would put it into the browser's own
      // history and preview cache.
      "Content-Disposition": "attachment",
      // Belt and braces beside the header below — this response must not be
      // stored by a shared cache or indexed.
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...NO_STORE,
    },
  });
}
