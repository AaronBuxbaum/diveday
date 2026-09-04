/**
 * The certification values a public form renders, and the ones the database
 * enum is built from.
 *
 * This list lives here, away from `src/db/schema.ts`, for one reason:
 * **`DiveDeclarationFields` renders it, and that component is `"use client"`.**
 * It used to read `certificationAgency.enumValues` off the schema, and importing
 * the schema from the browser dragged drizzle-orm and all 360 KB of table
 * definitions into the bundle with it — measured on the build before this
 * change, chunk `25dmu3v5xhblz.js` was 133,786 bytes raw / 26.1 KB gzipped, in
 * the first load of `/s/[shopSlug]`, `/s/[shopSlug]/trips/[id]` and
 * `/shop/[shopSlug]/settings/import`. Two of those three are public pages a
 * diver opens on a phone.
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
  "other",
] as const;

/**
 * "I am not certified", the answer that is not a certification level.
 *
 * Deliberately no ordinal here. `DiveDeclarationFields` renders it *second*,
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
