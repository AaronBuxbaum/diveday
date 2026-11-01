/**
 * Certification agency codes shared by the database enum and server-side
 * consumers. The enum is built from this list.
 *
 * The list lives outside `src/db/schema.ts`, which imports it to build the
 * enum. Server-side import and self-registration code can use the same agency
 * set without depending on the schema module.
 *
 * `schema.ts` builds its `pgEnum` from this array, so there is still exactly one
 * list and a widening still lands everywhere at once — the enum, the zod
 * `z.enum(certificationAgency.enumValues)` parsers, and the dropdown. The order
 * here is the order rendered, and `DIVER_CERTIFICATION_AGENCY_KEYS` in
 * `src/i18n/readiness-labels.ts` is typed `Record<CertificationAgency, …>`, so
 * adding one without its translation is a compile error rather than a blank
 * option.
 */
export const CERTIFICATION_AGENCIES = [
  "padi",
  "ssi",
  "naui",
  "sdi",
  "tdi",
  "cmas",
  "raid",
  "gue",
  "bsac",
  "nss_cds",
  "nacd",
  "iantd",
  "other",
] as const;

/**
 * "I am not certified", the answer that is not a certification level.
 *
 * Deliberately no ordinal here. `DiveCertificationField` renders it *second*,
 * between the empty placeholder and the five levels, and any count would drift
 * the moment an option moved. The word "sixth" in `dive-declaration.ts` means
 * something different and still holds there: this is a sixth *value* the select
 * accepts, never a sixth rung on the five-rung ladder `certificationRank` sorts
 * and `trip-admission.ts` asserts against.
 *
 * It lives here rather than beside the parser in `src/lib/dive-declaration.ts`
 * for the same reason as the agencies above. That module's line 1 is
 * `import { z } from "zod"` and its line 4 reaches `./rate-limit`, whose own
 * line 1 is `import { createHash } from "node:crypto"` — so a client component
 * importing this one string got zod **and** the whole browserified crypto stack
 * polyfilled in behind it: asn1.js, elliptic, browserify-sign/aes/des, pbkdf2,
 * sha.js, ripemd160, plus `buffer`, `readable-stream` and `string_decoder`.
 * Measured before this change, chunk `0t0xou-y8j7sv.js` was 444,145 bytes raw /
 * 133.2 KB gzipped and sat in the first load of `/s/[shopSlug]` and
 * `/s/[shopSlug]/trips/[id]` — the two heaviest pages in the app, and both of
 * them public pages a diver opens on a phone.
 *
 * `dive-declaration.ts` re-exports it, so every existing server-side call site
 * is unchanged and there is still one definition.
 *
 * The wire value is namespaced away from the level codes so nothing can ever
 * `as CertificationLevel` it by accident.
 */
export const NO_CERTIFICATION_ANSWER = "none_declared";
